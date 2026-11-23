import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDrumKit, normalizePadVoice, drumKitOf, decayToSlider, sliderToDecay, toneFilter, tuneRate,
  DRUM_KIT_IDS, DEFAULT_DRUM_KIT,
} from '../lib/drumKit.js'
import { STEPS } from '../lib/drumSpecs.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA, COMPOSITION_RESPONSE_FORMAT } from '../lib/ai/planSchema.js'
import { withNewCompositionBaseline, planDrumPattern } from '../lib/ai/planApply.js'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'

// Drum kits and per-pad tune/decay/tone (lib/drumKit.js).

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('normalize: sparse; Classic at defaults is empty', () => {
  assert.deepEqual(normalizeDrumKit(null), {})
  assert.deepEqual(normalizeDrumKit({ kit: 'classic', voices: { kick: { tune: 0, decay: 1, tone: 0 } } }), {})
  assert.deepEqual(normalizeDrumKit({ kit: 'nope' }), {})
  assert.deepEqual(normalizeDrumKit({ kit: 'layered' }), { kit: 'layered' })
  assert.deepEqual(normalizeDrumKit({ voices: { kick: { tune: -3.4 }, foo: { tune: 2 } } }),
    { voices: { kick: { tune: -3, decay: 1, tone: 0 } } })
  assert.deepEqual(normalizePadVoice({ tune: 40, decay: 0, tone: -9 }), { tune: 12, decay: 0.25, tone: -1 })
  assert.equal(drumKitOf({}), DEFAULT_DRUM_KIT)
  assert.equal(drumKitOf({ kit: 'layered' }), 'layered')
  assert.ok(DRUM_KIT_IDS.includes('classic') && DRUM_KIT_IDS.includes('layered'))
})

test('decay slider: log scale, ×1 in the middle, ends reachable', () => {
  close(decayToSlider(1), 0.5)
  close(decayToSlider(0.25), 0)
  close(decayToSlider(4), 1)
  assert.equal(sliderToDecay(0.5), 1)
  assert.equal(sliderToDecay(0.505), 1, 'snaps back to ×1')
  assert.equal(sliderToDecay(0), 0.25)
  assert.equal(sliderToDecay(1), 4)
  for (const m of [0.3, 0.5, 2, 3.5]) close(sliderToDecay(decayToSlider(m)), m, 0.01)
})

test('tone: no filter at 0, darker below, thinner above', () => {
  assert.equal(toneFilter(0), null)
  assert.equal(toneFilter(undefined), null)
  assert.equal(toneFilter(-0.5).type, 'lowpass')
  assert.ok(toneFilter(-1).frequency < toneFilter(-0.2).frequency)
  assert.equal(toneFilter(0.5).type, 'highpass')
  assert.ok(toneFilter(1).frequency > toneFilter(0.2).frequency)
  assert.ok(toneFilter(-1).frequency > 100 && toneFilter(1).frequency < 12000)
  close(tuneRate(12), 2)
  close(tuneRate(0), 1)
})

// ── Plans ────────────────────────────────────────────────────────────────────

const planRoute = (id) => ({ id, name: id, type: 'bus', stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [planRoute('P')]
const KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

test('plans: kit and pad voices validated, clamped and reported', () => {
  const raw = {
    tracks: [{ routeId: 'P' }],
    drums: {
      enabled: true, kit: 'layered',
      patterns: [{ padId: 'kick', steps: KICK, tune: -4.6, decay: 9, tone: null }],
    },
  }
  assert.ok(PLAN_INPUT_SCHEMA.parse(raw))
  const { plan } = validatePlan(raw, CITY)
  assert.equal(plan.drums.kit, 'layered')
  assert.deepEqual(plan.drums.voices, { kick: { tune: -5, decay: 4 } })
  assert.ok(validatePlan({ ...raw, drums: { ...raw.drums, kit: 'acoustic' } }, CITY).dropped.some(d => d.includes('"acoustic"')))
  const strict = JSON.stringify(COMPOSITION_RESPONSE_FORMAT)
  for (const key of ['kit', 'tune', 'decay', 'tone']) assert.ok(strict.includes(`"${key}"`), key)
})

test('plans: edits keep the kit and pad settings; new ideas reset them', () => {
  const first = validatePlan({
    tracks: [{ routeId: 'P' }],
    drums: { enabled: true, kit: 'layered', patterns: [{ padId: 'kick', steps: KICK, tune: -3, tone: -0.4 }] },
  }, CITY).plan
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), first)
  assert.equal(snapshot.drumPattern.kit, 'layered')
  assert.deepEqual(snapshot.drumPattern.voices, { kick: { tune: -3, decay: 1, tone: -0.4 } })

  const detail = describeSnapshot(snapshot, CITY, { detail: true })
  assert.equal(detail.drums.kit, 'layered')
  const kick = detail.drums.patterns.find(p => p.padId === 'kick')
  assert.equal(kick.tune, -3)
  assert.equal(kick.tone, -0.4)

  // An edit naming only the kick's decay keeps the kit and its other settings.
  const edit = validatePlan({ tracks: [{ routeId: 'P' }], drums: { enabled: true, patterns: [{ padId: 'kick', steps: KICK, decay: 2 }] } }, CITY).plan
  const edited = applyPlanToSnapshot(snapshot, edit).snapshot.drumPattern
  assert.equal(edited.kit, 'layered')
  assert.deepEqual(edited.voices.kick, { tune: -3, decay: 2, tone: -0.4 })

  // A new idea starts from Classic at defaults unless it says otherwise.
  const fresh = applyPlanToSnapshot(snapshot, withNewCompositionBaseline(edit)).snapshot.drumPattern
  assert.equal(fresh.kit, undefined)
  assert.deepEqual(fresh.voices, { kick: { tune: 0, decay: 2, tone: 0 } })
})

test('plans: a plan without kit settings builds the same pattern object as before', () => {
  const plan = validatePlan({ tracks: [{ routeId: 'P' }], drums: { enabled: true, patterns: [{ padId: 'kick', steps: KICK }] } }, CITY).plan
  assert.deepEqual(Object.keys(planDrumPattern(plan.drums, null, 100)), ['patterns', 'offsets', 'muted', 'bpm'])
  assert.equal(plan.drums.patterns.kick.length, STEPS * 4)
})
