// Leið Macro — C ABI over the vendored Plaits DSP (vendor/plaits, MIT,
// Emilie Gillet). Compiled to a standalone wasm32 module with no imports by
// scripts/build_macro.js, and natively by the reference harness in this
// directory. One module instance is one lane: every piece of mutable state
// below lives in that instance's linear memory, so lanes never share DSP state.
//
// Shape of the instrument:
//   - a pool of up to kMaxVoices plaits::Voice objects (each is monophonic, like
//     the module), each with its own 16 KB engine RAM, so overlapping notes and
//     chords work and every note has its own velocity;
//   - a note is the module with TRIG and V/OCT patched and LEVEL unpatched: the
//     trigger is held high for the note's length (a gate), which pings the
//     internal low-pass gate and decay envelope exactly as on the hardware;
//   - every note takes an idle voice, else the oldest one (deterministic);
//   - velocity is a per-voice output gain, ramped across one block;
//   - one patch is shared by every voice: the knobs, the three attenuverters and
//     the LPG decay/colour settings, smoothed per block like a pot;
//   - the DSP runs at 48 kHz in upstream's 12-sample blocks. The host
//     (public/worklets/macro-processor.js) owns scheduling and resampling;
//   - engine changes and panics fade out, then switch, then fade back in.
//
// Deviations from the module, all outside the vendored code:
//   - Tuning. Upstream tunes against the hardware's real 47872.34 Hz frame clock
//     (plaits/dsp/dsp.h). Rendered at a true 48 kHz it would play 4.6 cents
//     sharp, so every note is offset by 12 * log2(47872.34 / 48000).
//   - OUT and AUX are blended into one output (mc_set_aux) instead of two jacks.
//   - Upstream delays TRIG (~1 ms) so the pitch CV can settle first. A voice's
//     note changes one block before its delayed edge, so a stolen voice's tail
//     doesn't jump in pitch early. mc_trigger_latency() reports the delay so the
//     host can schedule notes ahead of it.
//
// No allocation, no imports and no memory growth: everything is static.

#include <stdint.h>
#include <string.h>
#include <math.h>

#include "plaits/dsp/dsp.h"
#include "plaits/dsp/voice.h"
#include "stmlib/utils/buffer_allocator.h"
#include "stmlib/utils/random.h"

#if defined(__wasm__)
#define MC_EXPORT(name) extern "C" __attribute__((export_name(#name)))
extern "C" void __wasm_call_ctors(void);
#else
#define MC_EXPORT(name) extern "C"
#endif

