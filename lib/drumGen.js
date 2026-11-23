// Drum patterns from a transit line. Pure, no Tone import: the Drum Machine tab
// uses it today, and plans/MCP can later. Research: docs/drum-research.md.
//
// Every mode returns the same shape as the original `patternFromRoute`:
//   { pattern: number[64] (step velocities), stops: string[][] (stop names per slot) }
//
// Modes:
//   distance  — a hit wherever a stop falls along the line (slot = dist / totalDist).
//               Byte-identical to the original generator: every hit at full velocity.
//   euclid    — the same number of hits per bar as `distance`, spread as evenly as
//               possible (Björklund / Toussaint E(k, 16)), rotated by the route id so
//               two lines with the same density don't play the same rhythm. Velocity
//               follows the busiest stop each hit stands for.
//   roles     — the stop's signals decide whether this pad plays it: hubs → kick on
//               the beat, transfers → snare/clap on the backbeat, every stop → hat,
//               8ths → ride, quiet stops → rim ghost notes. Falls back to `distance`
//               when the line's stops carry no signals (older lines.<city>.json).

import { SOURCE_STEPS, STEPS, STEP_LEVELS } from './drumSpecs.js'
import { hashStringToInt } from './mappings.js'

export const DRUM_GEN_MODES = ['distance', 'euclid', 'roles']
export const DRUM_GEN_LABELS = { distance: 'Distance', euclid: 'Euclidean', roles: 'Stop roles' }
export const DRUM_GEN_HINTS = {
  distance: 'A hit wherever a stop falls along the line.',
  euclid: 'The same number of hits per bar as the line has stops, spread evenly.',
  roles: 'Hubs play the kick, transfers the snare and clap, every stop the hats, quiet stops the rim.',
}
export const DEFAULT_DRUM_GEN_MODE = 'distance'

const BARS = SOURCE_STEPS / STEPS

function emptyResult() {
  return {
    pattern: new Array(SOURCE_STEPS).fill(0),
    stops: Array.from({ length: SOURCE_STEPS }, () => []),
  }
}

const isNum = v => typeof v === 'number' && Number.isFinite(v)

/**
 * Euclidean rhythm E(k, n): k onsets spread as evenly as possible over n steps,
 * rotated right by `rotation`. Bresenham form, which yields the same necklaces as
 * Björklund's algorithm (E(3,8) = x..x..x.).
 */
export function euclid(k, n, rotation = 0) {
  const len = Math.max(0, Math.floor(n))
  const hits = Math.max(0, Math.min(len, Math.floor(k)))
  const out = new Array(len).fill(false)
  if (!len || !hits) return out
  const rot = ((Math.floor(rotation) % len) + len) % len
  for (let i = 0; i < len; i++) {
    if ((i * hits) % len < hits) out[(i + rot) % len] = true
  }
  return out
}

/** Nearest non-zero step level (1 / 0.7 / 0.4), so generated steps cycle like clicked ones. */
export function snapLevel(v) {
  const levels = STEP_LEVELS.filter(l => l > 0)
  let best = levels[0]
  for (const l of levels) if (Math.abs(l - v) < Math.abs(best - v)) best = l
  return best
}

// Busier stop → louder hit. Missing demand keeps the full hit the distance mode plays.
function demandLevel(stops) {
  let d = null
  for (const s of stops) {
    const v = s?.signals?.demand
    if (isNum(v)) d = d === null ? v : Math.max(d, v)
  }
  return d === null ? 1 : snapLevel(0.4 + 0.6 * Math.max(0, Math.min(1, d)))
}

function slotOf(stop, totalDist) {
  const d = isNum(stop?.dist) ? stop.dist : 0
  return Math.max(0, Math.min(SOURCE_STEPS - 1, Math.floor((d / totalDist) * SOURCE_STEPS)))
}

function usable(route) {
  return !!(route?.stops?.length && route.totalDist)
}

function place(result, slot, stops, vel) {
  if (!(vel > 0)) return
  result.pattern[slot] = Math.max(result.pattern[slot], vel)
  for (const s of stops) result.stops[slot].push(s?.name ?? '')
}

function distancePattern(route) {
  const result = emptyResult()
  if (!usable(route)) return result
  for (const stop of route.stops) place(result, slotOf(stop, route.totalDist), [stop], 1)
  return result
}

