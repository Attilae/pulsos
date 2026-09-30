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
//     rather than reinterpreting live DSP state;
//   - an optional per-voice ADSR (rs_set_envelope). Off, every note is a strike
//     that rings out on its own and the render path is exactly the envelope-less
//     one. On, the envelope scales the voice's output, drives a noise "bow" into
//     the resonator (Rings is built to be excited this way), and a note releases
//     after its hold time or on rs_release; the strike pulse becomes optional.
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
// Envelope segment limits, seconds. Attack has a floor so retriggering a
// ringing (stolen) voice ramps rather than steps its gain.
const float kMinAttack = 0.001f, kMaxAttack = 4.0f;
const float kMinDecay = 0.001f, kMaxDecay = 4.0f;
const float kMinRelease = 0.01f, kMaxRelease = 8.0f;
// Decay and release are exponential; a segment of time T falls by ~60 dB.
const float kEnvLn = 6.9078f;   // ln(1000)
// Below this a releasing voice is finished (-80 dB of its peak).
const float kEnvFloor = 1e-4f;
// Bow noise level into the resonator at bow = 1, per model (modal, sympathetic,
// string): the models respond very differently to a steady input. Calibrated so
// a fully bowed, sustained note sits near a strike's early RMS at the default
// patch (see README).
const float kBowGain[kNumModels] = { 0.15f, 0.06f, 0.15f };

enum EnvStage { ENV_IDLE, ENV_ATTACK, ENV_DECAY, ENV_SUSTAIN, ENV_RELEASE };

struct Voice {
  float gain;
  float target_gain;
  float note;
  uint32_t age;          // strike stamp — lowest is the oldest
  int32_t silent_samples;
  bool active;
  bool strike;           // excite on the next rendered block
  // Envelope. A voice follows the mode it was struck in, so switching the
  // envelope on or off never re-levels a note that is already sounding.
  bool enveloped;
  float env;
  int32_t stage;         // EnvStage
  int32_t hold;          // samples until auto-release; < 0 holds until rs_release
  uint32_t noise;        // per-voice xorshift32 state for the bow
};

struct PendingStrike {
  float note;
  float velocity;
  int32_t hold;
};

struct EnvSettings {
  bool enabled;
  float attack_inc;      // per-sample linear step
  float decay_coef;      // per-sample exponential factors
  float release_coef;
  float sustain;
  float bow;
  bool strike;
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

EnvSettings env_settings = { false, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, true };
uint32_t noise_seed = 1;

float silence[kBlock];
float excite[kBlock];
float env_gain[kBlock];
float voice_out[kBlock];
float voice_aux[kBlock];
float out_l[kBlock];
float out_r[kBlock];

inline float clamp01(float x, float fallback) {
  if (!(x == x) || isinf(x)) return fallback;   // NaN / inf from an import
  return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x);
}

inline float clampRange(float x, float lo, float hi, float fallback) {
  if (!(x == x) || isinf(x)) return fallback;
  return x < lo ? lo : (x > hi ? hi : x);
}

inline float SegmentCoef(float seconds) {
  return expf(-kEnvLn / (seconds * rings::kSampleRate));
}

