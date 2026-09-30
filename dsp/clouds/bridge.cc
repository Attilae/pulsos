// Leið Cloud grains — C ABI over the vendored Clouds granular DSP
// (vendor/clouds, MIT, Emilie Gillet). Compiled to a standalone wasm32 module
// with no imports by scripts/build_clouds.js, and natively by reference.cc.
// One module instance is one lane's granular layer: every piece of mutable state
// below lives in that instance's linear memory, so lanes never share DSP state.
//
// What is upstream and what is Leið's:
//   - clouds::Grain (windowed, pitched, interpolated grain playback) and
//     clouds::AudioBuffer (16-bit storage + Hermite/linear/ZOH reads) are used
//     unmodified.
//   - The scheduler below is derived from clouds::GranularSamplePlayer::Play /
//     ScheduleGrain (granular_sample_player.h at the pinned commit): the same
//     deterministic-vs-probabilistic seeding, quality tiers, stereo-spread pan
//     law and rsqrt gain normalisation. It differs where Leið's contract needs it
//     (docs/clouds-granular-port-plan.md, "Parameter contract"):
//       * the source is a static, frozen render loaded by the host (cg_load), not
//         a circular recording, so grain positions are absolute source offsets;
//       * positions come from a scan head that moves through a bounded
//         [start, end) window at `scan_rate` × real time, independent of pitch
//         (Leið's playbackRate), plus per-grain random `jitter`;
//       * `reverse` reads a reversed copy of the source (Grain only plays
//         forwards: its phase increment is unsigned in practice);
//       * grain length is given in samples rather than the hardware knob, so
//         grains shorter than lut_grain_size's 32 ms floor stay available.
//   - Not ported (plan: later, after the contract is stable): the diffuser,
//     pitch shifter, feedback, reverb, dry/wet, and the stretch, looping-delay
//     and spectral modes.
//
// The DSP runs at 32 kHz (upstream's rate) in 32-sample blocks (upstream's
// kMaxBlockSize); the host (public/worklets/clouds-granular-processor.js) owns
// note scheduling and resampling to the context rate.
//
// No allocation, no imports and no memory growth: everything is static.

#include <stdint.h>
#include <string.h>
#include <math.h>

#include "stmlib/stmlib.h"
#include "stmlib/dsp/dsp.h"
#include "stmlib/dsp/rsqrt.h"
#include "stmlib/dsp/units.h"
#include "stmlib/utils/random.h"

#include "clouds/dsp/audio_buffer.h"
#include "clouds/dsp/frame.h"
#include "clouds/dsp/grain.h"
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
const int kMaxGrains = 32;
const int kMidfiGrains = 3 * kMaxGrains / 4;             // upstream's ratio
// Longest source kept without cropping. Leið renders two seconds; the extra
// room is so a longer render is never silently cut (cg_load reports a crop).
const int kMaxSource = 32000 * 4;
const int kMinGrain = 64;                                // 2 ms
const int kMaxGrain = 16384;                             // lut_grain_size's top
const int kFadeSamples = 160;                            // 5 ms source-swap declick
const int kReadGuard = 4;                                // Hermite reads x..x+3

// Mono source, stored twice: forwards and reversed.
int16_t storage_fwd[kMaxSource + kInterpolationTail];
int16_t storage_rev[kMaxSource + kInterpolationTail];
int16_t tail_scratch[kCrossFadeSize];
AudioBuffer<RESOLUTION_16_BIT> buf_fwd;
AudioBuffer<RESOLUTION_16_BIT> buf_rev;

// The host writes a new source here (float, 32 kHz, mono) and calls cg_load.
float staging[kMaxSource];
int pending_len = -1;          // a load waiting for the fade-out to finish
int source_len = 0;            // 0 = nothing loaded: render silence

Grain grains[kMaxGrains];
int32_t available[kMaxGrains];
float envelope[kBlock];
float mix[kBlock * 2];
float out_l[kBlock];
float out_r[kBlock];

struct Params {
  float size;          // grain length, samples
  float density;       // target number of overlapping grains, 0..kMaxGrains
  float scan_rate;     // scan-head speed, × real time (Leið playbackRate)
  float win_start;     // 0..1 of the source
  float win_end;       // 0..1, > win_start
  float jitter;        // 0..1: position spread + probabilistic seeding
  float window_shape;  // upstream texture→window mapping, 0..1
  float spread;        // stereo spread, 0..1
  int reverse;
};

