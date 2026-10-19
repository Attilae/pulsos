// Stop-driven note length: a lane can derive each stop note's hold time from
// the stop's baked-in demand (`stop.signals.demand`, city-normalized 0–1 at
// preprocess time — see docs/stop-signals.md) instead of one fixed length.
// Quiet stops hold short, busy interchanges sustain, and a PolySynth lets the
// different pitches overlap so a pad's density follows the line.
//
// Stored sparse (`trackStopNoteLengths`, routeId → config): absent means Fixed,
// i.e. the lane's ordinary `trackNoteLengths` gate (lib/noteLength.js), which
// stays the fallback for stops without demand. No schema bump.
//
// Demand is an estimate from scheduled service, not passenger counts or live
// occupancy. It is read as stored: never re-normalized over a lane or its loop
// window, so trimming a loop can't change the length a stop is given.
//
// Pure — engine, MIDI export, song snapshots, UI and the AI plan contract share it.

import { NOTE_LENGTHS, NOTE_LENGTH_BEATS, NOTE_LENGTH_LABELS } from './noteLength.js'

export const STOP_NOTE_LENGTH_SOURCES = ['demand']
export const DEFAULT_STOP_NOTE_LENGTH = Object.freeze({ source: 'demand', min: '4n', max: '1n', invert: false })

// Instruments the mapping drives. Others keep the fixed gate; a lane switched
// away from one keeps its mapping (shown inactive) for when it switches back.
export const STOP_NOTE_LENGTH_SYNTHS = new Set(['PolySynth'])

const isLength = v => typeof v === 'string' && v in NOTE_LENGTH_BEATS

/**
 * A validated mapping config, or null (= Fixed). Bounds are reordered so
 * `min` is never longer than `max`; anything malformed is dropped.
 */
export function normalizeStopNoteLength(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null
  if (!STOP_NOTE_LENGTH_SOURCES.includes(cfg.source)) return null
  const min = cfg.min === undefined ? DEFAULT_STOP_NOTE_LENGTH.min : cfg.min
  const max = cfg.max === undefined ? DEFAULT_STOP_NOTE_LENGTH.max : cfg.max
  if (!isLength(min) || !isLength(max)) return null
  const invert = cfg.invert === undefined ? false : cfg.invert
  if (typeof invert !== 'boolean') return null
  const [lo, hi] = NOTE_LENGTH_BEATS[min] <= NOTE_LENGTH_BEATS[max] ? [min, max] : [max, min]
  return { source: cfg.source, min: lo, max: hi, invert }
}

/** Sparse, validated copy of a routeId → config map (invalid entries dropped). */
export function normalizeStopNoteLengthMap(map) {
  const out = {}
  if (!map || typeof map !== 'object') return out
  for (const [id, cfg] of Object.entries(map)) {
    const norm = normalizeStopNoteLength(cfg)
    if (norm) out[id] = norm
  }
  return out
}

/**
 * A stop's demand, clamped to 0–1, or null when it has none. Zero is real
 * data (a quiet stop); a missing or non-numeric value is not, and must not
 * quietly become one.
 */
export function stopDemand(stop) {
  const d = stop?.signals?.demand
  if (typeof d !== 'number' || !Number.isFinite(d)) return null
  return Math.max(0, Math.min(1, d))
}

/**
 * A merged chord's input: the busiest contributing stop's demand, so a hub
 * holds the shared chord gate longest. Missing contributors are ignored;
 * null when none has demand.
 */
export function mergedChordDemand(demands) {
  let best = null
  for (const d of demands ?? []) {
    if (typeof d !== 'number' || !Number.isFinite(d)) continue
    const v = Math.max(0, Math.min(1, d))
    if (best == null || v > best) best = v
  }
  return best
}

/**
 * Demand → a note length within the config's bounds. Interpolates in beats,
 * then quantizes to the nearest allowed length between the bounds (ties go to
 * the shorter one). Null when the mapping can't apply (no config, no demand):
 * the caller then plays its fixed/legacy gate.
 */
export function resolveDemandLength(cfg, demand) {
  const norm = normalizeStopNoteLength(cfg)
  if (!norm || typeof demand !== 'number' || !Number.isFinite(demand)) return null
  const d = Math.max(0, Math.min(1, demand))
  const t = norm.invert ? 1 - d : d
  const lo = NOTE_LENGTH_BEATS[norm.min]
  const hi = NOTE_LENGTH_BEATS[norm.max]
  const target = lo + t * (hi - lo)
  let best = null
  for (const len of NOTE_LENGTHS) {   // shortest first, so a tie keeps the shorter
    const beats = NOTE_LENGTH_BEATS[len]
    if (beats < lo || beats > hi) continue
    if (best == null || Math.abs(beats - target) < Math.abs(NOTE_LENGTH_BEATS[best] - target) - 1e-9) best = len
  }
  return best
}

