// Leið Texture Mk II — C ABI over the vendored Beads DSP (vendor/beads, MIT,
// Emilie Gillet). Compiled to a standalone wasm32 module with no imports by
// scripts/build_beads.js, and natively by reference.cc. One module instance is
// one lane's Texture insert in its Mk II model: every piece of mutable state
// below lives in that instance's linear memory, so lanes never share DSP state.
//
// The whole of beads::Processor runs unmodified: recording buffer, grain and
// delay engines, the four quality settings, dry/wet, wow and flutter, reverb and
// limiters. What this file adds is the part of beads/beads.cc (the firmware's
// audio callback) and beads/cv_reader.h that turns a panel into the
// processor's inputs, minus the hardware:
//   - knob laws, copied from PotChannel (cv_reader.h): ATTENUVERTER for the four
//     randomization knobs, DETUNE for PITCH (±24 semitones with detents on
//     unison, 1, 3, 4, 7, 12 and 24), NORMAL for the rest; then the same
//     one-pole smoothing per block, and TIME's 0.001 hysteresis;
//   - the mix knobs' ×1.005 trim, clamped to 0..1, as in beads.cc;
//   - SEED: lane notes are a gate on the SEED input, delayed by 10 blocks
//     (2.5 ms) like the firmware's event_delay. Whether the input counts as
//     patched and the seed button state are host choices (bd_set_seed): button
//     off + patched is "grains while a note is held", locked + patched is
//     "notes clock a divider", locked + unpatched is "free running";
//   - output clamped to [-1, 0.999999], as before the codec.
// Not ported: AGC/input gain staging (IN GAIN is a plain linear gain here),
// CV inputs and normalization detection, the assignable CV, the gate output,
// buffer backup and the wavetable synth mode (it only runs with nothing patched
// into the audio inputs, which never happens on an insert).
//
// The DSP runs at the quality's own rate (24, 48, 32 or 48 kHz, see
// beads::Processor::sample_rate), in blocks of rate / 4000 samples (the
// firmware's kBlockRate), so bd_block_size() and bd_sample_rate() change with
// bd_set_quality(). The host (public/worklets/beads-processor.js) owns
// resampling and note timestamps.
//
// No allocation, no imports and no memory growth: everything is static.

#include <stdint.h>
#include <string.h>
#include <math.h>
#include <algorithm>

#include "stmlib/stmlib.h"
#include "stmlib/dsp/dsp.h"
#include "stmlib/dsp/hysteresis_filter.h"
#include "stmlib/utils/gate_flags.h"
#include "stmlib/utils/random.h"

#include "beads/dsp/processor.h"

#if defined(__wasm__)
#define BD_EXPORT(name) extern "C" __attribute__((export_name(#name)))
extern "C" void __wasm_call_ctors(void);
#else
#define BD_EXPORT(name) extern "C"
#endif

using namespace beads;
using namespace stmlib;

