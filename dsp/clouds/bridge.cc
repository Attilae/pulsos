// Leið Texture — C ABI over the vendored Clouds granular DSP (vendor/clouds,
// MIT, Emilie Gillet). Compiled to a standalone wasm32 module with no imports by
// scripts/build_clouds.js, and natively by reference.cc. One module instance is
// one lane's Texture insert: every piece of mutable state below lives in that
// instance's linear memory, so lanes never share DSP state.
//
// Texture works like the module: the lane's own audio streams in, is written to
// a circular recording buffer, and grains are played back out of it. The signal
// path follows clouds::GranularProcessor::Process in PLAYBACK_MODE_GRANULAR, in
// the same order and with the same constants:
//
//   in × IN GAIN → + feedback (high-passed, soft-limited) → record (unless
//   FREEZE) → GranularSamplePlayer → diffuser (TEXTURE past 3/4) → [feedback
//   tap] → reverb → wet × post gain × dry/wet crossfade
//
// Upstream classes used unmodified: AudioBuffer, GranularSamplePlayer (and its
// Grain), Diffuser, Reverb, stmlib::Svf, ParameterInterpolator. What is Leið's:
//   - the buffer is the stereo 16-bit high-quality configuration only (about one
//     second per channel, 32 grains): no quality/low-fi modes;
//   - the dry signal is mixed by the host at the context rate, so the lane's dry
//     sound never goes through the 32 kHz resampler. The DSP returns the wet
//     signal already scaled by the crossfade and exposes the matching dry gain;
//   - upstream's dry/wet crossfade is equal-power, so fully dry is 0.707 (-3 dB).
//     Both sides are scaled by √2 here, so a fully dry Texture leaves the lane at
//     exactly the level it has without Texture;
//   - the final SoftConvert stage (16-bit codec output) is not applied;
//   - stretch, looping-delay and spectral modes, the pitch shifter, and the
//     persistent-buffer save/load are not ported.
//
// The DSP runs at 32 kHz (upstream's rate) in 32-sample blocks (upstream's
// kMaxBlockSize). The host (public/worklets/clouds-granular-processor.js) owns
// resampling, TRIG timestamps and the dry mix.
//
// No allocation, no imports and no memory growth: everything is static.

#include <stdint.h>
#include <string.h>
#include <math.h>

#include "stmlib/stmlib.h"
#include "stmlib/dsp/dsp.h"
#include "stmlib/dsp/filter.h"
#include "stmlib/dsp/parameter_interpolator.h"
#include "stmlib/utils/random.h"

#include "clouds/dsp/audio_buffer.h"
#include "clouds/dsp/frame.h"
#include "clouds/dsp/granular_sample_player.h"
#include "clouds/dsp/parameters.h"
#include "clouds/dsp/fx/diffuser.h"
#include "clouds/dsp/fx/reverb.h"
#include "clouds/resources.h"

#if defined(__wasm__)
#define CG_EXPORT(name) extern "C" __attribute__((export_name(#name)))
extern "C" void __wasm_call_ctors(void);
#else
#define CG_EXPORT(name) extern "C"
#endif

using namespace clouds;
using namespace stmlib;

namespace {

const float kSampleRate = 32000.0f;
const int kBlock = static_cast<int>(kMaxBlockSize);      // 32
// Upstream's stereo 16-bit layout: each channel gets the small buffer
// (65536 - 128 bytes), i.e. 32704 samples ≈ 1.02 s at 32 kHz.
const int kBufferSamples = (65536 - 128) / 2;
const int kNumGrains = 32;                               // stereo, high quality
const float kPostGain = 1.2f;                            // upstream post_gain
const float kCrossfadeMakeup = 1.41421356f;              // √2: fully dry = unity
// Parameter smoothing for values upstream reads from smoothed ADCs.
const float kSmoothing = 0.05f;

int16_t storage[2][kBufferSamples];
int16_t tail[2][kCrossFadeSize];
AudioBuffer<RESOLUTION_16_BIT> buffer[2];
GranularSamplePlayer player;
Diffuser diffuser;
Reverb reverb;
float diffuser_buffer[2048];
uint16_t reverb_buffer[16384];
Svf fb_filter[2];

FloatFrame in_frames[kBlock];
FloatFrame out_frames[kBlock];
FloatFrame fb_frames[kBlock];

float in_l[kBlock];
float in_r[kBlock];
float out_l[kBlock];
float out_r[kBlock];

Parameters parameters;
float target_in_gain = 1.0f;
float in_gain = 1.0f;
float target_feedback = 0.0f;
float target_reverb = 0.0f;
float freeze_lp = 0.0f;
float dry_wet = 0.0f;
float dry_gain = 1.0f;
bool trigger_pending = false;

uint32_t fault_count = 0;
bool ctors_done = false;

inline float finite_or(float x, float fallback) {
  return (!(x == x) || isinf(x)) ? fallback : x;
}

inline float clamp01(float x, float fallback) {
  x = finite_or(x, fallback);
  return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x);
}

