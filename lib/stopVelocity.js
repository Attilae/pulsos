// Stop-driven velocity: a lane can derive each stop note's velocity from the
// stop's baked-in signals (city-normalized 0–1 at preprocess time — see
// docs/stop-signals.md) instead of the flat 1.0 / gap-derived variety map.
//   demand — busier stops play louder (signals.demand, linear).
//   hubs   — transfer stations accent (signals.centrality, squared: most stops
//            sit around 0.5–0.7, so a linear map would lift nearly all of them).
//
// Stored sparse (`trackStopVelocityMaps`, routeId → config): absent means off,
// i.e. today's behaviour. No schema bump.
//
// Signals are read as stored: never re-normalized over a lane or its loop
// window, so trimming a loop can't change a stop's velocity.
//
// Pure — engine, MIDI export, song snapshots, UI and the AI plan contract share it.

export const STOP_VELOCITY_SOURCES = ['demand', 'hubs']
export const STOP_VELOCITY_LABELS = { demand: 'Demand', hubs: 'Hubs' }
export const VELOCITY_RANGE = Object.freeze({ min: 0.2, max: 1 })
export const DEFAULT_STOP_VELOCITY = Object.freeze({ source: 'demand', min: 0.45, max: 1, invert: false })

// Instruments that ignore note velocity, so the mapping does nothing there.
// A lane switched to one keeps its mapping (shown inactive).
export const VELOCITY_DEAF_SYNTHS = new Set(['PluckSynth'])

const SIGNAL_KEY = { demand: 'demand', hubs: 'centrality' }

const clampVel = v => Math.max(VELOCITY_RANGE.min, Math.min(VELOCITY_RANGE.max, v))
const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * A validated mapping config, or null (= off). Bounds are clamped to
 * VELOCITY_RANGE and reordered so `min` never exceeds `max`.
 */
export function normalizeVelocityMapping(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null
  if (!STOP_VELOCITY_SOURCES.includes(cfg.source)) return null
  const min = cfg.min === undefined || cfg.min === null ? DEFAULT_STOP_VELOCITY.min : cfg.min
  const max = cfg.max === undefined || cfg.max === null ? DEFAULT_STOP_VELOCITY.max : cfg.max
  if (!isNum(min) || !isNum(max)) return null
  const invert = cfg.invert === undefined || cfg.invert === null ? false : cfg.invert
  if (typeof invert !== 'boolean') return null
  const a = clampVel(min), b = clampVel(max)
  return { source: cfg.source, min: Math.min(a, b), max: Math.max(a, b), invert }
}

/** Sparse, validated copy of a routeId → config map (invalid entries dropped). */
export function normalizeVelocityMappingMap(map) {
  const out = {}
  if (!map || typeof map !== 'object') return out
  for (const [id, cfg] of Object.entries(map)) {
    const norm = normalizeVelocityMapping(cfg)
    if (norm) out[id] = norm
  }
  return out
}

/**
 * The 0–1 signal a source reads from a stop, or null when the stop has none.
 * Zero is real data (a quiet stop / a stop with no transfers); a missing
 * value is not, and must not quietly become one.
 */
export function stopSignal(stop, source) {
  const v = stop?.signals?.[SIGNAL_KEY[source]]
  if (!isNum(v)) return null
  return Math.max(0, Math.min(1, v))
}

/** Every source's signal for a stop — what merged chord cells carry. */
export function stopSignals(stop) {
  const out = {}
  for (const src of STOP_VELOCITY_SOURCES) out[src] = stopSignal(stop, src)
  return out
}

/**
 * A merged chord's signals: per source, the strongest contributing stop, so a
 * hub accents the shared chord. Missing contributors are ignored.
 */
export function mergedChordSignals(list) {
  const out = {}
  for (const src of STOP_VELOCITY_SOURCES) {
    let best = null
    for (const s of list ?? []) {
      const v = s?.[src]
      if (isNum(v) && (best == null || v > best)) best = v
    }
    out[src] = best
  }
  return out
}

/** Signal → velocity within the config's bounds, or null when it can't apply. */
export function mappedStopVelocity(cfg, signal) {
  const norm = normalizeVelocityMapping(cfg)
  if (!norm || !isNum(signal)) return null
  const x = Math.max(0, Math.min(1, signal))
  const t0 = norm.invert ? 1 - x : x
  const t = norm.source === 'hubs' ? t0 * t0 : t0
  return norm.min + t * (norm.max - norm.min)
}

/**
 * The one velocity precedence the engine and MIDI export share:
 * authored per-stop value → data mapping → gap-derived variety map → 1.
 * `signals` is `{ demand, hubs }` (stopSignals / mergedChordSignals).
 * Returns `{ velocity, origin }`, origin ∈ 'authored' | 'demand' | 'hubs' | 'variety'.
 */
export function resolveStopVelocity({ authored, cfg, signals, gap } = {}) {
  if (isNum(authored)) return { velocity: authored, origin: 'authored' }
  const norm = normalizeVelocityMapping(cfg)
  if (norm) {
    const v = mappedStopVelocity(norm, signals?.[norm.source])
    if (v != null) return { velocity: v, origin: norm.source }
  }
  return { velocity: isNum(gap) ? gap : 1, origin: 'variety' }
}

/** Whether a lane's mapping is heard, and if not, why. `reason` is UI copy. */
export function stopVelocityStatus({ cfg, synthType } = {}) {
  if (!normalizeVelocityMapping(cfg)) return { active: false, reason: null }
  if (VELOCITY_DEAF_SYNTHS.has(synthType)) return { active: false, reason: 'Pluck ignores velocity' }
  return { active: true, reason: null }
}

// UI copy shared by the desktop rack and the phone lane sheet.
export const STOP_VELOCITY_HINTS = {
  demand: 'Busier stops play louder.',
  hubs: 'Transfer stations accent.',
}
export const STOP_VELOCITY_HELP = 'From the timetable, not live passenger counts. Edited stop velocities still win.'