/**
 * Whether a lane's mapping drives its notes, and if not, why. Precedence:
 * drone, then the arpeggiator, then legato (merged lanes have none), then
 * the instrument. `reason` is UI copy.
 */
export function stopNoteLengthStatus({ cfg, synthType, arp, legato, drone, merged } = {}) {
  if (!normalizeStopNoteLength(cfg)) return { active: false, reason: null }
  if (drone) return { active: false, reason: 'Drone holds every note' }
  if (arp) return { active: false, reason: 'Arpeggiator controls note length' }
  if (legato && !merged) return { active: false, reason: 'Legato controls note length' }
  if (!STOP_NOTE_LENGTH_SYNTHS.has(synthType)) return { active: false, reason: 'Available for Poly / Pad' }
  return { active: true, reason: null }
}

/**
 * One stop's (or chord's) requested hold: `{ length, beats, demand, fallback }`.
 * `fallback` is true when demand is missing and the fixed gate (`fixedLength`,
 * or `fallbackBeats` for the legacy gate) plays instead.
 */
export function resolveStopHold(cfg, demand, fixedLength = null, fallbackBeats = 1) {
  const mapped = resolveDemandLength(cfg, demand)
  if (mapped) return { length: mapped, beats: NOTE_LENGTH_BEATS[mapped], demand, fallback: false }
  const fixed = isLength(fixedLength) ? fixedLength : null
  return { length: fixed, beats: fixed ? NOTE_LENGTH_BEATS[fixed] : fallbackBeats, demand: null, fallback: true }
}

/** Display label for a hold: "1/2", "1 bar", or the legacy beat count. */
export function holdLabel(hold) {
  if (hold?.length) return NOTE_LENGTH_LABELS[hold.length] ?? hold.length
  return hold?.beats === 0.5 ? NOTE_LENGTH_LABELS['8n'] : NOTE_LENGTH_LABELS['4n']
}

/**
 * Same-pitch protection, as a fraction of the loop. Given each scheduled
 * event's loop position (0–1) and resolved pitches, returns for event `i` and
 * `pitch` how far ahead the next onset of that pitch is, wrapping the loop (an
 * event that is its pitch's only onset gets a whole loop). A mapped gate is
 * cut there, so a held note's release never lands on — and releases — the
 * newer voice of the same pitch. Every scheduled onset counts, even one note
 * chance may later skip: the rule stays deterministic.
 */
export function nextSamePitchFrac(events, i, pitch) {
  const n = events.length
  const here = events[i]?.frac ?? 0
  for (let k = 1; k <= n; k++) {
    const j = (i + k) % n
    const ev = events[j]
    if (!ev?.pitches?.includes(pitch)) continue
    let delta = ev.frac - here
    if (delta <= 1e-9) delta += 1
    return delta
  }
  return 1
}

// UI copy shared by the desktop rack and the phone lane sheet.
export const STOP_NOTE_LENGTH_HINT = 'Busier stops sustain longer.'
export const STOP_NOTE_LENGTH_HELP = 'Demand is estimated from scheduled service, not live passenger counts.'
export const STOP_NOTE_LENGTH_MERGED_HELP = 'A chord holds for its busiest stop.'

/**
 * Hold preview for the stop rail and stop editor, using the same rules as
 * playback. `points` are a lane's scheduled stops (in the loop window), each
 * `{ key, frac, midi, demand }` with `frac` its 0–1 position in the loop;
 * `loopBeats` is one pass of the loop in beats at the lane's speed. Returns a
 * Map key → `{ requested, effectiveBeats, cut }`, where `requested` is
 * resolveStopHold's result and `cut` says same-pitch protection shortened it.
 */
export function previewStopHolds(points, { cfg, fixedLength = null, fallbackBeats = 1, loopBeats = 16 } = {}) {
  const out = new Map()
  const events = (points ?? []).map(p => ({ frac: p.frac, pitches: [p.midi] }))
  ;(points ?? []).forEach((p, i) => {
    const requested = resolveStopHold(cfg, p.demand, fixedLength, fallbackBeats)
    if (requested.fallback) { out.set(p.key, { requested, effectiveBeats: requested.beats, cut: false }); return }
    const bound = nextSamePitchFrac(events, i, p.midi) * loopBeats
    const effectiveBeats = Math.min(requested.beats, bound)
    out.set(p.key, { requested, effectiveBeats, cut: effectiveBeats < requested.beats - 1e-9 })
  })
  return out
}