void ResetState() {
  for (int i = 0; i < 2; ++i) {
    buffer[i].Init(storage[i], kBufferSamples, tail[i]);
    fb_filter[i].Init();
  }
  player.Init(2, kNumGrains);
  diffuser.Init(diffuser_buffer);
  reverb.Init(reverb_buffer);
  memset(fb_frames, 0, sizeof(fb_frames));
  memset(out_l, 0, sizeof(out_l));
  memset(out_r, 0, sizeof(out_r));
  freeze_lp = parameters.freeze ? 1.0f : 0.0f;
  trigger_pending = false;
}

}  // namespace

// Call once after instantiation. Seeds the (per-instance) grain RNG so renders
// are reproducible for a given seed.
CG_EXPORT(cg_init) void cg_init(uint32_t seed) {
#if defined(__wasm__)
  if (!ctors_done) { __wasm_call_ctors(); ctors_done = true; }
#endif
  Random::Seed(seed ? seed : 0x21);
  memset(&parameters, 0, sizeof(parameters));
  // A neutral patch: grains from just behind the record head, medium size,
  // no transposition, density at noon (grains only on TRIG), fully dry.
  parameters.position = 0.0f;
  parameters.size = 0.5f;
  parameters.density = 0.5f;
  parameters.texture = 0.5f;
  parameters.stereo_spread = 0.0f;
  target_in_gain = in_gain = 1.0f;
  target_feedback = target_reverb = 0.0f;
  dry_wet = 0.0f;
  dry_gain = 1.0f;
  fault_count = 0;
  ResetState();
}

CG_EXPORT(cg_block_size) int cg_block_size() { return kBlock; }
CG_EXPORT(cg_sample_rate) float cg_sample_rate() { return kSampleRate; }
CG_EXPORT(cg_buffer_samples) int cg_buffer_samples() { return kBufferSamples; }
CG_EXPORT(cg_in_l) float* cg_in_l() { return in_l; }
CG_EXPORT(cg_in_r) float* cg_in_r() { return in_r; }
CG_EXPORT(cg_out_l) float* cg_out_l() { return out_l; }
CG_EXPORT(cg_out_r) float* cg_out_r() { return out_r; }
CG_EXPORT(cg_dry_gain) float cg_dry_gain() { return dry_gain; }
CG_EXPORT(cg_fault_count) uint32_t cg_fault_count() { return fault_count; }

// Knob values as the module's CV scaler hands them to the processor, all 0..1
// except in_gain (linear) and pitch (0..1 knob, quantized through upstream's
// lut_quantized_pitch to ±24 semitones with semitone detents). Non-finite
// values keep the previous setting.
CG_EXPORT(cg_set_params) void cg_set_params(
    float position, float size, float pitch_knob, float density, float texture,
    float dry_wet_value, float stereo_spread, float feedback, float reverb_amount,
    float gain, int freeze) {
  parameters.position = clamp01(position, parameters.position);
  parameters.size = clamp01(size, parameters.size);
  float pk = finite_or(pitch_knob, -1.0f);
  if (pk >= 0.0f) {
    if (pk > 1.0f) pk = 1.0f;
    parameters.pitch = Interpolate(lut_quantized_pitch, pk, 1024.0f);
  }
  parameters.density = clamp01(density, parameters.density);
  parameters.texture = clamp01(texture, parameters.texture);
  parameters.dry_wet = clamp01(dry_wet_value, parameters.dry_wet);
  parameters.stereo_spread = clamp01(stereo_spread, parameters.stereo_spread);
  target_feedback = clamp01(feedback, target_feedback);
  target_reverb = clamp01(reverb_amount, target_reverb);
  float g = finite_or(gain, target_in_gain);
  target_in_gain = g < 0.0f ? 0.0f : (g > 4.0f ? 4.0f : g);
  parameters.freeze = freeze != 0;
}

// The module's TRIG input: seed one grain at the start of the next block.
CG_EXPORT(cg_trigger) void cg_trigger() { trigger_pending = true; }

// Forget the recording and every sounding grain and tail.
CG_EXPORT(cg_reset) void cg_reset() { ResetState(); }

