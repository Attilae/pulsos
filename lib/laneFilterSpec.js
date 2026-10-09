// The lane insert filter's vocabulary: models, responses, ranges, defaults, and the
// mode-aware rules shared by the engine adapter (lib/laneFilter.js), the desktop and
// phone filter panels, song loading and the AI/MCP plan contract. Pure: no Tone, no
// React, safe for lib/server (test/server-purity.test.js).
//
// A lane filter is a `trackFilters[routeId]` object. Legacy fields keep their
// meaning; the Analog ones are additive:
//
//   {
//     model: 'daisy-ladder', // absent or 'classic' → Tone.Filter (Classic)
//     type: 'lowpass',       // Classic: lowpass|highpass|bandpass|notch; Analog: no notch
//     frequency: 20000,      // requested cutoff in Hz (Analog clamps only at runtime)
//     Q: 4,                  // Classic; kept while Analog is selected
//     resonance: 0.2,        // Analog, native DaisySP units 0..1.8
//     drive: 1,              // Analog, native units 0..4 (1 = unity input drive)
//     slope: 24,             // Analog, 12 | 24 dB/oct
//     bypass: false,         // either model: crossfade to the dry lane
//   }

export const CLASSIC_MODEL = 'classic'
export const ANALOG_MODEL = 'daisy-ladder'
export const FILTER_MODELS = [CLASSIC_MODEL, ANALOG_MODEL]
export const FILTER_MODEL_LABELS = { [CLASSIC_MODEL]: 'Classic', [ANALOG_MODEL]: 'Analog' }

export const CLASSIC_FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch']
export const ANALOG_FILTER_TYPES = ['lowpass', 'highpass', 'bandpass']
export const ANALOG_SLOPES = [12, 24]

export const FILTER_RANGES = {
  frequency: { min: 20, max: 20000 },
  Q: { min: 0.1, max: 20 },
  resonance: { min: 0, max: 1.8 },
  drive: { min: 0, max: 4 },
}

export const DEFAULT_LANE_FILTER = { type: 'lowpass', frequency: 20000, Q: 4 }
// Proposed first-release Analog defaults (audition before freezing fixtures).
export const ANALOG_DEFAULTS = { resonance: 0.2, drive: 1, slope: 24 }

// DaisySP clamps cutoff to 0.425 × the sample rate (it oversamples 4×).
export const ANALOG_CUTOFF_RATIO = 0.425

// Crossfade time for model, bypass and Analog response changes.
export const FILTER_XFADE_SEC = 0.02

export const ANALOG_NOTCH_NOTICE = 'Analog has no notch response, so the filter switched to lowpass.'
export const ANALOG_UNAVAILABLE_NOTICE = 'Analog filter unavailable; using Classic'

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v))

export function isAnalogFilter(filter) {
  return filter?.model === ANALOG_MODEL
}

export function filterModelOf(filter) {
  return isAnalogFilter(filter) ? ANALOG_MODEL : CLASSIC_MODEL
}

// The highest cutoff the Analog filter reaches at `sampleRate`.
export function analogMaxCutoff(sampleRate) {
  if (!isNum(sampleRate) || sampleRate <= 0) return FILTER_RANGES.frequency.max
  return Math.min(FILTER_RANGES.frequency.max, ANALOG_CUTOFF_RATIO * sampleRate)
}

// The cutoff the lane actually filters at; the requested value stays in state.
export function effectiveCutoff(filter, sampleRate) {
  const f = isNum(filter?.frequency) ? filter.frequency : DEFAULT_LANE_FILTER.frequency
  const lo = FILTER_RANGES.frequency.min
  const hi = isAnalogFilter(filter) ? analogMaxCutoff(sampleRate) : FILTER_RANGES.frequency.max
  return Math.min(hi, Math.max(lo, f))
}

// The bridge's mode index: LP24 0, LP12 1, BP24 2, BP12 3, HP24 4, HP12 5.
// Mirrored in public/worklets/ladder-processor.js (modeIndex), which can't import.
export function analogModeIndex(type, slope) {
  const base = type === 'highpass' ? 4 : type === 'bandpass' ? 2 : 0
  return base + (Number(slope) === 12 ? 1 : 0)
}

// Analog resonance is shown as 0–100 %, linear over native 0..1.8. It is not Q.
export function resonanceToPercent(native) {
  const v = isNum(native) ? native : ANALOG_DEFAULTS.resonance
  return Math.round((clamp(v, FILTER_RANGES.resonance) / FILTER_RANGES.resonance.max) * 1000) / 10
}
export function resonanceFromPercent(pct) {
  const p = isNum(pct) ? Math.min(100, Math.max(0, pct)) : 0
  return (p / 100) * FILTER_RANGES.resonance.max
}

