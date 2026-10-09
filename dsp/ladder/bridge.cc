// Leið Analog lane filter — C ABI over DaisySP's LadderFilter (vendor/daisysp,
// MIT; Huovilainen model by Richard van Hoesel, modes by Infrasonic Audio).
// Compiled to a standalone wasm32 module with no imports by
// scripts/build_ladder.js, and natively by reference.cc. One module instance is
// one lane's Analog filter: every piece of mutable state below lives in that
// instance's linear memory, so lanes never share DSP state.
//
// What is Leið's (the upstream class is used unmodified):
//   - two independent channel states (left/right). A mono input is duplicated
//     into both channels explicitly; a missing input is zeros, which still
//     advances the filter (a self-oscillating filter keeps ringing);
//   - every filter object is value-initialised before Init: upstream's Init
//     calls SetPassbandGain, which reads drive_ before its first assignment;
//   - cutoff is clamped to [20, min(20000, 0.425 × rate)] (upstream clamps to
//     [5, 0.425 × rate]), resonance to [0, 1.8], drive to [0, 4]. Nonfinite
//     parameter values are ignored (the last good value stays);
//   - parameters arrive as per-sample arrays (the worklet's AudioParams) and the
//     coefficients are recomputed only when a value changes;
//   - a response change crossfades linearly over `fade` samples between the old
//     and new response. Upstream's six responses are weightings of the same four
//     ladder stages, so the outgoing response runs on an exact copy of the live
//     filter (same state, same input, same parameters): the two branches differ
//     only in their output weighting and nothing is re-initialised mid-note;
//   - a nonfinite output resets both channels and outputs silence for that
//     sample; ld_fault_count() reports how often.
//
// Passband compensation stays at upstream's initial 0.5.
//
// No allocation, no imports and no memory growth: everything is static.

#include <stdint.h>
#include <string.h>
#include <math.h>

#include "Filters/ladder.h"

#if defined(__wasm__)
#define LD_EXPORT(name) extern "C" __attribute__((export_name(#name)))
extern "C" void __wasm_call_ctors(void);
#else
#define LD_EXPORT(name) extern "C"
#endif

using daisysp::LadderFilter;

