// Leið Resonator — C ABI over the vendored Rings DSP (vendor/rings, MIT,
// Emilie Gillet). Compiled to a standalone wasm32 module with no imports by
// scripts/build-resonator.js, and natively by the reference harness in this
// directory. One module instance is one lane: every piece of mutable state
// below lives in that instance's linear memory, so lanes never share DSP state.
//
// Shape of the instrument:
//   - a pool of up to kMaxVoices monophonic rings::Part objects (polyphony 1
//     each), so simultaneous notes and per-note velocity are explicit;
//   - every strike takes an idle voice, else the oldest one (deterministic);
//   - velocity is a per-voice output gain, ramped across one block, so a new
//     note never rescales another voice's tail;
//   - the DSP runs at 48 kHz in upstream's fixed 24-sample blocks — the host
//     (public/worklets/resonator-processor.js) owns scheduling and resampling;
//   - model changes and panics fade out, reset the resonators, and fade back in,
//     rather than reinterpreting live DSP state.
//
// No allocation, no imports and no memory growth: everything is static.

#include <stdint.h>
#include <string.h>
#include <math.h>

#include "rings/dsp/dsp.h"
#include "rings/dsp/part.h"
#include "rings/dsp/patch.h"
#include "rings/dsp/performance_state.h"
#include "stmlib/utils/random.h"

#if defined(__wasm__)
#define RS_EXPORT(name) extern "C" __attribute__((export_name(#name)))
extern "C" void __wasm_call_ctors(void);
#else
#define RS_EXPORT(name) extern "C"
#endif

namespace {

const int kMaxVoices = 4;
const int kBlock = static_cast<int>(rings::kMaxBlockSize);   // 24
const int kNumModels = 3;             // modal, sympathetic strings, string
const int kFadeSamples = 240;         // 5 ms declick for model switch / panic
const int kMaxPendingStrikes = 16;
// A voice whose output stays below this for kIdleSamples stops being rendered
// until it is struck again. -90 dBFS on the Part's (limited, ~0.8 peak) output.
const float kIdleThreshold = 3.1623e-5f;
const int kIdleSamples = 48000 / 4;
// Mid/side width applied to Rings' two outputs. Mono sum is always out - aux,
// the same per-voice sum upstream uses when it dispatches polyphonic voices.
const float kStereoWidth = 0.7f;
// One-pole patch smoothing at the 2 kHz block rate (~15 ms time constant).
const float kPatchSmoothing = 0.0328f;

struct Voice {
  float gain;
  float target_gain;
  float note;
  uint32_t age;          // strike stamp — lowest is the oldest
  int32_t silent_samples;
  bool active;
  bool strike;           // excite on the next rendered block
};

struct PendingStrike {
  float note;
  float velocity;
};

enum FadeState { FADE_NONE, FADE_OUT, FADE_IN };

// Only the STRING_AND_REVERB model processes this buffer, and it is not exposed,
// but Part::Init needs somewhere to point its reverb. Shared on purpose: it is
// cleared at init and never written afterwards.
uint16_t reverb_buffer[32768];

rings::Part parts[kMaxVoices];
Voice voices[kMaxVoices];
PendingStrike pending[kMaxPendingStrikes];
int num_pending = 0;

int num_voices = 2;
int model = 0;
int pending_model = -1;
bool pending_reset = false;
FadeState fade_state = FADE_NONE;
float fade = 1.0f;
uint32_t strike_counter = 0;
uint32_t fault_count = 0;
bool ctors_done = false;

rings::Patch target_patch = { 0.4f, 0.5f, 0.6f, 0.4f };
rings::Patch patch = { 0.4f, 0.5f, 0.6f, 0.4f };

float silence[kBlock];
float voice_out[kBlock];
float voice_aux[kBlock];
float out_l[kBlock];
float out_r[kBlock];

inline float clamp01(float x, float fallback) {
  if (!(x == x) || isinf(x)) return fallback;   // NaN / inf from an import
  return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x);
}

void InitPart(int i) {
  // Part::Init leaves a few members (step_counter_, the render scratch buffers)
  // to whatever memory held; zero the object first so a fresh voice is fully
  // deterministic. Part has no virtuals — this is a plain block of floats/ints.
  memset(static_cast<void*>(&parts[i]), 0, sizeof(rings::Part));
  parts[i].Init(reverb_buffer);
  parts[i].set_polyphony(1);
  parts[i].set_model(static_cast<rings::ResonatorModel>(model));
}