namespace {

const int kBlockRate = 4000;            // beads.cc
const int kMaxBlock = 48000 / kBlockRate;
const int kSeedDelayBlocks = 10;        // beads.cc: event_delay.Read(size * 10)
const int kSeedRing = 256;              // beads.cc: DelayLine<Codec::Event, 256>
const float kPotLp = 0.05f;             // cv_reader.cc: PotChannel lp coefficient
const float kTimeHysteresis = 0.001f;   // cv_reader.cc: TIME only

enum Knob {
  K_TIME, K_SIZE, K_SHAPE, K_PITCH,
  K_TIME_AMT, K_SIZE_AMT, K_SHAPE_AMT, K_PITCH_AMT,
  K_DENSITY, K_FEEDBACK, K_DRY_WET, K_REVERB,
  K_LAST
};

// Upstream's 512 KB + 256 KB delay memory, split into three blocks exactly as
// beads.cc does, and its 64 KB reverb buffer.
uint8_t delay_buffer_1[512 * 1024];
uint8_t delay_buffer_2[256 * 1024];
uint16_t reverb_buffer[32768];
uint8_t* delay_buffers[3];

Processor processor;

float in_l[kMaxBlock];
float in_r[kMaxBlock];
float out_l[kMaxBlock];
float out_r[kMaxBlock];
FloatFrame in_frames[kMaxBlock];
FloatFrame out_frames[kMaxBlock];

float target[K_LAST];       // knob law applied, not yet smoothed
float smoothed[K_LAST];
HysteresisFilter time_hysteresis;
float in_gain = 1.0f;
bool freeze = false;
int seed_button = SEED_BUTTON_STATE_LOCKED;
bool seed_patched = false;

// Gate input: the level the host last asked for, the changes it scheduled
// inside the next block, and the firmware's 2.5 ms delay ring.
bool gate_level = false;
int8_t gate_events[kMaxBlock];      // -1 none, 0 low, 1 high
bool seed_ring[kSeedRing];
int seed_write = 0;
GateFlags previous_seed = GATE_FLAG_LOW;

int quality = Processor::MEDIA_DIGITAL;
uint32_t fault_count = 0;
bool ctors_done = false;

inline float finite_or(float x, float fallback) {
  return (!(x == x) || isinf(x)) ? fallback : x;
}

inline float clamp01(float x, float fallback) {
  x = finite_or(x, fallback);
  return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x);
}

// PotChannel::Process (cv_reader.h), LAW_ATTENUVERTER.
inline float AttenuverterLaw(float v) {
  v -= 0.5f;
  return (2.0f / 0.47f) * v * std::max(fabsf(v) - 0.03f, 0.0f);
}

// PotChannel::Process (cv_reader.h), LAW_DETUNE: semitones.
inline float DetuneLaw(float v) {
  float detune = 2.0f * v - 1.0f;
  float sign = detune < 0.0f ? -1.0f : 1.0f;
  detune = detune * sign * 6.0f;
  MAKE_INTEGRAL_FRACTIONAL(detune);
  if (detune_integral > 6) { detune_integral = 6; detune_fractional = 1.0f; }
  const float intervals[8] = { 0.0f, 1.0f, 3.0f, 4.0f, 7.0f, 12.0f, 24.0f, 24.0f };
  detune_fractional = std::max((detune_fractional - 0.33333333f) * 1.5f, 0.0f);
  float a = intervals[detune_integral];
  float b = intervals[detune_integral + 1];
  return Crossfade(a, b, SmoothStep(detune_fractional)) * sign;
}

inline int BlockSize() {
  return static_cast<int>(processor.sample_rate()) / kBlockRate;
}

void ResetState() {
  processor.Init(delay_buffers, reverb_buffer);
  processor.Configure(Processor::Media(quality), false);
  memset(out_l, 0, sizeof(out_l));
  memset(out_r, 0, sizeof(out_r));
  memset(seed_ring, 0, sizeof(seed_ring));
  for (int i = 0; i < kMaxBlock; ++i) gate_events[i] = -1;
  seed_write = 0;
  previous_seed = GATE_FLAG_LOW;
  gate_level = false;
  for (int k = 0; k < K_LAST; ++k) smoothed[k] = target[k];
  time_hysteresis.Init(kTimeHysteresis);
  time_hysteresis.Process(target[K_TIME], 0.0f);
}

}  // namespace

