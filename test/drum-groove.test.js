import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDrumGroove, withDrumGroove, normalizeRatchet, cycleRatchet, swingRatio, swingDelay,
  drumStepHits, padGrooveAt, HUMANIZE_MAX_SEC, RATCHET_MAX,
} from '../lib/drumGroove.js'
import { SOURCE_STEPS, STEPS } from '../lib/drumSpecs.js'
import { mulberry32 } from '../lib/mappings.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA, COMPOSITION_RESPONSE_FORMAT } from '../lib/ai/planSchema.js'
import { withNewCompositionBaseline, planDrumPattern } from '../lib/ai/planApply.js'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'

// Drum groove (lib/drumGroove.js): swing, humanize, per-pad chance, per-step rolls.

const S16 = 0.125 // a 16th at 120 BPM
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≉ ${b}`)
const rolls = (n, at = []) => Array.from({ length: SOURCE_STEPS }, (_, i) => (at.includes(i) ? n : 1))

test('normalize: sparse, clamped, and empty for a groove-less pattern', () => {
  assert.deepEqual(normalizeDrumGroove(null), {})
  assert.deepEqual(normalizeDrumGroove({ patterns: {}, offsets: {} }), {})
  assert.deepEqual(normalizeDrumGroove({ groove: { swing: 0, humanize: 0 }, chances: { kick: 1 } }), {})
  assert.deepEqual(normalizeDrumGroove({ groove: { swing: 2, humanize: -1 } }), { groove: { swing: 1, humanize: 0 } })
  assert.deepEqual(normalizeDrumGroove({ chances: { hat: 0.5, nope: 0.2, ride: 'x' } }), { chances: { hat: 0.5 } })
  const r = normalizeDrumGroove({ ratchets: { hat: [3, 9, 0, 'x'], snare: [1, 1] } })
  assert.deepEqual(Object.keys(r.ratchets), ['hat'])
  assert.equal(r.ratchets.hat.length, SOURCE_STEPS)
  assert.deepEqual(r.ratchets.hat.slice(0, 5), [3, RATCHET_MAX, 1, 1, 1])
})

test('withDrumGroove replaces only the groove keys', () => {
  const dp = { patterns: { kick: [1] }, bpm: 90, groove: { swing: 0.5, humanize: 0 }, chances: { hat: 0.5 } }
  assert.deepEqual(withDrumGroove(dp, { groove: { swing: 0.2 } }),
    { patterns: { kick: [1] }, bpm: 90, groove: { swing: 0.2, humanize: 0 } })
  assert.deepEqual(withDrumGroove(dp, {}), { patterns: { kick: [1] }, bpm: 90 })
})

test('ratchet values and the shift-click cycle', () => {
  assert.equal(normalizeRatchet(undefined), 1)
  assert.equal(normalizeRatchet(2.4), 2)
  assert.equal(normalizeRatchet(0), 1)
  assert.deepEqual([1, 2, 3, 4].map(cycleRatchet), [2, 3, 4, 1])
})

test('swing: 50%..75% ratio, odd 16ths only', () => {
  assert.equal(swingRatio(0), 0.5)
  assert.equal(swingRatio(1), 0.75)
  assert.equal(swingDelay(0, 1, S16), 0)
  close(swingDelay(1, 1, S16), S16 / 2)
  close(swingDelay(3, 0.5, S16), S16 / 4)
  assert.equal(swingDelay(2, 1, S16), 0)
})

test('hits: a plain step is exactly one hit on the grid (pre-groove playback)', () => {
  for (let step = 0; step < STEPS; step++) {
    assert.deepEqual(drumStepHits({ step, vel: 0.7, sixteenthSec: S16 }), [{ offset: 0, vel: 0.7 }])
  }
  assert.deepEqual(drumStepHits({ step: 0, vel: 0, sixteenthSec: S16 }), [])
})

test('hits: chance skips the whole step, rolls included', () => {
  assert.deepEqual(drumStepHits({ step: 0, vel: 1, chance: 0, ratchet: 3, sixteenthSec: S16 }), [])
  assert.equal(drumStepHits({ step: 0, vel: 1, chance: 0.5, sixteenthSec: S16, rng: () => 0.4 }).length, 1)
  assert.equal(drumStepHits({ step: 0, vel: 1, chance: 0.5, sixteenthSec: S16, rng: () => 0.6 }).length, 0)
  const rng = mulberry32(7)
  let played = 0
  for (let i = 0; i < 4000; i++) played += drumStepHits({ step: 0, vel: 1, chance: 0.25, sixteenthSec: S16, rng }).length
  assert.ok(Math.abs(played / 4000 - 0.25) < 0.03, `played ${played}`)
})

test('hits: a roll fills its step evenly and builds into a full last hit', () => {
  const hits = drumStepHits({ step: 0, vel: 1, ratchet: 4, sixteenthSec: S16 })
  assert.deepEqual(hits.map(h => h.offset), [0, S16 / 4, S16 / 2, (3 * S16) / 4])
  assert.equal(hits.at(-1).vel, 1)
  assert.ok(hits[0].vel < hits[1].vel && hits[1].vel < hits[2].vel)
  // On a fully swung step the roll squeezes into the half-16th that is left.
  const swung = drumStepHits({ step: 1, vel: 1, ratchet: 4, swing: 1, sixteenthSec: S16 })
  close(swung[0].offset, S16 / 2)
  assert.ok(swung.at(-1).offset < S16, 'ends before the next step')
})

test('hits: humanize stays bounded and never reorders neighbouring hits', () => {
  const rng = mulberry32(42)
  for (const s16 of [S16, 60 / 240 / 4]) {
    for (let pass = 0; pass < 300; pass++) {
      let last = -Infinity
      for (let step = 0; step < STEPS; step++) {
        const hits = drumStepHits({ step, vel: 1, ratchet: 1 + (step % 4), swing: 1, humanize: 1, sixteenthSec: s16, rng })
        for (const h of hits) {
          const t = step * s16 + h.offset
          assert.ok(t >= last - 1e-12, `step ${step} went back in time`)
          last = t
          assert.ok(h.vel > 0 && h.vel <= 1)
        }
        const nudge = hits[0].offset - swingDelay(step, 1, s16)
        assert.ok(Math.abs(nudge) <= HUMANIZE_MAX_SEC + 1e-12)
      }
    }
  }
})

test('padGrooveAt reads a pattern object with defaults', () => {
  assert.deepEqual(padGrooveAt({}, 'kick', 3), { ratchet: 1, swing: 0, humanize: 0, chance: 1 })
  const dp = { groove: { swing: 0.4, humanize: 0.1 }, chances: { hat: 0.5 }, ratchets: { hat: rolls(3, [3]) } }
  assert.deepEqual(padGrooveAt(dp, 'hat', 3), { ratchet: 3, swing: 0.4, humanize: 0.1, chance: 0.5 })
})

// ── Plans ────────────────────────────────────────────────────────────────────

const planRoute = (id) => ({ id, name: id, type: 'bus', stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [planRoute('P')]
const HAT = [1, 0, 0.7, 0, 1, 0, 0.7, 0, 1, 0, 0.7, 0, 1, 0, 0.7, 0.4]
const ROLLS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 2]

test('plans: groove validated, clamped and reported', () => {
  const raw = {
    tracks: [{ routeId: 'P' }],
    drums: {
      enabled: true, swing: 0.3, humanize: 4,
      patterns: [
        { padId: 'hat', steps: HAT, chance: 0.6, ratchets: ROLLS },
        { padId: 'kick', steps: HAT, chance: 1, ratchets: [2, 2] },
      ],
    },
  }
  assert.ok(PLAN_INPUT_SCHEMA.parse({ ...raw, drums: { ...raw.drums, patterns: [raw.drums.patterns[0]] } }))
  const { plan, dropped } = validatePlan(raw, CITY)
  assert.equal(plan.drums.swing, 0.3)
  assert.equal(plan.drums.humanize, 1)
  assert.deepEqual(plan.drums.chances, { hat: 0.6 })
  assert.deepEqual(plan.drums.ratchets.hat.slice(0, STEPS), ROLLS)
  assert.equal(plan.drums.ratchets.hat.length, SOURCE_STEPS)
  assert.ok(!plan.drums.ratchets.kick)
  assert.ok(dropped.some(d => d.includes('"kick" ratchets')))

  // Strict schema (OpenRouter) lists the new keys as required-nullable.
  const strict = JSON.stringify(COMPOSITION_RESPONSE_FORMAT)
  for (const key of ['swing', 'humanize', 'chance', 'ratchets']) assert.ok(strict.includes(`"${key}"`), key)
})

test('plans: both apply paths build the same pattern; edits keep swing, new ideas reset it', () => {
  const plan = validatePlan({
    tracks: [{ routeId: 'P' }],
    drums: { enabled: true, swing: 0.5, patterns: [{ padId: 'hat', steps: HAT, chance: 0.75, ratchets: ROLLS }] },
  }, CITY).plan
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan)
  assert.deepEqual(snapshot.drumPattern, planDrumPattern(plan.drums, null, snapshot.bpm))
  assert.deepEqual(snapshot.drumPattern.groove, { swing: 0.5, humanize: 0 })
  assert.deepEqual(snapshot.drumPattern.chances, { hat: 0.75 })

  // describeSnapshot hands the groove back in plan shape.
  const detail = describeSnapshot(snapshot, CITY, { detail: true })
  assert.equal(detail.drums.swing, 0.5)
  const hat = detail.drums.patterns.find(p => p.padId === 'hat')
  assert.equal(hat.chance, 0.75)
  assert.deepEqual(hat.ratchets, ROLLS)

  // An edit that rewrites the pattern without naming swing keeps it…
  const edit = validatePlan({ tracks: [{ routeId: 'P' }], drums: { enabled: true, patterns: [{ padId: 'kick', steps: HAT }] } }, CITY).plan
  const edited = applyPlanToSnapshot(snapshot, edit).snapshot.drumPattern
  assert.equal(edited.groove.swing, 0.5)
  assert.equal(edited.chances, undefined, 'chances and rolls belong to the replaced steps')
  assert.equal(edited.ratchets, undefined)
  // …a new composition starts straight.
  const fresh = applyPlanToSnapshot(snapshot, withNewCompositionBaseline(edit)).snapshot.drumPattern
  assert.equal(fresh.groove, undefined)
})

test('plans: a groove-less plan builds the same pattern object as before', () => {
  const plan = validatePlan({ tracks: [{ routeId: 'P' }], drums: { enabled: true, patterns: [{ padId: 'hat', steps: HAT }] } }, CITY).plan
  const dp = planDrumPattern(plan.drums, null, 100)
  assert.deepEqual(Object.keys(dp), ['patterns', 'offsets', 'muted', 'bpm'])
})
