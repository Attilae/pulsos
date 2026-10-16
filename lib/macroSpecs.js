// Macro instrument vocabulary — pure, server-safe definitions shared by the
// engine adapter (lib/macroVoice.js), the lane editors, song snapshots and the
// AI/MCP plan contract. No Tone, worklet or wasm imports here (see
// test/server-purity.test.js).
//
// The DSP is derived from Emilie Gillet's open-source Plaits firmware (MIT; see
// vendor/plaits). The panel controls are stored in the lane's flat param map
// (trackADSRs) under the `macro*` keys below, as the 0..1 (or -1..1) values the
// module's knobs and attenuverters produce. See docs/plaits-macro-plan.md.

// Until the release gates in docs/plaits-macro-plan.md pass, Macro is offered
// (lane picker, AI/MCP plan vocabulary) only behind this flag. Songs that
// already use it play regardless. Written literally so Next inlines it.
export const MACRO_ENABLED = process.env.NEXT_PUBLIC_MACRO_ENABLED === 'true'

// The 24 engines in upstream's order: `index` is what the DSP takes, `bank` the
// module's bank of 8 (1 = the firmware 1.2 additions). `harmonics`, `timbre`,
// `morph` and `aux` say what each control does on that engine, from the module's
// manual; the panel shows them under the knob names.
export const MACRO_ENGINES = [
  { id: 'vaFilter',       bank: 1, label: 'VA + filter',      hint: 'Classic waveforms through a resonant filter.',
    harmonics: 'Resonance', timbre: 'Cutoff', morph: 'Wave + sub', aux: '12 dB high-pass' },
  { id: 'phaseDist',      bank: 1, label: 'Phase distortion', hint: 'Casio-style phase distortion.',
    harmonics: 'Distortion freq', timbre: 'Distortion', morph: 'Asymmetry', aux: 'Free-running carrier' },
  { id: 'sixOpA',         bank: 1, label: '6-op FM 1',        hint: 'Six-operator FM, preset bank 1. Notes sustain while held.',
    harmonics: 'Preset', timbre: 'Modulator level', morph: 'Envelope stretch', aux: 'Variant' },
  { id: 'sixOpB',         bank: 1, label: '6-op FM 2',        hint: 'Six-operator FM, preset bank 2. Notes sustain while held.',
    harmonics: 'Preset', timbre: 'Modulator level', morph: 'Envelope stretch', aux: 'Variant' },
  { id: 'sixOpC',         bank: 1, label: '6-op FM 3',        hint: 'Six-operator FM, preset bank 3. Notes sustain while held.',
    harmonics: 'Preset', timbre: 'Modulator level', morph: 'Envelope stretch', aux: 'Variant' },
  { id: 'waveTerrain',    bank: 1, label: 'Wave terrain',     hint: 'A circular path scanned across a 2D terrain.',
    harmonics: 'Terrain', timbre: 'Path radius', morph: 'Path offset', aux: 'Height as phase distortion' },
  { id: 'stringMachine',  bank: 1, label: 'String machine',   hint: 'Ensemble strings with chorus.',
    harmonics: 'Chord', timbre: 'Chorus / filter', morph: 'Waveform', aux: 'Voices 2 and 4' },
  { id: 'chiptune',       bank: 1, label: 'Chiptune',         hint: 'Square-wave chords stepped as an arpeggio, one step per note. Its decay is the Timbre amount: at 0 notes drone.',
    harmonics: 'Chord', timbre: 'Arpeggio', morph: 'Pulse width / sync', aux: 'Triangle bass' },

  { id: 'va',             bank: 2, label: 'Virtual analog',   hint: 'Two detuned classic waveforms.',
    harmonics: 'Detune', timbre: 'Pulse shape', morph: 'Saw shape', aux: 'Hard-synced pair' },
  { id: 'waveshaping',    bank: 2, label: 'Waveshaping',      hint: 'A triangle through a waveshaper and wavefolder.',
    harmonics: 'Shaper wave', timbre: 'Fold', morph: 'Asymmetry', aux: 'Second folder' },
  { id: 'fm',             bank: 2, label: '2-op FM',          hint: 'Two sine operators modulating each other.',
    harmonics: 'Ratio', timbre: 'Index', morph: 'Feedback', aux: 'Sub-oscillator' },
  { id: 'formant',        bank: 2, label: 'Grain formant',    hint: 'Sine segments synced and multiplied into formants.',
    harmonics: 'Formant ratio', timbre: 'Formant freq', morph: 'Formant width', aux: 'Filtered waveform' },
  { id: 'additive',       bank: 2, label: 'Additive',         hint: 'A mix of harmonic sine partials.',
    harmonics: 'Bumps', timbre: 'Main harmonic', morph: 'Bump shape', aux: 'Organ drawbars' },
  { id: 'wavetable',      bank: 2, label: 'Wavetable',        hint: 'Four banks of 8x8 waveforms.',
    harmonics: 'Bank', timbre: 'Row', morph: 'Column', aux: 'Lo-fi 5-bit' },
  { id: 'chords',         bank: 2, label: 'Chords',           hint: 'Four-note chords from organ, string or wavetable voices.',
    harmonics: 'Chord type', timbre: 'Inversion', morph: 'Waveform', aux: 'Root note' },
  { id: 'speech',         bank: 2, label: 'Speech',           hint: 'Vowels, formants and spoken words.',
    harmonics: 'Synth / word bank', timbre: 'Species', morph: 'Phoneme / word', aux: 'Raw vocal cords' },

  { id: 'swarm',          bank: 3, label: 'Swarm',            hint: 'A swarm of eight enveloped sawtooth grains.',
    harmonics: 'Pitch spread', timbre: 'Density', morph: 'Grain length', aux: 'Sine swarm' },
  { id: 'noise',          bank: 3, label: 'Filtered noise',   hint: 'Clocked noise through a resonant filter.',
    harmonics: 'LP / BP / HP', timbre: 'Clock', morph: 'Resonance', aux: 'Dual band-pass' },
  { id: 'particle',       bank: 3, label: 'Particle',         hint: 'Dust through all-pass or band-pass networks.',
    harmonics: 'Pitch spread', timbre: 'Density', morph: 'Filter type', aux: 'Raw dust' },
  { id: 'string',         bank: 3, label: 'Inharmonic string', hint: 'A plucked string model. Rings on its own.',
    harmonics: 'Inharmonicity', timbre: 'Brightness', morph: 'Decay', aux: 'Raw exciter' },
  { id: 'modal',          bank: 3, label: 'Modal resonator',  hint: 'Struck bars, bells and plates. Rings on its own.',
    harmonics: 'Material', timbre: 'Brightness', morph: 'Decay', aux: 'Raw exciter' },
  { id: 'bassDrum',       bank: 3, label: 'Bass drum',        hint: 'Analog kick drum circuits. Rings on its own.',
    harmonics: 'Punch / drive', timbre: 'Brightness', morph: 'Decay', aux: 'Other circuit' },
  { id: 'snare',          bank: 3, label: 'Snare drum',       hint: 'Analog snare drum circuits. Rings on its own.',
    harmonics: 'Tone / noise', timbre: 'Modes', morph: 'Decay', aux: 'Other circuit' },
  { id: 'hiHat',          bank: 3, label: 'Hi-hat',           hint: 'Metallic squares and noise. Rings on its own.',
    harmonics: 'Metal / noise', timbre: 'High-pass', morph: 'Decay', aux: 'Other circuit' },
].map((e, index) => ({ ...e, index }))

