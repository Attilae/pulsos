// The user-facing half of the master bus (lib/masterBus.js): the handful of
// settings the Mastering card in the DAW footer exposes, their ranges, and the
// normaliser every entry point goes through. Pure, so it's shared by the UI,
// songState and tests without pulling in Tone.
//
// Ranges are deliberately narrow — "tweak a little", not a mastering suite. The
// fixed internals (Q values, attack/release, knee, lookahead, clipper) stay in
// masterBus.js.
//
// A song stores its settings as `snapshot.masterChain`. Sparse: absent means the
// defaults, so songs saved before the card existed load unchanged and there's no
// schema bump.

export const MASTER_CHAIN_DEFAULTS = Object.freeze({
  enabled: true,
  lowCutHz: 25,          // high-pass
  lowMidDb: -1,          // peaking @ 300 Hz — negative cuts mud
  airDb: 1,              // high shelf @ 10 kHz
  glueThresholdDb: -24,  // glue compressor
  glueRatio: 2,
  warmth: 0.25,          // tanh saturation blend, 0–1
  driveDb: 0,            // into the limiter: louder, and more limiting
  ceilingDb: -1,         // limiter ceiling, dBTP
})

// Shaped like fxSpecs.js param specs so the footer's FxParamControl renders them
// (`decimals` overrides its step-derived precision). Order is the card's layout —
// tone then dynamics, filled column by column — not signal flow.
export const MASTER_CHAIN_SPECS = [
  // Tone (the card's left column)
  { id: 'lowCutHz',        stage: 'eq',      label: 'Low cut', min: 20,  max: 60,   step: 1,    unit: 'Hz' },
  { id: 'lowMidDb',        stage: 'eq',      label: 'Low-mid', min: -4,  max: 2,    step: 0.5,  unit: 'dB', decimals: 1 },
  { id: 'airDb',           stage: 'eq',      label: 'Air',     min: -2,  max: 4,    step: 0.5,  unit: 'dB', decimals: 1 },
  { id: 'warmth',          stage: 'warmth',  label: 'Warmth',  min: 0,   max: 0.6,  step: 0.01, unit: '%', displayScale: 100, decimals: 0 },
  // Dynamics (right column)
  { id: 'glueThresholdDb', stage: 'glue',    label: 'Thresh',  min: -36, max: -12,  step: 1,    unit: 'dB' },
  { id: 'glueRatio',       stage: 'glue',    label: 'Ratio',   min: 1,   max: 4,    step: 0.1,  unit: ':1', decimals: 1 },
  { id: 'driveDb',         stage: 'limiter', label: 'Drive',   min: -6,  max: 6,    step: 0.5,  unit: 'dB', decimals: 1 },
  { id: 'ceilingDb',       stage: 'limiter', label: 'Ceiling', min: -3,  max: -0.3, step: 0.1,  unit: 'dB', decimals: 1 },
]

// Signal-flow order, for the card's chain readout.
export const MASTER_CHAIN_STAGES = [
  { id: 'eq',      label: 'EQ' },
  { id: 'glue',    label: 'Glue' },
  { id: 'warmth',  label: 'Warmth' },
  { id: 'limiter', label: 'Limiter' },
]

// Coerce anything (a stale save, a shared link, a partial patch merged by the UI)
// into a complete, in-range settings object.
export function normalizeMasterChain(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = { enabled: typeof src.enabled === 'boolean' ? src.enabled : MASTER_CHAIN_DEFAULTS.enabled }
  for (const spec of MASTER_CHAIN_SPECS) {
    const v = Number(src[spec.id])
    out[spec.id] = Number.isFinite(v)
      ? Math.min(spec.max, Math.max(spec.min, v))
      : MASTER_CHAIN_DEFAULTS[spec.id]
  }
  return out
}

export function isDefaultMasterChain(cfg) {
  const n = normalizeMasterChain(cfg)
  return Object.keys(MASTER_CHAIN_DEFAULTS).every(k => n[k] === MASTER_CHAIN_DEFAULTS[k])
}

// What a snapshot stores: null when untouched, keeping default songs sparse.
export function masterChainForSnapshot(cfg) {
  return isDefaultMasterChain(cfg) ? null : normalizeMasterChain(cfg)
}