// Process exactly one 32-sample block: reads cg_in_l()/cg_in_r(), writes the
// wet signal to cg_out_l()/cg_out_r() and the dry gain to cg_dry_gain().
CG_EXPORT(cg_render) void cg_render() {
  const size_t size = kBlock;
  ONE_POLE(in_gain, target_in_gain, kSmoothing);
  ONE_POLE(parameters.feedback, target_feedback, kSmoothing);
  ONE_POLE(parameters.reverb, target_reverb, kSmoothing);

  for (size_t i = 0; i < size; ++i) {
    in_frames[i].l = finite_or(in_l[i], 0.0f) * in_gain;
    in_frames[i].r = finite_or(in_r[i], 0.0f) * in_gain;
  }

  // Feedback, high-passed to keep low-frequency build-ups (DC swings) out.
  ONE_POLE(freeze_lp, parameters.freeze ? 1.0f : 0.0f, 0.0005f)
  float feedback = parameters.feedback;
  float cutoff = (20.0f + 100.0f * feedback * feedback) / kSampleRate;
  fb_filter[0].set_f_q<FREQUENCY_FAST>(cutoff, 1.0f);
  fb_filter[1].set(fb_filter[0]);
  fb_filter[0].Process<FILTER_MODE_HIGH_PASS>(&fb_frames[0].l, &fb_frames[0].l, size, 2);
  fb_filter[1].Process<FILTER_MODE_HIGH_PASS>(&fb_frames[0].r, &fb_frames[0].r, size, 2);
  float fb_gain = feedback * (1.0f - freeze_lp);
  for (size_t i = 0; i < size; ++i) {
    in_frames[i].l += fb_gain * (
        SoftLimit(fb_gain * 1.4f * fb_frames[i].l + in_frames[i].l) - in_frames[i].l);
    in_frames[i].r += fb_gain * (
        SoftLimit(fb_gain * 1.4f * fb_frames[i].r + in_frames[i].r) - in_frames[i].r);
  }

  // Record, unless frozen (WriteFade crossfades back in when freeze releases).
  const float* input_samples = &in_frames[0].l;
  for (int i = 0; i < 2; ++i) {
    buffer[i].WriteFade(&input_samples[i], size, 2, !parameters.freeze);
  }

  // Granular mode: DENSITY and TEXTURE are meta parameters.
  parameters.granular.use_deterministic_seed = parameters.density < 0.5f;
  if (parameters.density >= 0.53f) {
    parameters.granular.overlap = (parameters.density - 0.53f) * 2.12f;
  } else if (parameters.density <= 0.47f) {
    parameters.granular.overlap = (0.47f - parameters.density) * 2.12f;
  } else {
    parameters.granular.overlap = 0.0f;
  }
  parameters.granular.window_shape = parameters.texture < 0.75f
      ? parameters.texture * 1.333f : 1.0f;
  parameters.trigger = trigger_pending;
  trigger_pending = false;
  player.Play(buffer, parameters, &out_frames[0].l, size);
  parameters.trigger = false;

  float texture = parameters.texture;
  diffuser.set_amount(texture > 0.75f ? (texture - 0.75f) * 4.0f : 0.0f);
  diffuser.Process(out_frames, size);

  // This is what is fed back. Reverb is not fed back.
  memcpy(fb_frames, out_frames, sizeof(out_frames));

  float reverb_amount = parameters.reverb * 0.95f;
  reverb_amount += feedback * (2.0f - feedback) * freeze_lp;
  CONSTRAIN(reverb_amount, 0.0f, 1.0f);
  reverb.set_amount(reverb_amount * 0.54f);
  reverb.set_diffusion(0.7f);
  reverb.set_time(0.35f + 0.63f * reverb_amount);
  reverb.set_input_gain(0.2f);
  reverb.set_lp(0.6f + 0.37f * feedback);
  reverb.Process(out_frames, size);

  ParameterInterpolator dry_wet_mod(&dry_wet, parameters.dry_wet, size);
  float fade_out = 1.0f;
  bool finite = true;
  for (size_t i = 0; i < size; ++i) {
    float dw = dry_wet_mod.Next();
    float fade_in = Interpolate(lut_xfade_in, dw, 16.0f) * kCrossfadeMakeup;
    fade_out = Interpolate(lut_xfade_out, dw, 16.0f) * kCrossfadeMakeup;
    float l = out_frames[i].l * kPostGain * fade_in;
    float r = out_frames[i].r * kPostGain * fade_in;
    if (!(l == l) || !(r == r) || isinf(l) || isinf(r)) { finite = false; break; }
    out_l[i] = l;
    out_r[i] = r;
  }
  dry_gain = fade_out;

  if (!finite) {
    // Never expected from the upstream DSP; if it happens, reset rather than let
    // a NaN poison the lane's filters downstream.
    ++fault_count;
    ResetState();
  }
}