export const MACRO_ENGINE_IDS = MACRO_ENGINES.map(e => e.id)
export const MACRO_BANKS = [1, 2, 3]
export const DEFAULT_MACRO_ENGINE = 'va'

// Engines that envelope themselves and bypass the low-pass gate (voice.cc's
// already_enveloped), so LPG Decay and Colour do nothing on them.
export const MACRO_SELF_ENVELOPED = ['sixOpA', 'sixOpB', 'sixOpC', 'chiptune', 'string', 'modal', 'bassDrum', 'snare', 'hiHat']

// `key` is the flat lane-param key, `planKey` its name inside a plan's
// `tone.macro`. `min`/`max` are the stored range: the knobs are 0..1, the
// attenuverters -1..1. A plan gives Frequency as `transpose` in semitones.
export const MACRO_PARAMS = [
  { key: 'macroFrequency', planKey: 'transpose', label: 'Frequency', min: 0, max: 1, default: 0.5,
    hint: 'Transposes the lane up to 7 semitones either way, in semitone steps. The lane\'s Octave control covers octaves.' },
  { key: 'macroHarmonics', planKey: 'harmonics', label: 'Harmonics', min: 0, max: 1, default: 0.5,
    hint: 'The engine\'s spectral control: detune, ratio, chord, preset and so on.' },
  { key: 'macroTimbre', planKey: 'timbre', label: 'Timbre', min: 0, max: 1, default: 0.5,
    hint: 'The engine\'s main brightness or tone control.' },
  { key: 'macroMorph', planKey: 'morph', label: 'Morph', min: 0, max: 1, default: 0.5,
    hint: 'The engine\'s waveform or shape control.' },
  { key: 'macroTimbreAmt', planKey: 'timbreAmount', label: 'Timbre amt', min: -1, max: 1, default: 0, bipolar: true,
    hint: 'How far each note\'s decay envelope moves Timbre, up or down.' },
  { key: 'macroFmAmt', planKey: 'fmAmount', label: 'FM amt', min: -1, max: 1, default: 0, bipolar: true,
    hint: 'How far each note\'s decay envelope bends the pitch, up to 4 octaves either way.' },
  { key: 'macroMorphAmt', planKey: 'morphAmount', label: 'Morph amt', min: -1, max: 1, default: 0, bipolar: true,
    hint: 'How far each note\'s decay envelope moves Morph, up or down.' },
  { key: 'macroDecay', planKey: 'lpgDecay', label: 'Decay', min: 0, max: 1, default: 0.5,
    hint: 'How long the low-pass gate and the decay envelope ring after each note. Self-enveloped engines (6-op FM, chiptune, string, modal, drums) ignore the gate.' },
  { key: 'macroColour', planKey: 'lpgColour', label: 'Colour', min: 0, max: 1, default: 0.5,
    hint: 'The low-pass gate\'s response, from a filter that closes as it fades to a plain volume fade.' },
  { key: 'macroAux', planKey: 'aux', label: 'Out / Aux', min: 0, max: 1, default: 0,
    hint: 'Blends the main output with the engine\'s auxiliary variant.' },
]

