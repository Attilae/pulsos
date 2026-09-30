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

export const RESONATOR_DEFAULTS = {
  resonatorModel: 'modal',
  ...Object.fromEntries(RESONATOR_PARAMS.map(p => [p.key, p.default])),
  resonatorVoices: DEFAULT_RESONATOR_VOICES,
}

export const RESONATOR_PARAM_KEYS = Object.keys(RESONATOR_DEFAULTS)

// What the instrument does and doesn't do, so UI, engine and plan advisories can
// ask instead of hard-coding the type name everywhere.
export const RESONATOR_CAPABILITIES = {
  envelope: false,      // no ADSR: every note decays naturally (Damping)
  noteLengthGate: false, // note length is MIDI articulation only, not audible
  legato: false,        // every note strikes; a saved legato flag is ignored
  glide: false,
  granular: false,      // the grain layer's offline source render can't run it yet
}

// Flat lane params → the plan `tone` that reproduces them (inverse of the above).
export function resonatorParamsToTone(params) {
  const n = normalizeResonatorParams(params)
  const tone = { resonatorModel: n.resonatorModel }
  for (const spec of RESONATOR_PARAMS) tone[spec.planKey] = n[spec.key]
  tone.resonatorVoices = n.resonatorVoices
  return tone
}

const clamp01 = (v, fallback) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

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
  return out
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

// Plan `tone` keys the Resonator honours (see TONE_SUPPORT in soundSpecs.js).
export const RESONATOR_TONE_KEYS = ['resonatorModel', ...RESONATOR_PARAMS.map(p => p.planKey), 'resonatorVoices']

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
  return out
}

// Whether a song or plan's synth-type map needs the Resonator DSP loaded.
export function usesResonator(synthTypes) {
  if (!synthTypes) return false
  const values = Array.isArray(synthTypes) ? synthTypes : Object.values(synthTypes)
  return values.includes('Resonator')
}
