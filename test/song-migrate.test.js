import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateSnapshot } from '../lib/songState.js'
import { SCHEMA_VERSION } from '../lib/persistence.js'

// A song saved before any of the current shapes existed: per-duplicate pitch
// offsets, legacy Tone.EQ3 tilt EQ, 'Granular' as a synth type, and no record of
// either its city or its lane list.
const V1_SNAPSHOT = {
  bpm: 110,
  muted: { M1: false, '4': true, __drums__: false },
  volumes: { M1: -4 },
  trackSynthTypes: { M1: 'Granular', '4': 'FMSynth' },
  trackEqs: { M1: { low: 3, mid: -2, high: 1 } },
  duplicates: [{ id: '4~dup~1', sourceId: '4', name: '4 (2)', perStopSteps: { s3: 2, s7: -1 } }],
  merges: [],
  automationCfg: {},
}

test('a v1 song migrates to the current schema', () => {
  const s = migrateSnapshot(V1_SNAPSHOT, 1)

  assert.equal(s.trackSynthTypes.M1, 'Synth', "'Granular' is a layer now, not a synth type")
  assert.equal(s.trackSynthTypes['4'], 'FMSynth', 'valid synth types are untouched')

  // The EQ3 tilt becomes a weq8 band array, carrying the saved gains across.
  const eq = s.trackEqs.M1
  assert.ok(Array.isArray(eq), 'legacy EQ3 is coerced to a weq8 band array')
  assert.equal(eq[0].type, 'lowshelf12')
  assert.equal(eq[0].gain, 3, 'the saved low gain survives')
  assert.equal(eq[1].gain, -2, 'the saved mid gain survives')
  assert.equal(eq[2].gain, 1, 'the saved high gain survives')

  assert.deepEqual(s.trackPitchOffsets, { '4~dup~1': { s3: 2, s7: -1 } }, 'per-stop pitch is hoisted')
  assert.ok(!('perStopSteps' in s.duplicates[0]), 'the legacy field is stripped from the descriptor')

  // The lane list is recovered so the song opens with its own lines rather than a
  // fresh random pick — the whole point of schema 3.
  assert.ok(s.routeIds.includes('M1') && s.routeIds.includes('4'))
  assert.ok(!s.routeIds.includes('__drums__'), 'the drum pseudo-route is not a lane')
  assert.ok(!s.routeIds.includes('4~dup~1'), 'a duplicate id is not a base lane')

  // null, not a guess: a pre-v3 song genuinely doesn't know its city, and null
  // must keep meaning "assume the currently-loaded city".
  assert.equal(s.cityId, null)
})

test('migrating is non-destructive to the input', () => {
  const input = JSON.parse(JSON.stringify(V1_SNAPSHOT))
  migrateSnapshot(input, 1)
  assert.deepEqual(input, V1_SNAPSHOT, 'the caller\'s snapshot object is not mutated')
})

test('a current-version song passes through unchanged', () => {
  const v3 = {
    cityId: 'berlin', routeIds: ['U1', 'U2'],
    muted: { U1: false, U2: true },
    trackSynthTypes: { U1: 'Synth' },
    trackEqs: {}, duplicates: [], merges: [], automationCfg: {},
  }
  const s = migrateSnapshot(v3, SCHEMA_VERSION)
  assert.equal(s.cityId, 'berlin')
  assert.deepEqual(s.routeIds, ['U1', 'U2'])
})

test('a newer schemaVersion warns but still applies best-effort', () => {
  const warnings = []
  const realWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    const s = migrateSnapshot({ cityId: 'prague', routeIds: ['A'], muted: { A: false } }, 99)
    assert.equal(s.cityId, 'prague', 'a future save must never become unopenable')
    assert.deepEqual(s.routeIds, ['A'])
  } finally {
    console.warn = realWarn
  }
  assert.ok(warnings.some(w => w.includes('99')), 'the version mismatch is reported')
})

test('stale automation targets fall back to volume rather than binding to nothing', () => {
  const s = migrateSnapshot({
    muted: { M1: false },
    trackSynthTypes: { M1: 'Synth' },
    activeFxTracks: [],   // the saved song's reverb bus is gone
    automationCfg: { M1: { lane0: { sourceRouteId: '4', paramTarget: 'send.reverb', points: { 0: 1 } } } },
  }, SCHEMA_VERSION)

  const lane = s.automationCfg.M1.lane0
  assert.equal(lane.paramTarget, 'volume')
  assert.equal(lane.sourceRouteId, '4', 'the source lane is preserved')
  assert.deepEqual(lane.points, { 0: 1 }, 'authored points survive')
})
