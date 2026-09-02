// Lane loop lengths, and where a preset's lanes realign.
//
// The Song Chainer cuts each part after a fixed number of bars, but nothing in
// that UI said how long the part's lanes actually loop — so picking a bar count
// for a polyrhythm was guesswork. Everything needed to answer it is already in
// the saved snapshot: a lane's loop length is fully determined by its loop
// region and its speed multiplier.
//
// The engine expresses that as seconds (lib/engine.js, _startMockPart):
//   loopSec     = (LOOP_BEATS / bpm) * 60          // LOOP_BEATS = 16 = 4 bars
//   partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / speed
// which reduces to a bpm-independent bar count:
//   loopBars    = regionLen / GRID_STEPS_PER_BAR / speed
// Chain sections use the same 4/4 bar (songChainPlayer: item.bars * 4 * 60 / bpm),
// so the two are directly comparable.
//
// Pure and display-only — nothing here touches the engine or the transport.

import { GRID_TOTAL_CELLS, GRID_STEPS_PER_BAR } from './mappings.js'
import {
  snapshotBaseRouteIds, resolveSnapshotLanes, snapshotLaneDisabledMap,
} from './songLanes.js'
import { normalizeSnapshotLaneAccess } from './billing/plans.js'
import { normalizeLaneTag } from './laneTags.js'

// Mirrors DRUMS_ROUTE_ID in engine.js (not imported — it would drag in Tone.js).
const DRUMS_ROUTE_ID = '__drums__'

// Loop lengths are fractional bars: speeds are {0.25, 0.5, 1, 1.5, 2, 3, 4}
// (SPEED_OPTIONS in DawView.jsx), so 1.5× turns a 16-cell loop into 10⅔ cells.
// Float LCM is not safe on that, so every length is carried as an integer count
// of *twelfths of a grid cell* — 12 is divisible by every speed denominator, so
// `cells * 12 / speed` is exact for all of them.
export const CELL_UNITS    = 12
export const UNITS_PER_BAR = GRID_STEPS_PER_BAR * CELL_UNITS   // 192

// A drum lane is a fixed one bar: DrumSequencer repeats 16 steps at '16n'
// (STEPS in lib/engines/drumEngine.js), independent of loop regions and speed.
export const DRUM_LOOP_UNITS = UNITS_PER_BAR

// Past this the "lanes realign every N bars" answer stops being useful advice.
export const MAX_CYCLE_BARS = 256
// The chain's own bars input is clamped to 1..64 (SongChainerTab).
export const MAX_ITEM_BARS  = 64
// A 1/64-bar loop over 64 bars is 4096 bricks; collapse rather than render them.
export const MAX_BRICKS     = 64

const gcd = (a, b) => { while (b) { [a, b] = [b, a % b] } return a }
const lcm = (a, b) => (a / gcd(a, b)) * b

/**
 * A lane's loop length in twelfth-of-a-cell units.
 *
 * Clamps `region` exactly as the engine does before playing it, so a snapshot
 * with an out-of-range or inverted region is measured the way it will sound
 * rather than the way it was written.
 */
export function laneLoopUnits(region, speed = 1) {
  const rawStart  = Math.round(region?.startCell ?? 0)
  const rawEnd    = Math.round(region?.endCell ?? GRID_TOTAL_CELLS)
  const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, Number.isFinite(rawStart) ? rawStart : 0))
  const endCell   = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, Number.isFinite(rawEnd) ? rawEnd : GRID_TOTAL_CELLS))
  const spd       = Number.isFinite(speed) && speed > 0 ? speed : 1
  return Math.max(1, Math.round(((endCell - startCell) * CELL_UNITS) / spd))
}

/**
 * Where a set of lane loops realigns.
 *
 * The true cycle is LCM(loops), which can be a fractional number of bars. What
 * the user can actually type is an integer, so `suggestedBars` is the smallest
 * whole bar count that is an exact multiple of that cycle:
 *   n = lcm / gcd(lcm, UNITS_PER_BAR)
 *
 * @returns {{ cycleUnits: number|null, suggestedBars: number|null, unbounded: boolean }|null}
 *   null when there is nothing to measure; `unbounded` when the cycle exceeds
 *   `maxBars` (coprime loop lengths blow up fast — 5 and 7 cells is 35 bars).
 */
export function cycleFromUnits(unitsList, { maxBars = MAX_CYCLE_BARS } = {}) {
  const units = (unitsList ?? []).filter(u => Number.isInteger(u) && u > 0)
  if (!units.length) return null

  // suggestedBars is monotone in acc (each acc divides the next), so bailing on
  // it also keeps acc itself bounded by maxBars * UNITS_PER_BAR — no overflow.
  let acc  = units[0]
  let bars = acc / gcd(acc, UNITS_PER_BAR)
  for (let i = 1; i < units.length; i += 1) {
    acc  = lcm(acc, units[i])
    bars = acc / gcd(acc, UNITS_PER_BAR)
    if (bars > maxBars) return { cycleUnits: null, suggestedBars: null, unbounded: true }
  }
  return { cycleUnits: acc, suggestedBars: bars, unbounded: false }
}

/** Snap targets for the bars input: the cycle and its first few multiples. */
export function suggestBarOptions(suggestedBars, max = MAX_ITEM_BARS) {
  if (!Number.isInteger(suggestedBars) || suggestedBars < 1) return []
  return [1, 2, 4].map(m => suggestedBars * m).filter(n => n <= max)
}