// Call once after instantiation. Seeds the (per-instance) RNG so renders are
// reproducible for a given seed. Starts in Hi-fi with every knob at its
// bd_set_params default (below).
BD_EXPORT(bd_init) void bd_init(uint32_t seed) {
#if defined(__wasm__)
  if (!ctors_done) { __wasm_call_ctors(); ctors_done = true; }
#endif
  delay_buffers[0] = delay_buffer_1;
  delay_buffers[1] = delay_buffer_1 + (256 * 1024);
  delay_buffers[2] = delay_buffer_2;
  Random::Seed(seed ? seed : 1);
  target[K_TIME] = 0.5f;
  target[K_SIZE] = 0.5f;
  target[K_SHAPE] = 0.5f;
  target[K_PITCH] = 0.0f;
  target[K_TIME_AMT] = target[K_SIZE_AMT] = 0.0f;
  target[K_SHAPE_AMT] = target[K_PITCH_AMT] = 0.0f;
  target[K_DENSITY] = 0.5f;
  target[K_FEEDBACK] = 0.0f;
  target[K_DRY_WET] = 0.5f;
  target[K_REVERB] = 0.0f;
  quality = Processor::MEDIA_DIGITAL;
  fault_count = 0;
  ResetState();
}

BD_EXPORT(bd_block_size) int bd_block_size() { return BlockSize(); }
BD_EXPORT(bd_max_block_size) int bd_max_block_size() { return kMaxBlock; }
BD_EXPORT(bd_sample_rate) float bd_sample_rate() { return processor.sample_rate(); }
BD_EXPORT(bd_quality) int bd_quality() { return quality; }
BD_EXPORT(bd_in_l) float* bd_in_l() { return in_l; }
BD_EXPORT(bd_in_r) float* bd_in_r() { return in_r; }
BD_EXPORT(bd_out_l) float* bd_out_l() { return out_l; }
BD_EXPORT(bd_out_r) float* bd_out_r() { return out_r; }
BD_EXPORT(bd_fault_count) uint32_t bd_fault_count() { return fault_count; }

// Knob positions, all 0..1 as on the panel (the laws above turn them into the
// processor's units). inGain is linear.
BD_EXPORT(bd_set_params) void bd_set_params(
    float time, float size, float shape, float pitch,
    float time_amt, float size_amt, float shape_amt, float pitch_amt,
    float density, float feedback, float dry_wet, float reverb,
    float gain, int frz) {
  target[K_TIME] = clamp01(time, target[K_TIME]);
  target[K_SIZE] = clamp01(size, target[K_SIZE]);
  target[K_SHAPE] = clamp01(shape, target[K_SHAPE]);
  target[K_PITCH] = DetuneLaw(clamp01(pitch, 0.5f));
  target[K_TIME_AMT] = AttenuverterLaw(clamp01(time_amt, 0.5f));
  target[K_SIZE_AMT] = AttenuverterLaw(clamp01(size_amt, 0.5f));
  target[K_SHAPE_AMT] = AttenuverterLaw(clamp01(shape_amt, 0.5f));
  target[K_PITCH_AMT] = AttenuverterLaw(clamp01(pitch_amt, 0.5f));
  target[K_DENSITY] = clamp01(density, target[K_DENSITY]);
  target[K_FEEDBACK] = clamp01(feedback, target[K_FEEDBACK]);
  target[K_DRY_WET] = clamp01(dry_wet, target[K_DRY_WET]);
  target[K_REVERB] = clamp01(reverb, target[K_REVERB]);
  gain = finite_or(gain, 1.0f);
  in_gain = gain < 0.0f ? 0.0f : (gain > 4.0f ? 4.0f : gain);
  freeze = frz != 0;
}

// button: 0 off, 1 held, 2 locked (SeedButtonState). patched: lane notes reach
// the SEED input.
BD_EXPORT(bd_set_seed) void bd_set_seed(int button, int patched) {
  seed_button = button < 0 ? 0 : (button > 2 ? 2 : button);
  seed_patched = patched != 0;
}

// Media: 0 dirty tape, 1 clean tape, 2 vintage digital, 3 hi-fi (upstream's
// order). Resets the active engine like the firmware; sample rate and block
// size follow. The host fades around it.
BD_EXPORT(bd_set_quality) void bd_set_quality(int q) {
  q = q < 0 ? 0 : (q > 3 ? 3 : q);
  if (q == quality) return;
  quality = q;
  processor.Configure(Processor::Media(quality), false);
}