namespace {

const int kMaxVoices = 4;
const int kBlock = static_cast<int>(plaits::kBlockSize);    // 12
const float kSampleRate = plaits::kSampleRate;              // 48000
const int kNumEngines = plaits::kMaxEngines;                // 24
const int kVoiceRam = 16384;                                // plaits.cc shared_buffer
const int kFadeSamples = 240;                               // 5 ms declick
const int kMaxPendingNotes = 16;
// Upstream reads TRIG through a delay line at kTriggerDelay (voice.h). Its
// Write() moves the pointer after writing, so Read(kTriggerDelay) returns the
// value written kTriggerDelay - 1 blocks ago: a note's rising edge is seen this
// many blocks after the block it was set on.
const int kTriggerDelayBlocks = plaits::kTriggerDelay - 1;   // 4 blocks, 1 ms
// The voice's note moves one block before that edge. Voice averages the note
// with the previous block's, so by the edge block it has fully settled.
const int kNoteCountdownBlocks = kTriggerDelayBlocks - 1;
// A voice whose output stays below this for kIdleSamples, with its gate low,
// stops being rendered until its next note. The int16 output stage never goes
// fully to zero (it rounds with a +1 LSB offset), so this sits above 1 LSB.
const float kIdleThreshold = 1.0e-4f;
const int kIdleSamples = 48000 / 4;
// 12 * log2(47872.34 / 48000): see the header comment.
const float kTuningOffset = -0.0460916f;
// One-pole patch smoothing at the 4 kHz block rate (~6 ms time constant).
const float kPatchSmoothing = 0.04f;
const float kMaxTranspose = 24.0f;

struct Voice {
  float gain;
  float target_gain;
  float note;            // the note the voice is currently playing
  float next_note;       // applied when note_countdown reaches 0
  int32_t note_countdown;
  uint32_t age;          // note stamp — lowest is the oldest
  int32_t silent_samples;
  bool active;
  int32_t low_blocks;    // force the trigger low this many blocks (retrigger)
  int32_t gate;          // samples the trigger stays high; < 0 until mc_release
  bool gate_open;
};

struct PendingNote {
  float note;
  float velocity;
  int32_t hold;
};

struct Settings {
  float harmonics, timbre, morph;
  float fm_amount, timbre_amount, morph_amount;
  float decay, colour;
  float transpose;
};

enum FadeState { FADE_NONE, FADE_OUT, FADE_IN };

char voice_ram[kMaxVoices][kVoiceRam];
stmlib::BufferAllocator allocators[kMaxVoices];
plaits::Voice dsp[kMaxVoices];
Voice voices[kMaxVoices];
PendingNote pending[kMaxPendingNotes];
int num_pending = 0;

int num_voices = 2;
int engine = 8;                 // bank 2's first engine: the classic VA
int pending_engine = -1;
bool pending_reset = false;
FadeState fade_state = FADE_NONE;
float fade = 1.0f;
float aux_mix = 0.0f;
uint32_t note_counter = 0;
uint32_t fault_count = 0;
bool ctors_done = false;

Settings target = { 0.5f, 0.5f, 0.5f, 0.0f, 0.0f, 0.0f, 0.5f, 0.5f, 0.0f };
Settings current = target;

plaits::Voice::Frame frames[kBlock];
float out[kBlock];

inline bool finite(float x) { return x == x && !isinf(x); }

inline float clampRange(float x, float lo, float hi, float fallback) {
  if (!finite(x)) return fallback;
  return x < lo ? lo : (x > hi ? hi : x);
}

inline float clamp01(float x, float fallback) { return clampRange(x, 0.0f, 1.0f, fallback); }

void InitVoice(int i) {
  allocators[i].Init(voice_ram[i], kVoiceRam);
  dsp[i].Init(&allocators[i]);
  Voice& v = voices[i];
  v.gain = 0.0f;
  v.target_gain = 0.0f;
  v.note = 60.0f;
  v.next_note = 60.0f;
  v.note_countdown = -1;
  v.age = 0;
  v.silent_samples = 0;
  v.active = false;
  v.low_blocks = 0;
  v.gate = 0;
  v.gate_open = false;
}

void ResetAll() {
  // The engine RAM holds delay lines and other state the engines don't all
  // clear in Reset(); zero it so a reset voice starts from the same place a
  // fresh instance does.
  memset(voice_ram, 0, sizeof(voice_ram));
  for (int i = 0; i < kMaxVoices; ++i) InitVoice(i);
}

int Allocate() {
  // Idle voice first (lowest index), else steal the oldest note.
  for (int i = 0; i < num_voices; ++i) {
    if (!voices[i].active) return i;
  }
  int oldest = 0;
  for (int i = 1; i < num_voices; ++i) {
    if (voices[i].age < voices[oldest].age) oldest = i;
  }
  return oldest;
}

int Start(float note, float velocity, int32_t hold) {
  int i = Allocate();
  Voice& v = voices[i];
  const bool was_idle = !v.active;
  v.target_gain = velocity;
  if (was_idle) {
    // Nothing sounding: jump straight to the new note and level.
    v.gain = velocity;
    v.note = note;
    v.next_note = note;
    v.note_countdown = -1;
  } else {
    v.next_note = note;
    v.note_countdown = kNoteCountdownBlocks;
  }
  // A voice whose trigger is already high needs a low block for the module to
  // see a new rising edge.
  v.low_blocks = v.gate_open ? 1 : 0;
  v.gate = hold;
  v.gate_open = true;
  v.age = ++note_counter;
  v.silent_samples = 0;
  v.active = true;
  return i;
}

void FlushPending() {
  for (int i = 0; i < num_pending; ++i) Start(pending[i].note, pending[i].velocity, pending[i].hold);
  num_pending = 0;
}

void SmoothPatch() {
  Settings& c = current;
  const Settings& t = target;
  const float k = kPatchSmoothing;
  c.harmonics += k * (t.harmonics - c.harmonics);
  c.timbre += k * (t.timbre - c.timbre);
  c.morph += k * (t.morph - c.morph);
  c.fm_amount += k * (t.fm_amount - c.fm_amount);
  c.timbre_amount += k * (t.timbre_amount - c.timbre_amount);
  c.morph_amount += k * (t.morph_amount - c.morph_amount);
  c.decay += k * (t.decay - c.decay);
  c.colour += k * (t.colour - c.colour);
  c.transpose += k * (t.transpose - c.transpose);
}

}  // namespace