namespace {

const int kAbiVersion = 1;
const int kMaxFrames = 128;
const float kMinCutoff = 20.0f;
const float kMaxCutoff = 20000.0f;
const float kMaxResonance = 1.8f;
const float kMaxDrive = 4.0f;
const float kPassbandGain = 0.5f;

enum Flags {
  kStereoInput = 1,
  kFreqPerSample = 2,
  kResPerSample = 4,
  kDrivePerSample = 8,
};

float in_l[kMaxFrames];
float in_r[kMaxFrames];
float out_l[kMaxFrames];
float out_r[kMaxFrames];
float freq_buf[kMaxFrames];
float res_buf[kMaxFrames];
float drive_buf[kMaxFrames];

LadderFilter live[2];     // the current response
LadderFilter fading[2];   // the outgoing response during a crossfade

float sample_rate = 48000.0f;
float max_cutoff = kMaxCutoff;
float cur_freq = kMaxCutoff;
float cur_res = 0.2f;
float cur_drive = 1.0f;
int cur_mode = 0;
int fade_len = 0;
int fade_pos = 0;
int fault_count = 0;
bool ctors_done = false;

inline float Clamp(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

LadderFilter::FilterMode ModeOf(int mode) {
  switch (mode) {
    case 1: return LadderFilter::FilterMode::LP12;
    case 2: return LadderFilter::FilterMode::BP24;
    case 3: return LadderFilter::FilterMode::BP12;
    case 4: return LadderFilter::FilterMode::HP24;
    case 5: return LadderFilter::FilterMode::HP12;
    default: return LadderFilter::FilterMode::LP24;
  }
}

void InitFilter(LadderFilter& f) {
  f = LadderFilter{};
  f.Init(sample_rate);
  f.SetPassbandGain(kPassbandGain);
  f.SetFilterMode(ModeOf(cur_mode));
  f.SetFreq(cur_freq);
  f.SetRes(cur_res);
  f.SetInputDrive(cur_drive);
}

void ResetAll() {
  InitFilter(live[0]);
  InitFilter(live[1]);
  fade_len = fade_pos = 0;
}

inline void ApplyFreq(float v) {
  if (!isfinite(v)) return;
  v = Clamp(v, kMinCutoff, max_cutoff);
  if (v == cur_freq) return;
  cur_freq = v;
  live[0].SetFreq(v); live[1].SetFreq(v);
  if (fade_len) { fading[0].SetFreq(v); fading[1].SetFreq(v); }
}

inline void ApplyRes(float v) {
  if (!isfinite(v)) return;
  v = Clamp(v, 0.0f, kMaxResonance);
  if (v == cur_res) return;
  cur_res = v;
  live[0].SetRes(v); live[1].SetRes(v);
  if (fade_len) { fading[0].SetRes(v); fading[1].SetRes(v); }
}

inline void ApplyDrive(float v) {
  if (!isfinite(v)) return;
  v = Clamp(v, 0.0f, kMaxDrive);
  if (v == cur_drive) return;
  cur_drive = v;
  live[0].SetInputDrive(v); live[1].SetInputDrive(v);
  if (fade_len) { fading[0].SetInputDrive(v); fading[1].SetInputDrive(v); }
}

}  // namespace

LD_EXPORT(ld_abi_version) int ld_abi_version() { return kAbiVersion; }
LD_EXPORT(ld_max_frames) int ld_max_frames() { return kMaxFrames; }

LD_EXPORT(ld_in_l) float* ld_in_l() { return in_l; }
LD_EXPORT(ld_in_r) float* ld_in_r() { return in_r; }
LD_EXPORT(ld_out_l) float* ld_out_l() { return out_l; }
LD_EXPORT(ld_out_r) float* ld_out_r() { return out_r; }
LD_EXPORT(ld_freq) float* ld_freq() { return freq_buf; }
LD_EXPORT(ld_res) float* ld_res() { return res_buf; }
LD_EXPORT(ld_drive) float* ld_drive() { return drive_buf; }

// The effective cutoff ceiling at this sample rate.
LD_EXPORT(ld_max_cutoff) float ld_max_cutoff() { return max_cutoff; }
LD_EXPORT(ld_fault_count) int ld_fault_count() { return fault_count; }

LD_EXPORT(ld_init) void ld_init(float rate) {
#if defined(__wasm__)
  if (!ctors_done) { __wasm_call_ctors(); ctors_done = true; }
#endif
  sample_rate = (isfinite(rate) && rate > 1000.0f) ? rate : 48000.0f;
  float ceiling = 0.425f * sample_rate;
  max_cutoff = ceiling < kMaxCutoff ? ceiling : kMaxCutoff;
  cur_freq = max_cutoff;
  cur_res = 0.2f;
  cur_drive = 1.0f;
  cur_mode = 0;
  fault_count = 0;
  memset(in_l, 0, sizeof(in_l)); memset(in_r, 0, sizeof(in_r));
  memset(out_l, 0, sizeof(out_l)); memset(out_r, 0, sizeof(out_r));
  ResetAll();
}

// Clears the filter state (silences self-oscillation); keeps parameters and mode.
LD_EXPORT(ld_reset) void ld_reset() { ResetAll(); }

// Sets cutoff/resonance/drive immediately (no ramp), e.g. before the first block.
LD_EXPORT(ld_set_params) void ld_set_params(float freq, float res, float drive) {
  ApplyFreq(freq); ApplyRes(res); ApplyDrive(drive);
}

// 0 LP24, 1 LP12, 2 BP24, 3 BP12, 4 HP24, 5 HP12. `fade` samples of linear
// crossfade from the current response (0 switches immediately).
LD_EXPORT(ld_set_mode) void ld_set_mode(int mode, int fade) {
  if (mode < 0 || mode > 5 || mode == cur_mode) return;
  if (fade > 0) {
    fading[0] = live[0];
    fading[1] = live[1];
    fade_len = fade;
    fade_pos = 0;
  } else {
    fade_len = fade_pos = 0;
  }
  cur_mode = mode;
  live[0].SetFilterMode(ModeOf(mode));
  live[1].SetFilterMode(ModeOf(mode));
}

LD_EXPORT(ld_mode) int ld_mode() { return cur_mode; }

// Filters `frames` (≤ ld_max_frames) samples of in_l/in_r into out_l/out_r.
// Parameter arrays are read per sample when their flag is set, else index 0.
LD_EXPORT(ld_process) void ld_process(int frames, int flags) {
  if (frames < 0) frames = 0;
  if (frames > kMaxFrames) frames = kMaxFrames;
  const bool stereo = flags & kStereoInput;
  const bool f_ps = flags & kFreqPerSample;
  const bool r_ps = flags & kResPerSample;
  const bool d_ps = flags & kDrivePerSample;
  if (!f_ps) ApplyFreq(freq_buf[0]);
  if (!r_ps) ApplyRes(res_buf[0]);
  if (!d_ps) ApplyDrive(drive_buf[0]);
  for (int i = 0; i < frames; ++i) {
    if (f_ps) ApplyFreq(freq_buf[i]);
    if (r_ps) ApplyRes(res_buf[i]);
    if (d_ps) ApplyDrive(drive_buf[i]);
    const float l = in_l[i];
    const float r = stereo ? in_r[i] : l;
    float yl = live[0].Process(l);
    float yr = live[1].Process(r);
    if (fade_len) {
      const float g = static_cast<float>(fade_pos + 1) / static_cast<float>(fade_len);
      const float ol = fading[0].Process(l);
      const float orr = fading[1].Process(r);
      yl = ol + (yl - ol) * g;
      yr = orr + (yr - orr) * g;
      if (++fade_pos >= fade_len) fade_len = fade_pos = 0;
    }
    if (!isfinite(yl) || !isfinite(yr)) {
      ++fault_count;
      ResetAll();
      yl = yr = 0.0f;
    }
    out_l[i] = yl;
    out_r[i] = yr;
  }
}