void ResetVoice(int i) {
  InitPart(i);
  Voice& v = voices[i];
  v.gain = 0.0f;
  v.target_gain = 0.0f;
  v.note = 60.0f;
  v.age = 0;
  v.silent_samples = 0;
  v.active = false;
  v.strike = false;
}

void ResetAll() {
  for (int i = 0; i < kMaxVoices; ++i) ResetVoice(i);
}

int Allocate() {
  // Idle voice first (lowest index), else steal the oldest strike.
  for (int i = 0; i < num_voices; ++i) {
    if (!voices[i].active && !voices[i].strike) return i;
  }
  int oldest = 0;
  for (int i = 1; i < num_voices; ++i) {
    if (voices[i].age < voices[oldest].age) oldest = i;
  }
  return oldest;
}

int Strike(float note, float velocity) {
  int i = Allocate();
  Voice& v = voices[i];
  bool was_silent = !v.active && !v.strike;
  v.note = note;
  v.target_gain = velocity;
  if (was_silent) v.gain = velocity;   // nothing sounding to ramp from
  v.age = ++strike_counter;
  v.silent_samples = 0;
  v.active = true;
  v.strike = true;
  return i;
}

void FlushPending() {
  for (int i = 0; i < num_pending; ++i) Strike(pending[i].note, pending[i].velocity);
  num_pending = 0;
}

void SmoothPatch() {
  patch.structure  += kPatchSmoothing * (target_patch.structure  - patch.structure);
  patch.brightness += kPatchSmoothing * (target_patch.brightness - patch.brightness);
  patch.damping    += kPatchSmoothing * (target_patch.damping    - patch.damping);
  patch.position   += kPatchSmoothing * (target_patch.position   - patch.position);
}

}  // namespace

// Call once after instantiation. Seeds the (per-instance) noise generator the
// string exciter uses, so renders are reproducible for a given seed.
RS_EXPORT(rs_init) void rs_init(uint32_t seed) {
#if defined(__wasm__)
  if (!ctors_done) { __wasm_call_ctors(); ctors_done = true; }
#endif
  stmlib::Random::Seed(seed ? seed : 0x21);
  memset(silence, 0, sizeof(silence));
  memset(out_l, 0, sizeof(out_l));
  memset(out_r, 0, sizeof(out_r));
  num_pending = 0;
  pending_model = -1;
  pending_reset = false;
  fade_state = FADE_NONE;
  fade = 1.0f;
  strike_counter = 0;
  fault_count = 0;
  ResetAll();
}

RS_EXPORT(rs_block_size) int rs_block_size() { return kBlock; }
RS_EXPORT(rs_sample_rate) float rs_sample_rate() { return rings::kSampleRate; }
RS_EXPORT(rs_max_voices) int rs_max_voices() { return kMaxVoices; }
RS_EXPORT(rs_out_l) float* rs_out_l() { return out_l; }
RS_EXPORT(rs_out_r) float* rs_out_r() { return out_r; }
RS_EXPORT(rs_fault_count) uint32_t rs_fault_count() { return fault_count; }

// Voices beyond a shrunk pool keep ringing out; they just stop taking strikes.
RS_EXPORT(rs_set_voices) void rs_set_voices(int n) {
  num_voices = n < 1 ? 1 : (n > kMaxVoices ? kMaxVoices : n);
}

RS_EXPORT(rs_set_patch) void rs_set_patch(
    float structure, float brightness, float damping, float position,
    int immediate) {
  target_patch.structure  = clamp01(structure,  target_patch.structure);
  target_patch.brightness = clamp01(brightness, target_patch.brightness);
  target_patch.damping    = clamp01(damping,    target_patch.damping);
  target_patch.position   = clamp01(position,   target_patch.position);
  if (immediate) patch = target_patch;
}

// Switching model resets every resonator (upstream re-inits them on a model
// change anyway); fade out first so the reset is inaudible.
RS_EXPORT(rs_set_model) void rs_set_model(int m, int immediate) {
  if (m < 0 || m >= kNumModels) return;
  if (immediate) {
    model = m;
    pending_model = -1;
    ResetAll();
    return;
  }
  if (m == model && pending_model < 0) return;
  pending_model = m;
  if (fade_state != FADE_OUT) fade_state = FADE_OUT;
}