// The SEED gate goes high or low at `offset` samples into the next block.
BD_EXPORT(bd_gate) void bd_gate(int offset, int high) {
  int n = BlockSize();
  offset = offset < 0 ? 0 : (offset >= n ? n - 1 : offset);
  gate_events[offset] = high ? 1 : 0;
}

// Forget the recording, every grain, delay tap and reverb tail.
BD_EXPORT(bd_reset) void bd_reset() { ResetState(); }

// Process one block of bd_block_size() samples: reads bd_in_l()/bd_in_r(),
// writes the processor's full output (dry and wet) to bd_out_l()/bd_out_r().
BD_EXPORT(bd_render) void bd_render() {
  const int size = BlockSize();

  for (int k = 0; k < K_LAST; ++k) ONE_POLE(smoothed[k], target[k], kPotLp);
  time_hysteresis.Process(smoothed[K_TIME]);

  Parameters p;
  p.time.base = time_hysteresis.value();
  p.time.attenuverter = smoothed[K_TIME_AMT];
  p.time.has_cv = false;
  p.time.cv = 0.0f;
  p.size.base = smoothed[K_SIZE];
  p.size.attenuverter = smoothed[K_SIZE_AMT];
  p.size.has_cv = false;
  p.size.cv = 0.0f;
  p.shape.base = smoothed[K_SHAPE];
  p.shape.attenuverter = smoothed[K_SHAPE_AMT];
  p.shape.has_cv = false;
  p.shape.cv = 0.0f;
  p.pitch.base = smoothed[K_PITCH];
  p.pitch.attenuverter = smoothed[K_PITCH_AMT];
  p.pitch.has_cv = false;
  p.pitch.cv = 0.0f;
  p.monophonic_mode = false;

  ModulatedParameter d;
  d.base = smoothed[K_DENSITY];
  d.cv = 0.0f;

  Processor::MixParameters m;
  m.feedback = std::min(smoothed[K_FEEDBACK] * 1.005f, 1.0f);
  m.dry_wet = std::min(smoothed[K_DRY_WET] * 1.005f, 1.0f);
  m.reverb_amount = std::min(smoothed[K_REVERB] * 1.005f, 1.0f);
  m.output_gate = false;

  bool freeze_flags[kMaxBlock];
  GateFlags seed[kMaxBlock];
  for (int i = 0; i < size; ++i) {
    freeze_flags[i] = freeze;
    if (gate_events[i] >= 0) gate_level = gate_events[i] != 0;
    gate_events[i] = -1;
    seed_ring[seed_write] = gate_level;
    bool delayed = seed_ring[(seed_write - size * kSeedDelayBlocks + kSeedRing * 4) % kSeedRing];
    seed_write = (seed_write + 1) % kSeedRing;
    previous_seed = seed[i] = ExtractGateFlags(previous_seed, delayed);
  }

  for (int i = 0; i < size; ++i) {
    in_frames[i].l = finite_or(in_l[i], 0.0f) * in_gain;
    in_frames[i].r = finite_or(in_r[i], 0.0f) * in_gain;
  }

  processor.Process(
      SeedButtonState(seed_button),
      seed_patched ? seed : NULL,
      freeze_flags,
      d, p, m,
      in_frames, out_frames, size);

  bool finite = true;
  for (int i = 0; i < size; ++i) {
    float l = out_frames[i].l;
    float r = out_frames[i].r;
    if (!(l == l) || !(r == r) || isinf(l) || isinf(r)) { finite = false; break; }
    out_l[i] = l < -1.0f ? -1.0f : (l > 0.999999f ? 0.999999f : l);
    out_r[i] = r < -1.0f ? -1.0f : (r > 0.999999f ? 0.999999f : r);
  }

  if (!finite) {
    // Never expected from the upstream DSP; if it happens, reset rather than let
    // a NaN poison the lane's filters downstream.
    ++fault_count;
    ResetState();
    memset(out_l, 0, sizeof(out_l));
    memset(out_r, 0, sizeof(out_r));
  }
}