function euclidPattern(route) {
  const result = emptyResult()
  if (!usable(route)) return result
  const rotation = hashStringToInt(String(route.id ?? route.name ?? '')) % STEPS
  const bars = Array.from({ length: BARS }, () => ({ stops: [], slots: new Set() }))
  for (const stop of route.stops) {
    const slot = slotOf(stop, route.totalDist)
    const bar = bars[Math.floor(slot / STEPS)]
    bar.stops.push(stop)
    bar.slots.add(slot)
  }
  bars.forEach((bar, b) => {
    // Same density as the distance pattern (occupied slots in this bar), spread evenly.
    const k = bar.slots.size
    if (!k) return
    const hits = euclid(k, STEPS, rotation)
    const m = bar.stops.length
    let j = 0
    hits.forEach((on, i) => {
      if (!on) return
      const group = bar.stops.slice(Math.floor((j * m) / k), Math.floor(((j + 1) * m) / k))
      place(result, b * STEPS + i, group, demandLevel(group))
      j++
    })
  })
  return result
}

function quantile(sorted, q) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[idx]
}

// Nearest slot whose position in its bar is one of `targets`, staying in the same
// 64-slot buffer (wraps at the end so the last stop can land on the first beat).
function snapTo(slot, targets) {
  let best = slot, bestDist = Infinity
  for (let base = -STEPS; base <= SOURCE_STEPS; base += STEPS) {
    for (const t of targets) {
      const cand = base + t
      const dist = Math.abs(cand - slot)
      if (dist < bestDist) { best = cand; bestDist = dist }
    }
  }
  return ((best % SOURCE_STEPS) + SOURCE_STEPS) % SOURCE_STEPS
}

const QUARTERS = [0, 4, 8, 12]
const BACKBEATS = [4, 12]
const EIGHTHS = [0, 2, 4, 6, 8, 10, 12, 14]

function hasSignals(stops) {
  return stops.some(s => s?.signals && (isNum(s.signals.centrality) || isNum(s.signals.demand) || isNum(s.signals.routes)))
}

function rolesPattern(route, padId) {
  if (!usable(route)) return emptyResult()
  const stops = route.stops
  if (!hasSignals(stops)) return distancePattern(route)
  const result = emptyResult()

  const cent = stops.map(s => s?.signals?.centrality).filter(isNum).sort((a, b) => a - b)
  const dem = stops.map(s => s?.signals?.demand).filter(isNum).sort((a, b) => a - b)
  const hasRoutes = stops.some(s => isNum(s?.signals?.routes))
  const cHub = quantile(cent, 0.75)
  const cMid = quantile(cent, 0.5)
  const cFlat = !cent.length || cent[0] === cent[cent.length - 1]
  const dLow = quantile(dem, 1 / 3)
  const last = stops.length - 1

  const isHub = (s, i) => i === 0 || i === last
    || (!cFlat && isNum(s?.signals?.centrality) && s.signals.centrality >= cHub)
  const isTransfer = (s) => hasRoutes
    ? (isNum(s?.signals?.routes) && s.signals.routes >= 2)
    : (!cFlat && isNum(s?.signals?.centrality) && s.signals.centrality >= cMid)
  const isQuiet = (s) => dLow !== null && isNum(s?.signals?.demand) && s.signals.demand <= dLow

  stops.forEach((s, i) => {
    const slot = slotOf(s, route.totalDist)
    switch (padId) {
      case 'kick':
        if (isHub(s, i)) place(result, snapTo(slot, QUARTERS), [s], 1)
        break
      case 'snare':
      case 'clap':
        if (isTransfer(s)) place(result, snapTo(slot, BACKBEATS), [s], demandLevel([s]) >= 1 ? 1 : 0.7)
        break
      case 'ride':
        place(result, snapTo(slot, EIGHTHS), [s], demandLevel([s]))
        break
      case 'rim':
        if (isQuiet(s)) place(result, slot, [s], 0.4)
        break
      default: // 'hat' and any future pad: every stop, louder where busier
        place(result, slot, [s], demandLevel([s]))
    }
  })
  return result
}

/**
 * A 64-slot pad pattern from a route.
 * @param {object} route  { id, name, stops: [{name, dist, signals?}], totalDist }
 * @param {{mode?: string, padId?: string}} opts
 */
export function patternFromStops(route, { mode = DEFAULT_DRUM_GEN_MODE, padId = 'hat' } = {}) {
  if (mode === 'euclid') return euclidPattern(route)
  if (mode === 'roles') return rolesPattern(route, padId)
  return distancePattern(route)
}
