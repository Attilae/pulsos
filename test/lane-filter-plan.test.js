import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'
import { validatePlan, buildComposerGuide } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA, COMPOSITION_RESPONSE_FORMAT } from '../lib/ai/planSchema.js'
import { withNewCompositionBaseline, planFilterState } from '../lib/ai/planApply.js'
import { buildSnapshot, applySnapshot, migrateSnapshot } from '../lib/songState.js'
import { DRUMS_ROUTE_ID } from '../lib/soundSpecs.js'
import { ANALOG_MODEL, CLASSIC_MODEL } from '../lib/laneFilterSpec.js'

// The Analog filter through the plan contract and song state: validation, the
// shared merge both apply paths use (MixerTab.applyAIPlan and
// planSnapshot.applyPlanToSnapshot), the fresh-composition reset, and the
// DAW load → save round trip.

const route = (id, type = 'tram') => ({ id, name: id, type, stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [route('M1', 'metro'), route('4'), route('9', 'bus')]
const ANALOG = { model: ANALOG_MODEL, type: 'lowpass', frequency: 640, Q: 1, resonance: 1.3, drive: 2.5, slope: 12 }

function roundTrip(snapshot, routes) {
  const state = {}
  const setters = new Proxy({}, {
    get: (_t, name) => (value) => {
      const key = String(name).slice(3)
      state[key[0].toLowerCase() + key.slice(1)] = value
    },
  })
  applySnapshot(snapshot, setters, null, snapshot.routeIds.map(id => routes.find(r => r.id === id)).filter(Boolean))
  return buildSnapshot({ ...state, cityId: snapshot.cityId, routeIds: snapshot.routeIds, laneManifest: snapshot.laneManifest })
}

test('an Analog track filter validates whole; an Analog notch is rejected', () => {
  const { plan, dropped } = validatePlan({
    tracks: [
      { routeId: 'M1', filter: ANALOG },
      { routeId: '4', filter: { model: ANALOG_MODEL, type: 'notch', frequency: 900, Q: 2 } },
    ],
  }, CITY)
  assert.deepEqual(plan.tracks[0].filter, ANALOG)
  assert.equal(plan.tracks[1].filter, undefined)
  assert.ok(dropped.some(d => /notch/.test(d) && d.includes('"4"')))
})

test('drums can take the Analog filter too', () => {
  const { plan } = validatePlan({ tracks: [{ routeId: 'M1' }], drums: { enabled: true, filter: { ...ANALOG, bypass: true } } }, CITY)
  assert.equal(plan.drums.filter.model, ANALOG_MODEL)
  assert.equal(plan.drums.filter.bypass, true)
})

test('both plan schemas accept the Analog fields (strict ones nullable)', () => {
  const parsed = PLAN_INPUT_SCHEMA.safeParse({ tracks: [{ routeId: 'M1', filter: ANALOG }] })
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues))
  const json = JSON.stringify(COMPOSITION_RESPONSE_FORMAT)
  for (const k of ['model', 'resonance', 'drive', 'slope', 'bypass']) assert.ok(json.includes(`"${k}"`), k)
})

test('the composer guide teaches models, native units, bypass and the notch rule', () => {
  const guide = buildComposerGuide({})
  assert.match(guide, /daisy-ladder/)
  assert.match(guide, /NO notch/)
  assert.match(guide, /resonance 0\.\.1\.8/)
  assert.match(guide, /bypass/)
})

test('the shared merge: edits keep unmentioned fields, switching a notch lane to Analog lands on lowpass', () => {
  assert.deepEqual(planFilterState({ type: 'bandpass', frequency: 900, Q: 6 }, { frequency: 1200 }),
    { type: 'bandpass', frequency: 1200, Q: 6 })
  assert.equal(planFilterState({ type: 'notch', Q: 3 }, { model: ANALOG_MODEL }).type, 'lowpass')
  assert.equal(planFilterState({ type: 'notch', Q: 3 }, { model: ANALOG_MODEL }).Q, 3, 'Classic Q kept')
})

test('an Analog plan survives the DAW load → save round trip', () => {
  const { plan } = validatePlan({ bpm: 120, tracks: [{ routeId: 'M1', filter: ANALOG }, { routeId: '4' }] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), withNewCompositionBaseline(plan))
  assert.equal(snapshot.trackFilters.M1.model, ANALOG_MODEL)
  assert.equal(snapshot.trackFilters.M1.drive, 2.5)
  assert.equal(snapshot.trackFilters['4'].model, CLASSIC_MODEL)
  assert.deepEqual(roundTrip(snapshot, CITY), snapshot)
})

test('a fresh composition cannot inherit the previous song\'s Analog settings', () => {
  const first = applyPlanToSnapshot(defaultSnapshot('budapest'), validatePlan({
    tracks: [{ routeId: 'M1', filter: { ...ANALOG, bypass: true } }],
    drums: { enabled: true, filter: ANALOG, patterns: [{ padId: 'kick', steps: [1, 0, 0, 0] }] },
  }, CITY).plan).snapshot
  assert.equal(first.trackFilters.M1.bypass, true)

  const fresh = withNewCompositionBaseline(validatePlan({
    tracks: [{ routeId: 'M1', filter: { type: 'lowpass', frequency: 3000, Q: 1 } }],
    drums: { enabled: true, patterns: [{ padId: 'kick', steps: [1, 0, 0, 0] }] },
  }, CITY).plan)
  const { snapshot } = applyPlanToSnapshot(first, fresh)
  assert.equal(snapshot.trackFilters.M1.model, CLASSIC_MODEL)
  assert.equal(snapshot.trackFilters.M1.bypass, false)
  assert.equal(snapshot.trackFilters.M1.drive, 1)
  assert.equal(snapshot.trackFilters.M1.frequency, 3000)
  assert.equal(snapshot.trackFilters[DRUMS_ROUTE_ID].model, CLASSIC_MODEL)
})

test('describeSnapshot reports an Analog filter in native units', () => {
  const { plan } = validatePlan({ tracks: [{ routeId: 'M1', filter: ANALOG }] }, CITY)
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan)
  const lane = describeSnapshot(snapshot, CITY, { detail: true }).lanes.find(l => l.routeId === 'M1')
  assert.deepEqual(lane.filter, { type: 'lowpass', frequency: 640, model: ANALOG_MODEL, resonance: 1.3, drive: 2.5, slope: 12 })
})

test('older songs load their filters unchanged; invalid stored values are normalised', () => {
  const legacy = migrateSnapshot({ trackFilters: { M1: { type: 'notch', frequency: 700, Q: 9 } } }, 4)
  assert.deepEqual(legacy.trackFilters.M1, { type: 'notch', frequency: 700, Q: 9 })
  const hostile = migrateSnapshot({ trackFilters: { M1: { model: ANALOG_MODEL, type: 'notch', drive: 'loud', resonance: 40 } } }, 4)
  assert.deepEqual(hostile.trackFilters.M1, { model: ANALOG_MODEL, type: 'lowpass', resonance: 1.8 })
})