const PARAM = Object.fromEntries(MACRO_PARAMS.map(p => [p.key, p]))
export const MACRO_PARAM = PARAM

// FREQUENCY spans the module's 14-semitone knob range.
export const MACRO_TRANSPOSE_RANGE = 7

// Notes that can sound at once, per lane. Each voice is a full Plaits voice,
// so this is a CPU cost: see dsp/macro/README.md.
export const MACRO_VOICE_OPTIONS = [1, 2, 3, 4]
export const DEFAULT_MACRO_VOICES = 2

// Optional per-note envelope (off by default, so a lane without it plays the
// module's pinged low-pass gate exactly as before). When on, the gate is held
// open (the module with LEVEL patched fully up) and one ADSR per voice shapes
// the voice's output, so every engine can swell in and sustain for the note
// length. The keys are macroEnv* so they can't collide with macroDecay (the
// gate's Decay) or with attack/decay/... left in the lane's param map by a
// previous synth type. `planKey` is the key in the plan's `envelope` object.
// Ranges match the DSP's clamps (dsp/macro/bridge.cc).
export const MACRO_ENVELOPE_PARAMS = [
  { key: 'macroEnvAttack',  planKey: 'attack',  label: 'Attack',  min: 0.001, max: 4, default: 0.005, unit: 's',
    hint: 'How long each note takes to swell in.' },
  { key: 'macroEnvDecay',   planKey: 'decay',   label: 'Decay',   min: 0.001, max: 4, default: 0.3,   unit: 's',
    hint: 'How long it takes to settle from the peak to the sustain level.' },
  { key: 'macroEnvSustain', planKey: 'sustain', label: 'Sustain', min: 0,     max: 1, default: 0.7,
    hint: 'The level a note holds at for the rest of its note length.' },
  { key: 'macroEnvRelease', planKey: 'release', label: 'Release', min: 0.01,  max: 8, default: 0.4,   unit: 's',
    hint: 'How long the note fades after its note length ends. This also cuts engines that would ring on.' },
]

export const MACRO_ENVELOPE_DEFAULTS = {
  macroEnvelope: false,
  ...Object.fromEntries(MACRO_ENVELOPE_PARAMS.map(p => [p.key, p.default])),
}

export const MACRO_DEFAULTS = {
  macroEngine: DEFAULT_MACRO_ENGINE,
  ...Object.fromEntries(MACRO_PARAMS.map(p => [p.key, p.default])),
  macroVoices: DEFAULT_MACRO_VOICES,
  ...MACRO_ENVELOPE_DEFAULTS,
}