// Silence everything: drop pending strikes, fade out, reset.
RS_EXPORT(rs_panic) void rs_panic() {
  num_pending = 0;
  pending_reset = true;
  fade_state = FADE_OUT;
}

// Strike a note (fractional MIDI) at velocity 0..1 on the next block. Returns the
// voice index, -1 when deferred behind a fade, -2 when rejected.
RS_EXPORT(rs_trigger) int rs_trigger(float note, float velocity) {
  if (!(note == note) || isinf(note)) return -2;
  if (note < 12.0f) note = 12.0f;
  if (note > 120.0f) note = 120.0f;
  velocity = clamp01(velocity, 1.0f);
  if (fade_state == FADE_OUT) {
    if (pending_reset) return -2;          // a panic cancels, it doesn't defer
    if (num_pending >= kMaxPendingStrikes) return -2;
    pending[num_pending].note = note;
    pending[num_pending].velocity = velocity;
    ++num_pending;
    return -1;
  }
  return Strike(note, velocity);
}

RS_EXPORT(rs_active_voices) int rs_active_voices() {
  int n = 0;
  for (int i = 0; i < kMaxVoices; ++i) n += (voices[i].active || voices[i].strike) ? 1 : 0;
  return n;
}

RS_EXPORT(rs_voice_note) float rs_voice_note(int i) {
  return (i >= 0 && i < kMaxVoices) ? voices[i].note : -1.0f;
}

RS_EXPORT(rs_voice_active) int rs_voice_active(int i) {
  return (i >= 0 && i < kMaxVoices && (voices[i].active || voices[i].strike)) ? 1 : 0;
}

// Render exactly one 24-sample block into rs_out_l()/rs_out_r().
RS_EXPORT(rs_render) void rs_render() {
  SmoothPatch();
  memset(out_l, 0, sizeof(out_l));
  memset(out_r, 0, sizeof(out_r));

  for (int i = 0; i < kMaxVoices; ++i) {
    Voice& v = voices[i];
    if (!v.active && !v.strike) continue;

    rings::PerformanceState ps;
    ps.strum = v.strike;
    ps.internal_exciter = true;
    ps.internal_strum = false;
    ps.internal_note = false;
    ps.tonic = 0.0f;
    ps.note = v.note;
    ps.fm = 0.0f;
    ps.chord = 0;
    v.strike = false;

    parts[i].Process(ps, patch, silence, voice_out, voice_aux, kBlock);

    float peak = 0.0f;
    bool finite = true;
    float g = v.gain;
    const float dg = (v.target_gain - v.gain) / static_cast<float>(kBlock);
    for (int n = 0; n < kBlock; ++n) {
      const float o = voice_out[n];
      const float a = voice_aux[n];
      if (!(o == o) || !(a == a) || isinf(o) || isinf(a)) { finite = false; break; }
      const float ao = fabsf(o);
      const float aa = fabsf(a);
      if (ao > peak) peak = ao;
      if (aa > peak) peak = aa;
      g += dg;
      const float mid = 0.5f * (o - a);
      const float side = 0.5f * (o + a) * kStereoWidth;
      out_l[n] += g * (mid + side);
      out_r[n] += g * (mid - side);
    }
    if (!finite) {
      // Never expected from the upstream DSP; if it happens, drop the voice rather
      // than let a NaN poison the lane's filters downstream.
      ++fault_count;
      ResetVoice(i);
      continue;
    }
    v.gain = v.target_gain;
    if (peak < kIdleThreshold) {
      v.silent_samples += kBlock;
      if (v.silent_samples >= kIdleSamples) v.active = false;
    } else {
      v.silent_samples = 0;
    }
  }

  if (fade_state != FADE_NONE) {
    const float step = 1.0f / static_cast<float>(kFadeSamples);
    for (int n = 0; n < kBlock; ++n) {
      if (fade_state == FADE_OUT) {
        fade -= step;
        if (fade <= 0.0f) fade = 0.0f;
      } else {
        fade += step;
        if (fade >= 1.0f) fade = 1.0f;
      }
      out_l[n] *= fade;
      out_r[n] *= fade;
    }
    if (fade_state == FADE_OUT && fade <= 0.0f) {
      if (pending_model >= 0) { model = pending_model; pending_model = -1; }
      ResetAll();
      pending_reset = false;
      FlushPending();
      fade_state = FADE_IN;
    } else if (fade_state == FADE_IN && fade >= 1.0f) {
      fade_state = FADE_NONE;
    }
  }
}