// Uniform noise in [-1, 1) from a per-voice xorshift32.
inline float Noise(uint32_t& s) {
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  return static_cast<float>(static_cast<int32_t>(s)) * (1.0f / 2147483648.0f);
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
  v.enveloped = false;
  v.env = 0.0f;
  v.stage = ENV_IDLE;
  v.hold = -1;
  v.noise = noise_seed * 2654435761u + static_cast<uint32_t>(i) * 40503u + 1u;
  if (!v.noise) v.noise = 1;
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

int Strike(float note, float velocity, int32_t hold) {
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
  // Restart from the current level (a stolen voice ramps, it doesn't jump). A
  // voice that was ringing without an envelope counts as fully open.
  if (was_silent) v.env = 0.0f;
  else if (!v.enveloped) v.env = 1.0f;
  v.enveloped = env_settings.enabled;
  v.stage = ENV_ATTACK;
  v.hold = hold;
  return i;
}

void FlushPending() {
  for (int i = 0; i < num_pending; ++i) Strike(pending[i].note, pending[i].velocity, pending[i].hold);
  num_pending = 0;
}

// Advance voice `v`'s envelope over one block into env_gain[]. Returns false
// once a release has run out (the voice is finished).
bool RenderEnvelope(Voice& v) {
  const EnvSettings& e = env_settings;
  float env = v.env;
  int32_t stage = v.stage;
  int32_t hold = v.hold;
  for (int n = 0; n < kBlock; ++n) {
    if (hold > 0 && stage != ENV_RELEASE && --hold == 0) stage = ENV_RELEASE;
    switch (stage) {
      case ENV_ATTACK:
        env += e.attack_inc;
        if (env >= 1.0f) { env = 1.0f; stage = ENV_DECAY; }
        break;
      case ENV_DECAY:
        env = e.sustain + (env - e.sustain) * e.decay_coef;
        if (fabsf(env - e.sustain) < 1e-5f) { env = e.sustain; stage = ENV_SUSTAIN; }
        break;
      case ENV_SUSTAIN:
        env = e.sustain;
        break;
      case ENV_RELEASE:
        env *= e.release_coef;
        break;
      default:
        env = 0.0f;
        break;
    }
    env_gain[n] = env;
  }
  v.env = env;
  v.stage = stage;
  v.hold = hold;
  if (stage == ENV_RELEASE && env < kEnvFloor) return false;
  // Sustain at 0 is silent for good as well.
  if (stage == ENV_SUSTAIN && env <= 0.0f) return false;
  return true;
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
  noise_seed = seed ? seed : 0x21;
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
// Like rs_trigger, plus how long the note is held before it releases, in DSP
// samples (< 0: until rs_release). Only matters while the envelope is on.
RS_EXPORT(rs_trigger_held) int rs_trigger_held(float note, float velocity, int32_t hold) {
  if (!(note == note) || isinf(note)) return -2;
  if (note < 12.0f) note = 12.0f;
  if (note > 120.0f) note = 120.0f;
  velocity = clamp01(velocity, 1.0f);
  if (hold == 0) hold = 1;                 // a zero-length note still sounds
  if (fade_state == FADE_OUT) {
    if (pending_reset) return -2;          // a panic cancels, it doesn't defer
    if (num_pending >= kMaxPendingStrikes) return -2;
    pending[num_pending].note = note;
    pending[num_pending].velocity = velocity;
    pending[num_pending].hold = hold;
    ++num_pending;
    return -1;
  }
  return Strike(note, velocity, hold);
}

RS_EXPORT(rs_trigger) int rs_trigger(float note, float velocity) {
  return rs_trigger_held(note, velocity, -1);
}

// Start the release of every sounding voice on `note` (within half a semitone);
// a negative note releases them all. No effect while the envelope is off.
RS_EXPORT(rs_release) void rs_release(float note) {
  if (!(note == note) || isinf(note)) return;
  for (int i = 0; i < kMaxVoices; ++i) {
    Voice& v = voices[i];
    if (!(v.active || v.strike) || !v.enveloped || v.stage == ENV_RELEASE) continue;
    if (note < 0.0f || fabsf(v.note - note) < 0.5f) v.stage = ENV_RELEASE;
  }
  for (int i = 0; i < num_pending; ++i) {
    if (note < 0.0f || fabsf(pending[i].note - note) < 0.5f) pending[i].hold = 1;
  }
}

// Envelope and exciter settings, seconds / 0..1. Segment times, sustain and bow
// apply to sounding voices at once; switching the envelope on or off applies from
// the next strike (see Voice::enveloped).
RS_EXPORT(rs_set_envelope) void rs_set_envelope(
    int enabled, float attack, float decay, float sustain, float release,
    float bow, int strike) {
  EnvSettings& e = env_settings;
  e.enabled = enabled != 0;
  const float a = clampRange(attack, kMinAttack, kMaxAttack, 0.005f);
  e.attack_inc = 1.0f / (a * rings::kSampleRate);
  e.decay_coef = SegmentCoef(clampRange(decay, kMinDecay, kMaxDecay, 0.3f));
  e.release_coef = SegmentCoef(clampRange(release, kMinRelease, kMaxRelease, 1.5f));
  e.sustain = clamp01(sustain, 0.7f);
  e.bow = clamp01(bow, 0.0f);
  e.strike = strike != 0;
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

    const bool enveloped = v.enveloped;
    bool finished = false;
    const float* input = silence;
    if (enveloped) {
      finished = !RenderEnvelope(v);
      const float bow = env_settings.bow * kBowGain[model] * v.target_gain;
      if (bow > 0.0f) {
        for (int n = 0; n < kBlock; ++n) excite[n] = bow * env_gain[n] * Noise(v.noise);
        input = excite;
      }
    }

    rings::PerformanceState ps;
    ps.strum = v.strike && (!enveloped || env_settings.strike);
    ps.internal_exciter = true;
    ps.internal_strum = false;
    ps.internal_note = false;
    ps.tonic = 0.0f;
    ps.note = v.note;
    ps.fm = 0.0f;
    ps.chord = 0;
    v.strike = false;

    parts[i].Process(ps, patch, input, voice_out, voice_aux, kBlock);

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
      const float k = enveloped ? g * env_gain[n] : g;
      out_l[n] += k * (mid + side);
      out_r[n] += k * (mid - side);
    }
    if (!finite) {
      // Never expected from the upstream DSP; if it happens, drop the voice rather
      // than let a NaN poison the lane's filters downstream.
      ++fault_count;
      ResetVoice(i);
      continue;
    }
    v.gain = v.target_gain;
    if (finished) {
      // Released to silence: clear the resonator so the voice's next note
      // starts clean instead of reviving a tail the envelope had muted.
      ResetVoice(i);
      continue;
    }
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