// The full set of values a lane filter runs with: every field present.
export function resolveLaneFilter(filter) {
  const n = normalizeLaneFilter(filter) ?? {}
  return {
    model: filterModelOf(n),
    type: n.type ?? DEFAULT_LANE_FILTER.type,
    frequency: n.frequency ?? DEFAULT_LANE_FILTER.frequency,
    Q: n.Q ?? DEFAULT_LANE_FILTER.Q,
    resonance: n.resonance ?? ANALOG_DEFAULTS.resonance,
    drive: n.drive ?? ANALOG_DEFAULTS.drive,
    slope: n.slope ?? ANALOG_DEFAULTS.slope,
    bypass: !!n.bypass,
  }
}

// Normalise untrusted stored state (a saved song, a shared link): drop unknown and
// invalid fields, clamp numbers, keep only what was there. A legacy filter
// ({type, frequency, Q}) comes back unchanged, so old songs reproduce exactly;
// nothing is converted between Q and resonance. An Analog notch can't play, so it
// becomes lowpass (the same rule as switching to Analog in the UI).
export function normalizeLaneFilter(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  if (raw.model === ANALOG_MODEL || raw.model === CLASSIC_MODEL) out.model = raw.model
  const analog = out.model === ANALOG_MODEL
  if (CLASSIC_FILTER_TYPES.includes(raw.type)) out.type = raw.type
  if (analog && out.type === 'notch') out.type = 'lowpass'
  if (isNum(raw.frequency)) out.frequency = clamp(raw.frequency, FILTER_RANGES.frequency)
  if (isNum(raw.Q)) out.Q = clamp(raw.Q, FILTER_RANGES.Q)
  if (isNum(raw.resonance)) out.resonance = clamp(raw.resonance, FILTER_RANGES.resonance)
  if (isNum(raw.drive)) out.drive = clamp(raw.drive, FILTER_RANGES.drive)
  if (ANALOG_SLOPES.includes(Number(raw.slope))) out.slope = Number(raw.slope)
  if (typeof raw.bypass === 'boolean') out.bypass = raw.bypass
  return out
}

// Normalise a whole trackFilters map; entries that aren't objects are dropped.
export function normalizeTrackFilters(map) {
  if (!map || typeof map !== 'object') return {}
  const out = {}
  for (const [id, f] of Object.entries(map)) {
    const n = normalizeLaneFilter(f)
    if (n) out[id] = n
  }
  return out
}

// The patch a model switch writes. Values for the other model stay in the lane
// (Q while Analog, resonance/drive/slope while Classic) so switching back
// restores them. Switching to Analog from notch changes the response to lowpass;
// `notice` says so for the UI to announce.
export function filterModelPatch(current, model) {
  if (model !== ANALOG_MODEL) return { patch: { model: CLASSIC_MODEL }, notice: null }
  const patch = { model: ANALOG_MODEL }
  let notice = null
  if (current?.type === 'notch') { patch.type = 'lowpass'; notice = ANALOG_NOTCH_NOTICE }
  for (const [k, v] of Object.entries(ANALOG_DEFAULTS)) if (current?.[k] == null) patch[k] = v
  return { patch, notice }
}

// Automation targets that belong to one model only. filter.frequency drives both.
export const FILTER_TARGET_MODELS = {
  'filter.Q': CLASSIC_MODEL,
  'filter.resonance': ANALOG_MODEL,
  'filter.drive': ANALOG_MODEL,
}

// Whether an automation lane on `targetId` is live for a lane with `filter`.
// Incompatible lanes are kept (in the song and the UI) but inactive, and resume
// when the matching model returns.
export function filterTargetActive(targetId, filter) {
  const model = FILTER_TARGET_MODELS[targetId]
  return !model || model === filterModelOf(filter)
}

// Validate a plan's filter object (AI composer / MCP). Returns { filter, error }:
// invalid or nonfinite values are dropped, numbers clamped, and an Analog notch is
// rejected outright rather than silently changed.
export function validatePlanFilter(raw) {
  if (!raw || typeof raw !== 'object') return { filter: null, error: null }
  const model = raw.model === ANALOG_MODEL ? ANALOG_MODEL : (raw.model === CLASSIC_MODEL ? CLASSIC_MODEL : null)
  if (model === ANALOG_MODEL && raw.type === 'notch') {
    return { filter: null, error: 'filter: the analog model has no notch response (use lowpass, highpass or bandpass)' }
  }
  const filter = {}
  if (model) filter.model = model
  if (CLASSIC_FILTER_TYPES.includes(raw.type)) filter.type = raw.type
  if (isNum(raw.frequency)) filter.frequency = clamp(raw.frequency, FILTER_RANGES.frequency)
  if (isNum(raw.Q)) filter.Q = clamp(raw.Q, FILTER_RANGES.Q)
  if (isNum(raw.resonance)) filter.resonance = clamp(raw.resonance, FILTER_RANGES.resonance)
  if (isNum(raw.drive)) filter.drive = clamp(raw.drive, FILTER_RANGES.drive)
  if (ANALOG_SLOPES.includes(Number(raw.slope))) filter.slope = Number(raw.slope)
  if (typeof raw.bypass === 'boolean') filter.bypass = raw.bypass
  return { filter: Object.keys(filter).length ? filter : null, error: null }
}