/**
 * How one lane's loop tiles across a part of `bars` bars — the "lego bricks".
 *
 * `remainderUnits > 0` is the interesting case: the part cuts that lane
 * mid-loop, which is exactly the misalignment the strip exists to show.
 */
export function buildLoopBricks(loopUnits, bars, { maxBricks = MAX_BRICKS } = {}) {
  const barCount  = Math.max(1, Math.round(Number.isFinite(bars) ? bars : 1))
  const totalUnits = barCount * UNITS_PER_BAR
  const loop = Number.isInteger(loopUnits) && loopUnits > 0 ? loopUnits : totalUnits

  const fullCount      = Math.floor(totalUnits / loop)
  const remainderUnits = totalUnits - fullCount * loop

  return {
    loopUnits: loop,
    totalUnits,
    // Width of one full brick as a % of the part. A loop longer than the whole
    // part clamps to 100% and reports `truncated` — it never completes once.
    widthPct: Math.min(100, (loop / totalUnits) * 100),
    partialPct: (remainderUnits / totalUnits) * 100,
    fullCount,
    remainderUnits,
    aligned: remainderUnits === 0,
    truncated: loop > totalUnits,
    collapsed: fullCount > maxBricks,
  }
}

function laneDescriptor(id, route, s) {
  const tag       = normalizeLaneTag(s.trackLabels?.[id])
  const loopUnits = laneLoopUnits(s.trackLoopRegions?.[id], s.trackSpeeds?.[id] ?? 1)
  return {
    id,
    name:     tag.text || route?.name || id,
    color:    tag.color || route?.color || null,
    loopUnits,
    loopBars: loopUnits / UNITS_PER_BAR,
  }
}

const EMPTY = {
  lanes: [], cycleUnits: null, suggestedBars: null,
  unbounded: false, unknownLanes: false, missingIds: [],
}

/**
 * Everything one chain row needs to draw: its audible lanes with their loop
 * lengths, and where they realign.
 *
 * Reuses the same resolvers playback does (billing cap → lane set → disabled
 * map) so the strip can't claim a lane the section won't actually sound.
 */
export function describeSnapshotLoops(snapshot, routes, { activeLaneLimit = null } = {}) {
  if (!snapshot) return EMPTY

  // resolveSnapshotRoutes deliberately falls back to the *entire* city route
  // list when a snapshot records no ids (songLanes.js — "play something rather
  // than silence"). Sound advice for audio, useless as a picture: it would draw
  // several hundred lanes. Pre-v3 songs simply don't know their lane list.
  if (!snapshotBaseRouteIds(snapshot).length) return { ...EMPTY, unknownLanes: true }

  const capped = normalizeSnapshotLaneAccess(snapshot, routes, activeLaneLimit) ?? snapshot
  const s      = capped.state ?? capped

  const { lanes, missingIds } = resolveSnapshotLanes(routes, capped)
  const disabled = snapshotLaneDisabledMap(lanes, capped)
  const solo     = new Set(s.soloRoutes ?? [])

  // Merge-consumed and automation-source lanes exist in the lane set but never
  // render as instruments — same exclusions normalizeSnapshotLaneAccess makes.
  const consumed = new Set((s.merges ?? []).flatMap(m => m?.sourceIds ?? []))
  const autoSources = new Set()
  for (const laneMap of Object.values(s.automationCfg ?? {})) {
    for (const lane of Object.values(laneMap ?? {})) {
      if (lane?.sourceRouteId) autoSources.add(lane.sourceRouteId)
    }
  }

  const out = []
  for (const route of lanes) {
    const id = route?.id
    if (!id || consumed.has(id) || autoSources.has(id)) continue
    if (disabled[id]) continue
    if (solo.size && !solo.has(id)) continue
    out.push(laneDescriptor(id, route, s))
  }

  // The drum lane has no solo button, and _applyRouteGain silences it whenever
  // any other lane is soloed — so a live solo set means no drums.
  const drumsAudible = !!s.drumPattern && !s.drumsMuted
    && !s.muted?.[DRUMS_ROUTE_ID] && solo.size === 0
  if (drumsAudible) {
    out.push({
      id: DRUMS_ROUTE_ID,
      name: 'Drums',
      color: null,
      loopUnits: DRUM_LOOP_UNITS,
      loopBars: DRUM_LOOP_UNITS / UNITS_PER_BAR,
    })
  }

  const cycle = cycleFromUnits(out.map(l => l.loopUnits))
  return {
    lanes: out,
    cycleUnits:   cycle?.cycleUnits   ?? null,
    suggestedBars: cycle?.suggestedBars ?? null,
    unbounded:    cycle?.unbounded    ?? false,
    unknownLanes: false,
    missingIds,
  }
}

/** "7/8", "1", "3½" — a loop length humans can read off the strip. */
export function formatBars(bars) {
  if (!Number.isFinite(bars) || bars <= 0) return '—'
  if (Number.isInteger(bars)) return String(bars)
  // Loop lengths are n/192 of a bar; show the reduced fraction rather than a
  // rounded decimal, since 7/8 is the whole point and 0.88 is not.
  const num = Math.round(bars * UNITS_PER_BAR)
  const den = UNITS_PER_BAR
  const g   = gcd(num, den)
  const n   = num / g
  const d   = den / g
  const whole = Math.floor(n / d)
  const rem   = n % d
  return whole ? `${whole} ${rem}/${d}` : `${n}/${d}`
}