// Call once after instantiation. Seeds stmlib's random generator (the noise,
// particle, swarm and drum engines use it), so renders are reproducible for a
// given seed.
MC_EXPORT(mc_init) void mc_init(uint32_t seed) {
#if defined(__wasm__)
  if (!ctors_done) { __wasm_call_ctors(); ctors_done = true; }
#endif
  stmlib::Random::Seed(seed ? seed : 0x21);
  memset(out, 0, sizeof(out));
  num_pending = 0;
  pending_engine = -1;
  pending_reset = false;
  fade_state = FADE_NONE;
  fade = 1.0f;
  note_counter = 0;
  fault_count = 0;
  ResetAll();
}

MC_EXPORT(mc_block_size) int mc_block_size() { return kBlock; }
MC_EXPORT(mc_sample_rate) float mc_sample_rate() { return kSampleRate; }
MC_EXPORT(mc_max_voices) int mc_max_voices() { return kMaxVoices; }
MC_EXPORT(mc_num_engines) int mc_num_engines() { return kNumEngines; }
MC_EXPORT(mc_trigger_latency) int mc_trigger_latency() { return kTriggerDelayBlocks * kBlock; }
MC_EXPORT(mc_out) float* mc_out() { return out; }
MC_EXPORT(mc_fault_count) uint32_t mc_fault_count() { return fault_count; }

// Voices beyond a shrunk pool keep ringing out; they just stop taking notes.
MC_EXPORT(mc_set_voices) void mc_set_voices(int n) {
  num_voices = n < 1 ? 1 : (n > kMaxVoices ? kMaxVoices : n);
}

// The knobs (0..1), attenuverters (-1..1), LPG decay and colour (0..1) and a
// transpose in semitones (the FREQUENCY knob, +-24). Smoothed unless immediate.
MC_EXPORT(mc_set_patch) void mc_set_patch(
    float harmonics, float timbre, float morph,
    float fm_amount, float timbre_amount, float morph_amount,
    float decay, float colour, float transpose, int immediate) {
  Settings& t = target;
  t.harmonics = clamp01(harmonics, t.harmonics);
  t.timbre = clamp01(timbre, t.timbre);
  t.morph = clamp01(morph, t.morph);
  t.fm_amount = clampRange(fm_amount, -1.0f, 1.0f, t.fm_amount);
  t.timbre_amount = clampRange(timbre_amount, -1.0f, 1.0f, t.timbre_amount);
  t.morph_amount = clampRange(morph_amount, -1.0f, 1.0f, t.morph_amount);
  t.decay = clamp01(decay, t.decay);
  t.colour = clamp01(colour, t.colour);
  t.transpose = clampRange(transpose, -kMaxTranspose, kMaxTranspose, t.transpose);
  if (immediate) current = target;
}

// 0 = the module's OUT, 1 = its AUX.
MC_EXPORT(mc_set_aux) void mc_set_aux(float mix) {
  aux_mix = clamp01(mix, aux_mix);
}

// Switching engine fades out first, so the engine's Reset() is inaudible.
MC_EXPORT(mc_set_engine) void mc_set_engine(int e, int immediate) {
  if (e < 0 || e >= kNumEngines) return;
  if (immediate) {
    engine = e;
    pending_engine = -1;
    ResetAll();
    return;
  }
  if (e == engine && pending_engine < 0) return;
  pending_engine = e;
  fade_state = FADE_OUT;
}

// Silence everything: drop pending notes, fade out, reset.
MC_EXPORT(mc_panic) void mc_panic() {
  num_pending = 0;
  pending_reset = true;
  fade_state = FADE_OUT;
}

// Start a note (fractional MIDI) at velocity 0..1 on the next block, with its
// trigger held for `hold` DSP samples (< 0: until mc_release). Returns the voice
// index, -1 when deferred behind a fade, -2 when rejected.
MC_EXPORT(mc_trigger_held) int mc_trigger_held(float note, float velocity, int32_t hold) {
  if (!finite(note)) return -2;
  if (note < 0.0f) note = 0.0f;
  if (note > 120.0f) note = 120.0f;
  velocity = clamp01(velocity, 1.0f);
  if (hold == 0) hold = 1;                 // a zero-length note still triggers
  if (fade_state == FADE_OUT) {
    if (pending_reset) return -2;          // a panic cancels, it doesn't defer
    if (num_pending >= kMaxPendingNotes) return -2;
    pending[num_pending].note = note;
    pending[num_pending].velocity = velocity;
    pending[num_pending].hold = hold;
    ++num_pending;
    return -1;
  }
  return Start(note, velocity, hold);
}

MC_EXPORT(mc_trigger) int mc_trigger(float note, float velocity) {
  return mc_trigger_held(note, velocity, -1);
}

