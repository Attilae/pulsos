// Drum groove: swing, humanize, per-pad chance and per-step rolls (ratchets).
// Pure, no Tone import: the sequencer, the Drum Machine tab, MIDI export, song
// state and the AI plan contract share it. Research: docs/drum-research.md §3.
//
// Stored sparse on the drum pattern object (the same object songs, the drum
// clipboard and plans carry), so a pattern without these keys plays exactly as
// before and there is no schema bump:
//   groove:   { swing: 0..1, humanize: 0..1 }   0 / absent = straight, tight
//   chances:  { padId: 0..1 }                   absent = always plays
//   ratchets: { padId: number[64] }             1..4 hits per step, absent = 1
//
// swing 0..1 maps to the classic 50%..75% swing ratio: every second 16th is
// delayed by up to half a 16th (swing × 0.5 × 16th). Chance rolls fresh on every pass (like lane
// note chance, deliberately not repeatable). Humanize nudges timing by up to
// ±HUMANIZE_MAX_SEC and velocity by up to ±HUMANIZE_MAX_VEL, also fresh per pass.

import { PAD_DEFS, SOURCE_STEPS } from './drumSpecs.js'

export const RATCHET_MAX = 4
export const HUMANIZE_MAX_SEC = 0.012
export const HUMANIZE_MAX_VEL = 0.2
export const CHANCE_OPTIONS = [1, 0.9, 0.75, 0.5, 0.25]

const PAD_IDS = PAD_DEFS.map(p => p.id)
const isNum = v => typeof v === 'number' && Number.isFinite(v)
const clamp01 = v => Math.max(0, Math.min(1, v))

/** 1..RATCHET_MAX, anything else → 1. */
export function normalizeRatchet(v) {
  if (!isNum(v)) return 1
  return Math.max(1, Math.min(RATCHET_MAX, Math.round(v)))
}

/** Shift-click cycle: 1 → 2 → 3 → 4 → 1. */
export function cycleRatchet(v) {
  return (normalizeRatchet(v) % RATCHET_MAX) + 1
}

/** The swing ratio a 0..1 amount stands for (0.5 = straight, 0.75 = full). */
export function swingRatio(swing) {
  return 0.5 + 0.25 * clamp01(isNum(swing) ? swing : 0)
}

/**
 * Sparse, validated groove fields of a drum pattern object: only keys that
 * differ from the defaults survive, so a groove-less pattern stays byte-identical.
 * Returns { groove?, chances?, ratchets? }.
 */
export function normalizeDrumGroove(dp) {
  const out = {}
  const swing = isNum(dp?.groove?.swing) ? clamp01(dp.groove.swing) : 0
  const humanize = isNum(dp?.groove?.humanize) ? clamp01(dp.groove.humanize) : 0
  if (swing || humanize) out.groove = { swing, humanize }

  const chances = {}
  for (const id of PAD_IDS) {
    const c = dp?.chances?.[id]
    if (isNum(c) && clamp01(c) < 1) chances[id] = clamp01(c)
  }
  if (Object.keys(chances).length) out.chances = chances

  const ratchets = {}
  for (const id of PAD_IDS) {
    const r = dp?.ratchets?.[id]
    if (!Array.isArray(r)) continue
    const steps = Array.from({ length: SOURCE_STEPS }, (_, i) => normalizeRatchet(r[i]))
    if (steps.some(n => n > 1)) ratchets[id] = steps
  }
  if (Object.keys(ratchets).length) out.ratchets = ratchets
  return out
}

/** A drum pattern object with its groove fields replaced by `groove` (normalized). */
export function withDrumGroove(dp, groove) {
  const { groove: _g, chances: _c, ratchets: _r, ...rest } = dp ?? {}
  return { ...rest, ...normalizeDrumGroove(groove) }
}

/** Seconds a step is pushed late by swing: odd 16ths only. */
export function swingDelay(step, swing, sixteenthSec) {
  if (step % 2 !== 1) return 0
  return (swingRatio(swing) - 0.5) * 2 * sixteenthSec
}

/**
 * The hits one sounding step makes, as offsets from the step's grid time.
 * Empty when the pad's chance roll fails (all sub-hits skip together).
 * @returns {{offset: number, vel: number}[]}
 */
export function drumStepHits({
  step, vel, ratchet = 1, swing = 0, humanize = 0, chance = 1, sixteenthSec, rng = Math.random,
}) {
  if (!(vel > 0) || !(sixteenthSec > 0)) return []
  if (chance < 1 && !(rng() < chance)) return []
  const h = clamp01(humanize)
  // Capped at 1/16 of a 16th so two neighbouring hits (even a 4-hit roll on a
  // fully swung step, whose gap is 1/8 of a 16th) can never swap order.
  const maxNudge = Math.min(HUMANIZE_MAX_SEC, sixteenthSec / 16) * h
  const nudge = h ? (rng() * 2 - 1) * maxNudge : 0
  const velScale = h ? 1 + (rng() * 2 - 1) * HUMANIZE_MAX_VEL * h : 1
  const delay = swingDelay(step, swing, sixteenthSec)
  const base = delay + nudge
  const n = normalizeRatchet(ratchet)
  // A roll fills the time until the next step, which on a swung step is shorter.
  const sub = (sixteenthSec - delay) / n
  const out = []
  for (let i = 0; i < n; i++) {
    // A roll builds into its last hit; a single hit keeps its velocity.
    const ramp = n === 1 ? 1 : 0.55 + 0.45 * ((i + 1) / n)
    out.push({ offset: base + i * sub, vel: Math.max(0.05, Math.min(1, vel * velScale * ramp)) })
  }
  return out
}

/** The per-step inputs drumStepHits needs, read from a drum pattern object. */
export function padGrooveAt(dp, padId, srcIdx) {
  return {
    ratchet: normalizeRatchet(dp?.ratchets?.[padId]?.[srcIdx]),
    swing: isNum(dp?.groove?.swing) ? clamp01(dp.groove.swing) : 0,
    humanize: isNum(dp?.groove?.humanize) ? clamp01(dp.groove.humanize) : 0,
    chance: isNum(dp?.chances?.[padId]) ? clamp01(dp.chances[padId]) : 1,
  }
}
