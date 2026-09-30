// Resonator instrument vocabulary — pure, server-safe definitions shared by the
// engine adapter (lib/resonatorVoice.js), the lane editors, song snapshots and
// the AI/MCP plan contract. No Tone, worklet or wasm imports here: soundSpecs.js
// re-exports this module and it is loaded by server code (see
// test/server-purity.test.js).
//
// The DSP is derived from Emilie Gillet's open-source Rings firmware (MIT; see
// vendor/rings). Its four timbre controls are normalized 0..1 exactly as the
// upstream Patch struct takes them; the lane stores them in its flat param map
// (trackADSRs) under the `resonator*` keys below.

// Order matters: `index` is the DSP's ResonatorModel enum value.
// Until the release gates in docs/rings-resonator-plan.md pass, the Resonator is
// offered (lane picker, AI/MCP plan vocabulary) only behind this flag. Songs that
// already use it play regardless. Written literally so Next inlines it client-side;
// server code (the MCP tools) reads the same variable at runtime.
export const RESONATOR_ENABLED = process.env.NEXT_PUBLIC_RESONATOR_ENABLED === 'true'

export const RESONATOR_MODELS = [
  { id: 'modal',       index: 0, label: 'Modal',       hint: 'Struck bars, bells and plates' },
  { id: 'sympathetic', index: 1, label: 'Sympathetic', hint: 'A plucked string with resonating neighbours' },
  { id: 'string',      index: 2, label: 'String',      hint: 'A single plucked string' },
]

export const RESONATOR_MODEL_IDS = RESONATOR_MODELS.map(m => m.id)

// `key` is the flat lane-param key; `planKey` the plan `tone` key.
export const RESONATOR_PARAMS = [
  {
    key: 'resonatorStructure', planKey: 'structure', label: 'Structure', default: 0.4,
    hint: 'Modal: inharmonic to harmonic partials. Sympathetic: chord of the neighbouring strings. String: stiffness and dispersion.',
  },
  {
    key: 'resonatorBrightness', planKey: 'brightness', label: 'Brightness', default: 0.55,
    hint: 'How much high-frequency content the strike and the resonator keep.',
  },
  {
    // The upstream name is kept, but the knob works like a decay control:
    // turning it up damps LESS, so notes ring longer.
    key: 'resonatorDamping', planKey: 'damping', label: 'Damping', default: 0.6,
    hint: 'Decay length. Higher values ring longer; low values are short and muted.',
  },
  {
    key: 'resonatorPosition', planKey: 'position', label: 'Position', default: 0.35,
    hint: 'Where the resonator is struck or plucked, which shapes its overtone balance.',
  },
]

// Strikes that can ring at once, per lane. Each voice is a full resonator, so
// this is a CPU cost: see docs/rings-resonator-plan.md for the measurements.
export const RESONATOR_VOICE_OPTIONS = [1, 2, 3, 4]
export const DEFAULT_RESONATOR_VOICES = 2

// Optional per-note envelope (off by default, so a lane without it plays the
// original strike-and-ring instrument exactly). When on, one ADSR per voice
// shapes the voice's output and the "bow": noise fed into the resonator, which
// lets a note swell in and hold instead of only decaying. The flat keys are
// namespaced rather than reusing attack/decay/... so values left in the lane's
// param map by a previous synth type are never picked up. `planKey` is the key
// in the plan's `envelope` object. Ranges match the DSP's clamps (bridge.cc).
export const RESONATOR_ENVELOPE_PARAMS = [
  { key: 'resonatorAttack',  planKey: 'attack',  label: 'Attack',  min: 0.001, max: 4, default: 0.005, unit: 's',
    hint: 'How long each note takes to swell in. Long attacks suit a bowed sound.' },
  { key: 'resonatorDecay',   planKey: 'decay',   label: 'Decay',   min: 0.001, max: 4, default: 0.3,   unit: 's',
    hint: 'How long it takes to settle from the peak to the sustain level.' },
  { key: 'resonatorSustain', planKey: 'sustain', label: 'Sustain', min: 0,     max: 1, default: 0.7,
    hint: 'The level a note holds at for the rest of its note length.' },
  { key: 'resonatorRelease', planKey: 'release', label: 'Release', min: 0.01,  max: 8, default: 1.5,   unit: 's',
    hint: 'How long the note fades after its note length ends. This also caps the ring.' },
]