// Lower the trigger of every voice playing `note` (within half a semitone); a
// negative note lowers them all. Engines that ring on their own keep ringing.
MC_EXPORT(mc_release) void mc_release(float note) {
  if (!finite(note)) return;
  for (int i = 0; i < kMaxVoices; ++i) {
    Voice& v = voices[i];
    if (!v.active || !v.gate_open) continue;
    const float playing = v.note_countdown >= 0 ? v.next_note : v.note;
    if (note < 0.0f || fabsf(playing - note) < 0.5f) v.gate = 1;
  }
  for (int i = 0; i < num_pending; ++i) {
    if (note < 0.0f || fabsf(pending[i].note - note) < 0.5f) pending[i].hold = 1;
  }
}

MC_EXPORT(mc_active_voices) int mc_active_voices() {
  int n = 0;
  for (int i = 0; i < kMaxVoices; ++i) n += voices[i].active ? 1 : 0;
  return n;
}

MC_EXPORT(mc_voice_note) float mc_voice_note(int i) {
  if (i < 0 || i >= kMaxVoices) return -1.0f;
  return voices[i].note_countdown >= 0 ? voices[i].next_note : voices[i].note;
}

MC_EXPORT(mc_voice_active) int mc_voice_active(int i) {
  return (i >= 0 && i < kMaxVoices && voices[i].active) ? 1 : 0;
}

// The engine the voices render (after any pending switch completes).
MC_EXPORT(mc_engine) int mc_engine() { return engine; }

// Render exactly one 12-sample block into mc_out().
MC_EXPORT(mc_render) void mc_render() {
  SmoothPatch();
  memset(out, 0, sizeof(out));

  plaits::Patch patch;
  patch.harmonics = current.harmonics;
  patch.timbre = current.timbre;
  patch.morph = current.morph;
  patch.frequency_modulation_amount = current.fm_amount;
  patch.timbre_modulation_amount = current.timbre_amount;
  patch.morph_modulation_amount = current.morph_amount;
  patch.engine = engine;
  patch.decay = current.decay;
  patch.lpg_colour = current.colour;

  const float out_weight = 1.0f - aux_mix;
  const float aux_weight = aux_mix;

  for (int i = 0; i < kMaxVoices; ++i) {
    Voice& v = voices[i];
    if (!v.active) continue;

    if (v.note_countdown >= 0 && v.note_countdown-- == 0) {
      v.note = v.next_note;
      v.note_countdown = -1;
    }

    // The trigger for this block: forced low for a retrigger, else the gate.
    float trigger = 0.0f;
    if (v.low_blocks > 0) {
      --v.low_blocks;
    } else if (v.gate_open) {
      trigger = 1.0f;
      if (v.gate > 0) {
        v.gate -= kBlock;
        if (v.gate <= 0) { v.gate = 0; v.gate_open = false; }
      }
    }

    // patch.note + modulations.note is the pitch; the module's FREQUENCY knob
    // and its V/OCT input. Here: transpose + the lane note.
    patch.note = current.transpose + kTuningOffset;

    plaits::Modulations m;
    memset(&m, 0, sizeof(m));
    m.note = v.note;
    m.trigger = trigger;
    m.trigger_patched = true;

    dsp[i].Render(patch, m, frames, kBlock);

    float peak = 0.0f;
    float g = v.gain;
    const float dg = (v.target_gain - v.gain) / static_cast<float>(kBlock);
    for (int n = 0; n < kBlock; ++n) {
      // The int16 output stage inverts (post_gain is negative); undo it.
      const float o = static_cast<float>(frames[n].out) * (-1.0f / 32768.0f);
      const float a = static_cast<float>(frames[n].aux) * (-1.0f / 32768.0f);
      const float s = out_weight * o + aux_weight * a;
      const float as = fabsf(s);
      if (as > peak) peak = as;
      g += dg;
      out[n] += g * s;
    }
    v.gain = v.target_gain;

    if (peak < kIdleThreshold && !v.gate_open && v.low_blocks == 0) {
      v.silent_samples += kBlock;
      if (v.silent_samples >= kIdleSamples) v.active = false;
    } else {
      v.silent_samples = 0;
    }
  }

  for (int n = 0; n < kBlock; ++n) {
    if (!finite(out[n])) {
      // Never expected: the output stage is int16. Kept so a host can tell.
      ++fault_count;
      memset(out, 0, sizeof(out));
      break;
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
      out[n] *= fade;
    }
    if (fade_state == FADE_OUT && fade <= 0.0f) {
      if (pending_engine >= 0) { engine = pending_engine; pending_engine = -1; }
      ResetAll();
      pending_reset = false;
      FlushPending();
      fade_state = FADE_IN;
    } else if (fade_state == FADE_IN && fade >= 1.0f) {
      fade_state = FADE_NONE;
    }
  }
}