Params params = { 2880.0f, 5.0f, 1.0f, 0.0f, 1.0f, 0.0f, 0.75f, 0.5f, 0 };
float pitch = 0.0f;            // semitones, applied to grains as they start
bool trigger_pending = false;

float scan = 0.0f;             // scan head, samples from window start
float num_grains = 0.0f;       // smoothed active-grain count (upstream SLOPE)
float gain_norm = 1.0f;
float size_hint = 1024.0f;
float rate_phasor = 0.0f;

enum FadeState { FADE_NONE, FADE_OUT, FADE_IN };
FadeState fade_state = FADE_NONE;
float fade = 1.0f;

uint32_t fault_count = 0;
uint32_t crop_count = 0;
bool ctors_done = false;

inline float finite_or(float x, float fallback) {
  return (!(x == x) || isinf(x)) ? fallback : x;
}

inline float clampf(float x, float lo, float hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

void ResetGrains() {
  for (int i = 0; i < kMaxGrains; ++i) grains[i].Init();
  num_grains = 0.0f;
  gain_norm = 1.0f;
  rate_phasor = 0.0f;
}

// Convert staging[0, len) into both 16-bit buffers. Bounded: 2 × len writes.
void CommitSource(int len) {
  if (len > kMaxSource) { len = kMaxSource; ++crop_count; }
  if (len < kMinGrain * 2) len = 0;
  if (len) {
    buf_fwd.Init(storage_fwd, len + kInterpolationTail, tail_scratch);
    buf_rev.Init(storage_rev, len + kInterpolationTail, tail_scratch);
    for (int i = 0; i < len; ++i) {
      float s = finite_or(staging[i], 0.0f);
      buf_fwd.Write(s);
      buf_rev.Write(finite_or(staging[len - 1 - i], 0.0f));
    }
  }
  source_len = len;
  scan = 0.0f;
  ResetGrains();
}

// Window bounds in samples of whichever buffer is being read. The reversed
// buffer mirrors the window so `reverse` plays the same region backwards.
void WindowBounds(float* start, float* span) {
  float a = params.win_start, b = params.win_end;
  if (params.reverse) { float t = 1.0f - b; b = 1.0f - a; a = t; }
  float s = a * source_len;
  float e = b * source_len;
  if (e - s < params.size) e = s + params.size;   // at least one grain wide
  if (e > source_len) { e = source_len; s = e - params.size; if (s < 0) s = 0; }
  *start = s;
  *span = e - s;
}

void ScheduleGrain(Grain* g, int32_t pre_delay, float win_start, float win_span,
                   float scan_pos, GrainQuality quality) {
  const AudioBuffer<RESOLUTION_16_BIT>& buf = params.reverse ? buf_rev : buf_fwd;
  float p = clampf(pitch, -48.0f, 48.0f);
  float ratio = SemitonesToRatio(p);
  float size = params.size;
  float limit = static_cast<float>(source_len - kReadGuard);
  // A fast grain must not read past the end of the source (upstream shrinks it
  // against the record head for the same reason).
  if (size * ratio > limit) size = limit / ratio;
  int32_t width = static_cast<int32_t>(size) & ~1;
  if (width < 2) return;

  float pos = scan_pos;
  if (params.jitter > 0.0f) pos += (Random::GetFloat() - 0.5f) * params.jitter * win_span;
  // Wrap into the window, then keep the whole grain inside the source.
  while (pos < 0.0f) pos += win_span;
  while (pos >= win_span) pos -= win_span;
  float start = win_start + pos;
  float eaten = width * ratio;
  if (start + eaten > limit) start = limit - eaten;
  if (start < 0.0f) start = 0.0f;

  float pan = 0.5f + params.spread * (Random::GetFloat() - 0.5f);
  float gain_l = Interpolate(lut_sin, pan, 256.0f);
  float gain_r = Interpolate(lut_sin + 256, pan, 256.0f);

  g->Start(pre_delay, buf.size(), static_cast<int32_t>(start), width,
           static_cast<int32_t>(ratio * 65536.0f), params.window_shape,
           gain_l, gain_r, quality);
  ONE_POLE(size_hint, static_cast<float>(width), 0.1f);
}

// One block of the grain cloud into mix[] (interleaved stereo).
void PlayGrains() {
  memset(mix, 0, sizeof(mix));
  if (!source_len) return;

  float target = clampf(params.density, 0.0f, static_cast<float>(kMaxGrains));
  bool deterministic = params.jitter <= 0.0f;
  float p = target / size_hint;
  float space = target > 0.0f ? size_hint / target : 1e9f;
  if (deterministic) p = -1.0f; else rate_phasor = -1000.0f;

  int32_t num_available = 0;
  for (int32_t i = 0; i < kMaxGrains; ++i) {
    if (!grains[i].active()) available[num_available++] = i;
  }

  float win_start, win_span;
  WindowBounds(&win_start, &win_span);
  float rate = clampf(params.scan_rate, 0.0f, 16.0f);

  bool seed_trigger = trigger_pending;
  trigger_pending = false;
  for (int t = 0; t < kBlock; ++t) {
    rate_phasor += 1.0f;
    scan += rate;
    if (scan >= win_span) scan -= win_span * floorf(scan / win_span);
    bool seed_probabilistic = Random::GetFloat() < p && target > num_grains;
    bool seed_deterministic = rate_phasor >= space;
    if (num_available && (seed_probabilistic || seed_deterministic || seed_trigger)) {
      --num_available;
      Grain* g = &grains[available[num_available]];
      GrainQuality q = num_available < kMidfiGrains ? GRAIN_QUALITY_MEDIUM : GRAIN_QUALITY_HIGH;
      ScheduleGrain(g, t, win_start, win_span, scan, q);
      rate_phasor = 0.0f;
      seed_trigger = false;
    }
  }

  const AudioBuffer<RESOLUTION_16_BIT>* buf = params.reverse ? &buf_rev : &buf_fwd;
  for (int32_t i = 0; i < kMaxGrains; ++i) {
    Grain* g = &grains[i];
    if (g->recommended_quality() == GRAIN_QUALITY_HIGH) {
      g->OverlapAdd<1, GRAIN_QUALITY_HIGH>(buf, mix, envelope, kBlock);
    } else {
      g->OverlapAdd<1, GRAIN_QUALITY_MEDIUM>(buf, mix, envelope, kBlock);
    }
  }

  // Upstream normalisation: 1/sqrt(n-1) over the smoothed grain count, scaled
  // up for sharper windows as overlap rises.
  int32_t active = kMaxGrains - num_available;
  SLOPE(num_grains, static_cast<float>(active), 0.9f, 0.2f);
  float g = num_grains > 2.0f ? fast_rsqrt_carmack(num_grains - 1.0f) : 1.0f;
  float overlap = cbrtf(target / kMaxGrains);
  float window_gain = clampf(1.0f + 2.0f * params.window_shape, 1.0f, 2.0f);
  g *= Crossfade(1.0f, window_gain, overlap);
  float* o = mix;
  for (int t = 0; t < kBlock; ++t) {
    ONE_POLE(gain_norm, g, 0.01f);
    *o++ *= gain_norm;
    *o++ *= gain_norm;
  }
}

}  // namespace