export const RESONATOR_BOW = {
  key: 'resonatorBow', planKey: 'bow', label: 'Bow', default: 0,
  hint: 'Noise fed into the resonator for as long as the envelope is open, so notes swell and sustain like a bowed or blown sound. 0 plays the strike alone.',
}

export const RESONATOR_ENVELOPE_DEFAULTS = {
  resonatorEnvelope: false,
  ...Object.fromEntries(RESONATOR_ENVELOPE_PARAMS.map(p => [p.key, p.default])),
  resonatorBow: RESONATOR_BOW.default,
  resonatorStrike: true,
}

export const RESONATOR_DEFAULTS = {
  resonatorModel: 'modal',
  ...Object.fromEntries(RESONATOR_PARAMS.map(p => [p.key, p.default])),
  resonatorVoices: DEFAULT_RESONATOR_VOICES,
  ...RESONATOR_ENVELOPE_DEFAULTS,
}

export const RESONATOR_PARAM_KEYS = Object.keys(RESONATOR_DEFAULTS)

// What the instrument does and doesn't do for a given lane's params, so UI,
// engine and plan advisories can ask instead of hard-coding the type name.
export function resonatorCapabilities(params) {
  const enveloped = params?.resonatorEnvelope === true
  return {
    envelope: enveloped,        // off: every note decays naturally (Damping)
    noteLengthGate: enveloped,  // off: note length is MIDI articulation only
    legato: false,              // every note is a new attack; a saved legato flag is ignored
    glide: false,
    granular: false,            // the grain layer's offline source render can't run it yet
  }
}

// The envelope-less capabilities: what's true of every Resonator lane.
export const RESONATOR_CAPABILITIES = resonatorCapabilities(null)

// Flat lane params → the plan `tone` that reproduces them (inverse of the above).
// The envelope's times go in the plan's `envelope`, see resonatorParamsToEnvelope.
export function resonatorParamsToTone(params) {
  const n = normalizeResonatorParams(params)
  const tone = { resonatorModel: n.resonatorModel }
  for (const spec of RESONATOR_PARAMS) tone[spec.planKey] = n[spec.key]
  tone.resonatorVoices = n.resonatorVoices
  if (n.resonatorEnvelope) {
    tone.resonatorEnvelope = true
    tone.bow = n.resonatorBow
    tone.strike = n.resonatorStrike
  }
  return tone
}

// Flat lane params → the plan `envelope`, or null while the envelope is off.
export function resonatorParamsToEnvelope(params) {
  const n = normalizeResonatorParams(params)
  if (!n.resonatorEnvelope) return null
  return Object.fromEntries(RESONATOR_ENVELOPE_PARAMS.map(p => [p.planKey, n[p.key]]))
}

const clamp01 = (v, fallback) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

const clampRange = (v, min, max, fallback) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const asBool = (v, fallback) => (typeof v === 'boolean' ? v : fallback)

// Coerce any params object (UI state, imported song, plan) into a complete,
// valid Resonator patch. Unknown keys are dropped; non-finite and out-of-range
// values fall back or clamp. Never throws.
export function normalizeResonatorParams(params) {
  const p = params && typeof params === 'object' ? params : {}
  const out = {
    resonatorModel: RESONATOR_MODEL_IDS.includes(p.resonatorModel) ? p.resonatorModel : RESONATOR_DEFAULTS.resonatorModel,
  }
  for (const spec of RESONATOR_PARAMS) out[spec.key] = clamp01(p[spec.key], spec.default)
  const voices = Math.round(Number(p.resonatorVoices))
  out.resonatorVoices = RESONATOR_VOICE_OPTIONS.includes(voices) ? voices : DEFAULT_RESONATOR_VOICES
  out.resonatorEnvelope = asBool(p.resonatorEnvelope, false)
  for (const spec of RESONATOR_ENVELOPE_PARAMS) out[spec.key] = clampRange(p[spec.key], spec.min, spec.max, spec.default)
  out.resonatorBow = clamp01(p.resonatorBow, RESONATOR_BOW.default)
  out.resonatorStrike = asBool(p.resonatorStrike, true)
  return out
}

