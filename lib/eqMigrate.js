// EQ state helpers for the per-track weq8 parametric EQ (Map/DAW lanes).
//
// weq8's serialized state (WEQ8Spec) is a fixed 8-tuple of filter specs:
//   { type: FilterType | 'noop', frequency: Hz, Q: number, gain: dB, bypass: boolean }
// The runtime constructor stores the passed spec BY REFERENCE (and mutates it in
// place), so every route must be handed its own fresh clone — never a shared literal.
//
// This module also migrates the legacy Tone.EQ3 shape
//   { low, mid, high, lowFrequency, highFrequency }
// (all older saved songs) into an equivalent weq8 spec so they sound ~the same.

// The EQ8-style flat default (matches weq8's internal DEFAULT_SPEC): four active,
// transparent (gain 0) filters + four unused slots.
function makeDefaultWeq8Spec() {
  return [
    { type: 'lowshelf12',  frequency: 30,   gain: 0, Q: 0.7, bypass: false },
    { type: 'peaking12',   frequency: 200,  gain: 0, Q: 0.7, bypass: false },
    { type: 'peaking12',   frequency: 1000, gain: 0, Q: 0.7, bypass: false },
    { type: 'highshelf12', frequency: 5000, gain: 0, Q: 0.7, bypass: false },
    { type: 'noop', frequency: 350, gain: 0, Q: 1, bypass: false },
    { type: 'noop', frequency: 350, gain: 0, Q: 1, bypass: false },
    { type: 'noop', frequency: 350, gain: 0, Q: 1, bypass: false },
    { type: 'noop', frequency: 350, gain: 0, Q: 1, bypass: false },
  ]
}

function cloneSpec(spec) {
  return spec.map(f => ({ ...f }))
}

// True for the old Tone.EQ3 config object (as opposed to a weq8 8-tuple array).
function isLegacyEq(v) {
  return !!v && !Array.isArray(v) && typeof v === 'object' &&
    ('low' in v || 'mid' in v || 'high' in v ||
     'lowFrequency' in v || 'highFrequency' in v)
}

// A valid weq8 spec: an array of exactly 8 filter objects.
function isWeq8Spec(v) {
  return Array.isArray(v) && v.length === 8 && v.every(f => f && typeof f === 'object' && 'type' in f)
}

// Map the 3-band Tone.EQ3 tilt onto the first three weq8 filters:
//   low  -> low-shelf  @ lowFrequency
//   mid  -> peaking    @ geometric mean of the two crossovers
//   high -> high-shelf @ highFrequency
function eq3ToWeq8(old) {
  const lowF  = Number.isFinite(old?.lowFrequency)  ? old.lowFrequency  : 400
  const highF = Number.isFinite(old?.highFrequency) ? old.highFrequency : 2500
  const midF  = Math.sqrt(Math.max(1, lowF) * Math.max(1, highF))
  const spec = makeDefaultWeq8Spec()
  spec[0] = { type: 'lowshelf12',  frequency: lowF,  gain: Number(old?.low)  || 0, Q: 0.7, bypass: false }
  spec[1] = { type: 'peaking12',   frequency: midF,  gain: Number(old?.mid)  || 0, Q: 0.7, bypass: false }
  spec[2] = { type: 'highshelf12', frequency: highF, gain: Number(old?.high) || 0, Q: 0.7, bypass: false }
  return spec
}

// Coerce whatever is stored for a route into a fresh, valid weq8 spec clone:
// legacy EQ3 -> migrated; existing weq8 spec -> cloned; anything else -> default.
function normalizeEqState(v) {
  if (isLegacyEq(v)) return eq3ToWeq8(v)
  if (isWeq8Spec(v)) return cloneSpec(v)
  return makeDefaultWeq8Spec()
}

export { makeDefaultWeq8Spec, cloneSpec, isLegacyEq, isWeq8Spec, eq3ToWeq8, normalizeEqState }
