// Per-lane note chance and loop rest patterns.
//
// Two independent gates decide whether a scheduled lane note actually sounds:
//
//   • Loop pattern — a lane plays `play` of its own loops, then rests for `rest`
//     loops, phase-shifted by `offset`. "Every 4th loop" is { play: 1, rest: 3 };
//     "skip 2" is { play: 1, rest: 2 }. Loops are counted in the lane's *own*
//     cycle (its loop region and speed), the same cycle the polyrhythm runs on.
//   • Note chance — each note rolls fresh dice on every pass. A per-stop
//     override beats the lane value, so one note can be made rare or certain.
//
// Defaults (chance 1, play 1 / rest 0) are exactly "always play", so a song
// saved before these existed sounds unchanged.
//
// Pure and dependency-free — the engine, MixerTab, the Song Chainer loop strip
// and the MIDI exporter all read it.

export const DEFAULT_NOTE_CHANCE  = 1
export const DEFAULT_LOOP_PATTERN = Object.freeze({ play: 1, rest: 0, offset: 0 })

export const MAX_PATTERN_PLAY = 16
export const MAX_PATTERN_REST = 16

export const LOOP_PATTERN_PRESETS = [
  { id: 'every',   label: 'ALL', title: 'Play every loop',                  play: 1, rest: 0 },
  { id: 'alt',     label: '1:1', title: 'Play one loop, rest one',          play: 1, rest: 1 },
  { id: 'skip2',   label: '1:2', title: 'Play one loop, skip two',          play: 1, rest: 2 },
  { id: 'every4',  label: '1:3', title: 'Play every 4th loop',              play: 1, rest: 3 },
  { id: 'twoTwo',  label: '2:2', title: 'Play two loops, rest two',         play: 2, rest: 2 },
  { id: 'threeOne', label: '3:1', title: 'Play three loops, rest one',      play: 3, rest: 1 },
]

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback
}

/** Clamp a 0..1 chance; anything unparseable means "always play". */
export function normalizeNoteChance(v) {
  const n = Number(v)
  if (v == null || !Number.isFinite(n)) return DEFAULT_NOTE_CHANCE
  return Math.max(0, Math.min(1, n))
}

/**
 * Coerce a pattern into range. It can arrive from a shared-song link, so every
 * field is validated rather than trusted.
 */
export function normalizeLoopPattern(p) {
  const play   = clampInt(p?.play, 1, MAX_PATTERN_PLAY, 1)
  const rest   = clampInt(p?.rest, 0, MAX_PATTERN_REST, 0)
  const period = play + rest
  const rawOff = clampInt(p?.offset, -1e6, 1e6, 0)
  const offset = ((rawOff % period) + period) % period
  return { play, rest, offset }
}

export function patternPeriod(p) {
  const { play, rest } = normalizeLoopPattern(p)
  return play + rest
}

export function isDefaultPattern(p) {
  return normalizeLoopPattern(p).rest === 0
}

/** Does loop number `loopIndex` (0-based) play under pattern `p`? */
export function loopPlays(loopIndex, p) {
  const { play, rest, offset } = normalizeLoopPattern(p)
  if (rest === 0) return true
  const period = play + rest
  const phase  = (((loopIndex - offset) % period) + period) % period
  return phase < play
}

/**
 * Which pass of its own loop a lane is on at transport time `transportSec`.
 * The epsilon keeps the event scheduled exactly on a loop boundary in the new
 * loop despite float error.
 */
export function loopIndexAt(transportSec, startAt, loopSec) {
  if (!(loopSec > 0)) return 0
  const idx = Math.floor((transportSec - (startAt ?? 0)) / loopSec + 1e-6)
  return idx > 0 ? idx : 0
}

/** A per-stop override wins over the lane value. */
export function resolveNoteChance(laneChance, stopChance) {
  if (stopChance != null) return normalizeNoteChance(stopChance)
  return normalizeNoteChance(laneChance)
}

/** Roll the dice. Certain outcomes never consume the RNG. */
export function rollChance(chance, rng = Math.random) {
  if (chance >= 1) return true
  if (!(chance > 0)) return false
  return rng() < chance
}

/** Short label for a lane-header badge, or '' when the pattern is the default. */
export function formatLoopPattern(p) {
  const { play, rest, offset } = normalizeLoopPattern(p)
  if (rest === 0) return ''
  return offset ? `${play}:${rest}+${offset}` : `${play}:${rest}`
}

// ── Snapshot sanitizers ─────────────────────────────────────────────────────
// All three maps are sparse: an entry equal to the default is dropped, so an
// absent key keeps meaning "always play". Run on save and on load — a snapshot
// can arrive from a shared link.

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v)

/** routeId → 0..1 */
export function normalizeNoteChanceMap(m) {
  const out = {}
  if (!isObj(m)) return out
  for (const [rid, v] of Object.entries(m)) {
    if (v == null || !Number.isFinite(Number(v))) continue
    const c = normalizeNoteChance(v)
    if (c < 1) out[rid] = c
  }
  return out
}

/** routeId → { stopId: 0..1 }. A stop override of 1 is meaningful (it beats a lower lane chance), so it is kept. */
export function normalizeStopChanceMap(m) {
  const out = {}
  if (!isObj(m)) return out
  for (const [rid, stops] of Object.entries(m)) {
    if (!isObj(stops)) continue
    const inner = {}
    for (const [sid, v] of Object.entries(stops)) {
      if (v == null || !Number.isFinite(Number(v))) continue
      inner[sid] = normalizeNoteChance(v)
    }
    if (Object.keys(inner).length) out[rid] = inner
  }
  return out
}

/** routeId → { play, rest, offset } */
export function normalizeLoopPatternMap(m) {
  const out = {}
  if (!isObj(m)) return out
  for (const [rid, p] of Object.entries(m)) {
    if (!isObj(p)) continue
    const n = normalizeLoopPattern(p)
    if (n.rest > 0) out[rid] = n
  }
  return out
}