// The DSP envelope settings (rs_set_envelope) from a params object.
export function resonatorEnvelopePatch(params) {
  const n = normalizeResonatorParams(params)
  return {
    enabled: n.resonatorEnvelope,
    attack: n.resonatorAttack,
    decay: n.resonatorDecay,
    sustain: n.resonatorSustain,
    release: n.resonatorRelease,
    bow: n.resonatorBow,
    strike: n.resonatorStrike,
  }
}

export function resonatorModelIndex(id) {
  return RESONATOR_MODELS.find(m => m.id === id)?.index ?? 0
}

// The four DSP patch values from a normalized params object.
export function resonatorPatch(params) {
  const n = normalizeResonatorParams(params)
  return {
    structure: n.resonatorStructure,
    brightness: n.resonatorBrightness,
    damping: n.resonatorDamping,
    position: n.resonatorPosition,
  }
}

// Automation lane destinations (SYNTH_PARAM_TARGETS.Resonator in engine.js): the
// four continuous timbre controls, 0..1 like the knobs. The DSP smooths patch
// changes, so a stepped automation curve doesn't zipper. Model and voice count
// are discrete and reset voices, so they aren't automatable.
export const RESONATOR_AUTOMATION_TARGETS = RESONATOR_PARAMS.map(p => ({
  id: `synth.${p.key}`, label: p.label, group: 'Resonator', min: 0, max: 1,
}))

// Plan `tone` keys the Resonator honours (see TONE_SUPPORT in soundSpecs.js).
export const RESONATOR_TONE_KEYS = [
  'resonatorModel', ...RESONATOR_PARAMS.map(p => p.planKey), 'resonatorVoices',
  'resonatorEnvelope', RESONATOR_BOW.planKey, 'strike',
]

// Plan `tone` → flat lane params: only the resonator keys the tone names, and
// only those in `allowed` (plan keys; the caller's instrument filter).
export function resonatorToneToParams(tone, allowed = RESONATOR_TONE_KEYS) {
  if (!tone || typeof tone !== 'object') return {}
  const ok = (key) => allowed.includes(key)
  const out = {}
  if (ok('resonatorModel') && RESONATOR_MODEL_IDS.includes(tone.resonatorModel)) out.resonatorModel = tone.resonatorModel
  for (const spec of RESONATOR_PARAMS) {
    const v = ok(spec.planKey) ? clamp01(tone[spec.planKey], null) : null
    if (v != null) out[spec.key] = v
  }
  const voices = Math.round(Number(tone.resonatorVoices))
  if (ok('resonatorVoices') && RESONATOR_VOICE_OPTIONS.includes(voices)) out.resonatorVoices = voices
  if (ok('resonatorEnvelope') && typeof tone.resonatorEnvelope === 'boolean') out.resonatorEnvelope = tone.resonatorEnvelope
  const bow = ok(RESONATOR_BOW.planKey) ? clamp01(tone[RESONATOR_BOW.planKey], null) : null
  if (bow != null) out.resonatorBow = bow
  if (ok('strike') && typeof tone.strike === 'boolean') out.resonatorStrike = tone.strike
  return out
}

// Plan `envelope` → flat lane params. Naming an envelope turns it on; only the
// segments the plan gives are written, the rest keep the lane's values.
export function resonatorEnvelopeToParams(envelope) {
  if (!envelope || typeof envelope !== 'object') return {}
  const out = { resonatorEnvelope: true }
  for (const spec of RESONATOR_ENVELOPE_PARAMS) {
    const v = clampRange(envelope[spec.planKey], spec.min, spec.max, null)
    if (v != null) out[spec.key] = v
  }
  return out
}

// Whether a song or plan's synth-type map needs the Resonator DSP loaded.
export function usesResonator(synthTypes) {
  if (!synthTypes) return false
  const values = Array.isArray(synthTypes) ? synthTypes : Object.values(synthTypes)
  return values.includes('Resonator')
}