// Call once after instantiation. Seeds the (per-instance) grain RNG so renders
// are reproducible for a given seed.
CG_EXPORT(cg_init) void cg_init(uint32_t seed) {
#if defined(__wasm__)
  if (!ctors_done) { __wasm_call_ctors(); ctors_done = true; }
#endif
  Random::Seed(seed ? seed : 0x21);
  memset(out_l, 0, sizeof(out_l));
  memset(out_r, 0, sizeof(out_r));
  source_len = 0;
  pending_len = -1;
  pitch = 0.0f;
  trigger_pending = false;
  scan = 0.0f;
  size_hint = 1024.0f;
  fade_state = FADE_NONE;
  fade = 1.0f;
  fault_count = 0;
  crop_count = 0;
  ResetGrains();
}

CG_EXPORT(cg_block_size) int cg_block_size() { return kBlock; }
CG_EXPORT(cg_sample_rate) float cg_sample_rate() { return kSampleRate; }
CG_EXPORT(cg_max_source) int cg_max_source() { return kMaxSource; }
CG_EXPORT(cg_max_grains) int cg_max_grains() { return kMaxGrains; }
CG_EXPORT(cg_staging) float* cg_staging() { return staging; }
CG_EXPORT(cg_out_l) float* cg_out_l() { return out_l; }
CG_EXPORT(cg_out_r) float* cg_out_r() { return out_r; }
CG_EXPORT(cg_fault_count) uint32_t cg_fault_count() { return fault_count; }
CG_EXPORT(cg_crop_count) uint32_t cg_crop_count() { return crop_count; }
CG_EXPORT(cg_source_length) int cg_source_length() { return source_len; }