export const MACRO_PARAM_KEYS = Object.keys(MACRO_DEFAULTS)

// What the instrument does and doesn't do for a given lane's params, so UI,
// engine and plan advisories can ask instead of hard-coding the type name.
export function macroCapabilities(params) {
  return {
    envelope: params?.macroEnvelope === true, // off: the low-pass gate pings instead
    noteLengthGate: true,   // the trigger is held for the note length
    legato: false,          // every note is a new trigger
    glide: false,
    granular: false,        // the grain layer's offline source render can't run it
  }
}

// The envelope-less capabilities: what's true of every Macro lane.
export const MACRO_CAPABILITIES = macroCapabilities(null)

const toNumber = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v)
const clampRange = (v, min, max, fallback) => {
  const n = toNumber(v)
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// Coerce any params object (UI state, imported song, plan) into a complete,
// valid Macro patch. Unknown keys are dropped; non-finite and out-of-range
// values fall back or clamp. Never throws.
export function normalizeMacroParams(params) {
  const p = params && typeof params === 'object' ? params : {}
  const out = {
    macroEngine: MACRO_ENGINE_IDS.includes(p.macroEngine) ? p.macroEngine : DEFAULT_MACRO_ENGINE,
  }
  for (const spec of MACRO_PARAMS) out[spec.key] = clampRange(p[spec.key], spec.min, spec.max, spec.default)
  const voices = Math.round(Number(p.macroVoices))
  out.macroVoices = MACRO_VOICE_OPTIONS.includes(voices) ? voices : DEFAULT_MACRO_VOICES
  out.macroEnvelope = typeof p.macroEnvelope === 'boolean' ? p.macroEnvelope : false
  for (const spec of MACRO_ENVELOPE_PARAMS) out[spec.key] = clampRange(p[spec.key], spec.min, spec.max, spec.default)
  return out
}

// The DSP envelope settings (mc_set_envelope) from a params object.
export function macroEnvelopePatch(params) {
  const n = normalizeMacroParams(params)
  return {
    enabled: n.macroEnvelope,
    attack: n.macroEnvAttack,
    decay: n.macroEnvDecay,
    sustain: n.macroEnvSustain,
    release: n.macroEnvRelease,
  }
}

export function macroEngine(id) {
  return MACRO_ENGINES.find(e => e.id === id) ?? MACRO_ENGINES.find(e => e.id === DEFAULT_MACRO_ENGINE)
}

export function macroEngineIndex(id) {
  return macroEngine(id).index
}

// FREQUENCY knob → whole semitones, -7..+7.
export function macroTransposeSemitones(frequency) {
  const f = clampRange(frequency, 0, 1, 0.5)
  return Math.round((f - 0.5) * 2 * MACRO_TRANSPOSE_RANGE) || 0
}

// The DSP patch (mc_set_patch) from a params object.
export function macroPatch(params) {
  const n = normalizeMacroParams(params)
  return {
    harmonics: n.macroHarmonics,
    timbre: n.macroTimbre,
    morph: n.macroMorph,
    fmAmount: n.macroFmAmt,
    timbreAmount: n.macroTimbreAmt,
    morphAmount: n.macroMorphAmt,
    decay: n.macroDecay,
    colour: n.macroColour,
    transpose: macroTransposeSemitones(n.macroFrequency),
  }
}

// Automation lane destinations (SYNTH_PARAM_TARGETS.Macro in engine.js): every
// continuous control except Frequency, which steps in semitones. The DSP
// smooths patch changes, so a stepped automation curve doesn't zipper. Engine
// and voice count are discrete and reset voices, so they aren't automatable.
export const MACRO_AUTOMATION_TARGETS = MACRO_PARAMS
  .filter(p => p.key !== 'macroFrequency')
  .map(p => ({ id: `synth.${p.key}`, label: p.label, group: 'Macro', min: p.min, max: p.max }))

// Whether a song or plan's synth-type map needs the Macro DSP loaded.
export function usesMacro(synthTypes) {
  if (!synthTypes) return false
  const values = Array.isArray(synthTypes) ? synthTypes : Object.values(synthTypes)
  return values.includes('Macro')
}

// ── AI/MCP plans ──────────────────────────────────────────────────────────────
// A plan sets Macro through one nested object, `tone.macro`, rather than a dozen
// top-level tone keys: the strict JSON schema the in-app composer sends requires
// every tone key on every track, and nested keys can't collide with other
// instruments' (Resonator `damping`, the amp envelope's `decay`).
//   { engine, harmonics, timbre, morph, transpose, timbreAmount, fmAmount,
//     morphAmount, lpgDecay, lpgColour, aux, voices, envelope }
// `transpose` is whole semitones, -7..+7 (the panel's FREQUENCY). `envelope` is
// true/false: the ADSR's times come from the track's own `envelope`, and naming
// one there switches it on (macroEnvelopeToParams).

export const MACRO_TONE_KEYS = ['macro']
export const MACRO_PLAN_KEYS = ['engine', ...MACRO_PARAMS.map(p => p.planKey), 'voices', 'envelope']

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const clampTo = (v, min, max) => Math.min(max, Math.max(min, v))

// A plan's raw `tone.macro` → { macro, dropped }: values clamped into range,
// unknown engines, voice counts and non-numbers reported by key.
export function validateMacroTone(raw) {
  const macro = {}
  const dropped = []
  if (!raw || typeof raw !== 'object') return { macro, dropped }
  if (MACRO_ENGINE_IDS.includes(raw.engine)) macro.engine = raw.engine
  else if (raw.engine != null) dropped.push(`engine "${raw.engine}"`)
  for (const spec of MACRO_PARAMS) {
    const v = raw[spec.planKey]
    if (v == null) continue
    if (!isNum(v)) { dropped.push(spec.planKey); continue }
    macro[spec.planKey] = spec.key === 'macroFrequency'
      ? Math.round(clampTo(v, -MACRO_TRANSPOSE_RANGE, MACRO_TRANSPOSE_RANGE)) || 0
      : clampTo(v, spec.min, spec.max)
  }
  if (raw.voices != null) {
    const n = Math.round(Number(raw.voices))
    if (MACRO_VOICE_OPTIONS.includes(n)) macro.voices = n
    else dropped.push(`voices ${raw.voices}`)
  }
  if (typeof raw.envelope === 'boolean') macro.envelope = raw.envelope
  else if (raw.envelope != null) dropped.push('envelope')
  for (const key of Object.keys(raw)) {
    if (!MACRO_PLAN_KEYS.includes(key) && raw[key] != null) dropped.push(key)
  }
  return { macro, dropped }
}

// A validated `tone.macro` → the lane's flat params (only the keys it names).
export function macroToneToParams(macro) {
  const { macro: m } = validateMacroTone(macro)
  const out = {}
  if (m.engine) out.macroEngine = m.engine
  for (const spec of MACRO_PARAMS) {
    if (m[spec.planKey] == null) continue
    out[spec.key] = spec.key === 'macroFrequency'
      ? (m[spec.planKey] + MACRO_TRANSPOSE_RANGE) / (2 * MACRO_TRANSPOSE_RANGE)
      : m[spec.planKey]
  }
  if (m.voices) out.macroVoices = m.voices
  if (typeof m.envelope === 'boolean') out.macroEnvelope = m.envelope
  return out
}

// A plan track's `envelope` → flat lane params. Naming an envelope turns it on;
// only the segments the plan gives are written, the rest keep the lane's values.
export function macroEnvelopeToParams(envelope) {
  if (!envelope || typeof envelope !== 'object') return {}
  const out = { macroEnvelope: true }
  for (const spec of MACRO_ENVELOPE_PARAMS) {
    const v = clampRange(envelope[spec.planKey], spec.min, spec.max, null)
    if (v != null) out[spec.key] = v
  }
  return out
}

// The lane's flat params → the plan `envelope`, or null while the envelope is off.
export function macroParamsToEnvelope(params) {
  const n = normalizeMacroParams(params)
  if (!n.macroEnvelope) return null
  return Object.fromEntries(MACRO_ENVELOPE_PARAMS.map(p => [p.planKey, n[p.key]]))
}

// The lane's flat params → the full `tone.macro` that reproduces them.
const round3 = (v) => Math.round(v * 1000) / 1000
export function macroParamsToTone(params) {
  const n = normalizeMacroParams(params)
  const macro = { engine: n.macroEngine }
  for (const spec of MACRO_PARAMS) {
    macro[spec.planKey] = spec.key === 'macroFrequency'
      ? macroTransposeSemitones(n.macroFrequency)
      : round3(n[spec.key])
  }
  macro.voices = n.macroVoices
  // Only while on, so a song without it describes exactly as before.
  if (n.macroEnvelope) macro.envelope = true
  return macro
}