CG_EXPORT(cg_active_grains) int cg_active_grains() {
  int n = 0;
  for (int i = 0; i < kMaxGrains; ++i) n += grains[i].active() ? 1 : 0;
  return n;
}

// Load `len` samples the host wrote into cg_staging(). With nothing sounding the
// swap is immediate; otherwise the cloud fades out, swaps, and fades back in.
// Staging is only read when the fade-out completes, so a newer load arriving
// mid-fade simply replaces the pending one.
CG_EXPORT(cg_load) void cg_load(int len, int immediate) {
  if (len < 0) len = 0;
  if (immediate || !source_len) {
    CommitSource(len);
    pending_len = -1;
    return;
  }
  pending_len = len;
  fade_state = FADE_OUT;
}

// Non-finite values keep the previous setting.
CG_EXPORT(cg_set_params) void cg_set_params(
    float size, float density, float scan_rate, float win_start, float win_end,
    float jitter, float window_shape, float spread, int reverse) {
  params.size = clampf(finite_or(size, params.size), kMinGrain, kMaxGrain);
  params.density = clampf(finite_or(density, params.density), 0.0f, kMaxGrains);
  params.scan_rate = clampf(finite_or(scan_rate, params.scan_rate), 0.0f, 16.0f);
  float a = clampf(finite_or(win_start, params.win_start), 0.0f, 1.0f);
  float b = clampf(finite_or(win_end, params.win_end), 0.0f, 1.0f);
  if (b < a) { float t = a; a = b; b = t; }
  params.win_start = a;
  params.win_end = b;
  params.jitter = clampf(finite_or(jitter, params.jitter), 0.0f, 1.0f);
  params.window_shape = clampf(finite_or(window_shape, params.window_shape), 0.0f, 1.0f);
  params.spread = clampf(finite_or(spread, params.spread), 0.0f, 1.0f);
  params.reverse = reverse ? 1 : 0;
}

// Pitch (semitones from the source's own pitch) for grains that start from now.
// Sounding grains keep theirs, as on the module.
CG_EXPORT(cg_set_pitch) void cg_set_pitch(float semitones) {
  pitch = clampf(finite_or(semitones, pitch), -48.0f, 48.0f);
}

// Seed one grain at the start of the next block (upstream's TRIG input), so a
// note's onset lines up with a grain instead of waiting for the grain clock.
CG_EXPORT(cg_trigger) void cg_trigger() { trigger_pending = true; }

// Drop every sounding grain (stop / seek). Leaves the source loaded.
CG_EXPORT(cg_panic) void cg_panic() {
  if (fade_state == FADE_NONE) fade_state = FADE_OUT;
}

// Render exactly one 32-sample block into cg_out_l()/cg_out_r().
CG_EXPORT(cg_render) void cg_render() {
  PlayGrains();

  bool finite = true;
  for (int t = 0; t < kBlock; ++t) {
    float l = mix[2 * t], r = mix[2 * t + 1];
    if (!(l == l) || !(r == r) || isinf(l) || isinf(r)) { finite = false; break; }
    out_l[t] = l;
    out_r[t] = r;
  }
  if (!finite) {
    // Never expected from the upstream grain code; if it happens, drop the cloud
    // rather than let a NaN poison the lane's filters downstream.
    ++fault_count;
    ResetGrains();
    memset(out_l, 0, sizeof(out_l));
    memset(out_r, 0, sizeof(out_r));
  }

  if (fade_state != FADE_NONE) {
    const float step = 1.0f / static_cast<float>(kFadeSamples);
    for (int t = 0; t < kBlock; ++t) {
      if (fade_state == FADE_OUT) {
        fade -= step;
        if (fade < 0.0f) fade = 0.0f;
      } else {
        fade += step;
        if (fade > 1.0f) fade = 1.0f;
      }
      out_l[t] *= fade;
      out_r[t] *= fade;
    }
    if (fade_state == FADE_OUT && fade <= 0.0f) {
      if (pending_len >= 0) { CommitSource(pending_len); pending_len = -1; }
      else ResetGrains();
      fade_state = FADE_IN;
    } else if (fade_state == FADE_IN && fade >= 1.0f) {
      fade_state = FADE_NONE;
    }
  }
}
