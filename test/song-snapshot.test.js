import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSnapshot, applySnapshot } from '../lib/songState.js'
import { SCHEMA_VERSION } from '../lib/persistence.js'

const route = (id, extra = {}) => ({ id, name: id, type: 'tram', stops: [{ lat: 1, lon: 2 }], totalDist: 10, ...extra })
const CITY = [route('M1', { type: 'metro' }), route('4'), route('47'), route('9', { type: 'bus' })]

// Records every setter/engine call in order, so tests can assert on sequence as
// well as on values. applySnapshot optional-chains everything, so a Proxy of
// arbitrary methods is a complete stand-in for both React setters and the engine.
function recorder() {
  const calls = []
  const target = new Proxy({}, {
    get: (_t, name) => (...args) => { calls.push({ name, args }); return undefined },
  })
  return {
    calls, target,
    of: (name) => calls.filter(c => c.name === name),
    first: (name) => calls.find(c => c.name === name),
    indexOf: (name) => calls.findIndex(c => c.name === name),
  }
}

const baseState = () => ({
  cityId: 'budapest',
  routeIds: ['M1', '4', '47'],
  bpm: 128, mode: 'mock', view: 'daw', masterVolume: -3,
  globalHarmony: { root: 'D', scaleType: 'minor' },
  volumes: { M1: -6 },
  disabledRoutes: { M1: false, '4': true },
  pans: { M1: 0.2 },
  soloRoutes: new Set(),
  trackSynthTypes: { M1: 'FMSynth' },
  trackADSRs: { M1: { attack: 0.1, samplerPreset: 'piano' } },
  trackEqs: {}, trackFilters: {}, trackScales: { M1: { root: 'D', scaleType: 'minor' } },
  trackSemitones: {}, trackOctaves: {}, trackGlides: {}, trackLegatos: {},
  trackArps: {}, trackGranulars: {}, trackSidechains: {}, trackSpeeds: {}, trackDroneModes: {}, trackDroneRoots: {},
  trackLoopRegions: {}, trackGridResolutions: {}, trackPitchVariety: {},
  trackStopVelocities: {}, trackPitchOffsets: {},
  activeFxTracks: ['reverb'], fxBusWet: { reverb: 0.4 }, fxBusMuted: {}, fxBusSoloed: {},
  fxBusParams: { reverb: { decay: 3 } },
  sendMatrix: { 'M1:reverb': 0.5 },
  automationCfg: {}, duplicates: [], merges: [],
  drumPattern: { patterns: { kick: [1, 0] }, offsets: {}, muted: {}, bpm: 128 },
  drumsMuted: true,
  laneManifest: [{ id: 'M1', sourceId: null, kind: 'base' }],
})

test('buildSnapshot records the city, the lane list, and the drum mute', () => {
  const snap = buildSnapshot(baseState())
  assert.equal(snap.schemaVersion, SCHEMA_VERSION)
  assert.equal(snap.schemaVersion, 3)
  assert.equal(snap.cityId, 'budapest')
  assert.deepEqual(snap.routeIds, ['M1', '4', '47'])
  assert.equal(snap.drumsMuted, true)
})

test('buildSnapshot strips non-serializable custom IR buffers but keeps scalars', () => {
  const snap = buildSnapshot({
    ...baseState(),
    fxBusParams: { reverb: { irType: 'custom', wet: 0.5, buffer: { fake: 'AudioBuffer' } } },
  })
  assert.deepEqual(snap.fxBusParams.reverb, { irType: 'custom', wet: 0.5 })
})

// The original "load a preset, press play, no audio" bug: a lane present in the
// session but absent from the snapshot's `muted` map was left undefined in React
// (rendered active) while the engine kept it disabled at gain 0.
test('every lane gets one explicit setRouteDisabled, and React agrees key-for-key', () => {
  const setters = recorder()
  const engine = recorder()
  // '47' is one of the song's lanes but has no entry in `muted`; '9' is in the
  // city but not in the song, so it is not a lane at all.
  const snap = buildSnapshot({ ...baseState(), disabledRoutes: { M1: false, '4': true } })
  applySnapshot(snap, setters.target, engine.target, CITY)

  const disabledArg = setters.first('setDisabledRoutes').args[0]
  assert.deepEqual(
    Object.keys(disabledArg).sort(), ['4', '47', 'M1'],
    'the React map must cover every lane of the song, not only the saved ones',
  )
  assert.equal(disabledArg['47'], true, 'an unmentioned lane defaults to silent, not phantom-active')
  assert.equal(disabledArg.M1, false)
  assert.equal(disabledArg['4'], true)
  assert.ok(!('9' in disabledArg), 'a city route the song never selected is not a lane')

  for (const id of ['M1', '4', '47']) {
    const forId = engine.of('setRouteDisabled').filter(c => c.args[0] === id)
    assert.equal(forId.length, 1, `${id} must get exactly one setRouteDisabled`)
    assert.equal(forId[0].args[1], disabledArg[id], `${id} must match React state`)
  }
})

// Before the fix, a legacy snapshot applied against a session's randomly-picked
// route list left every unmentioned lane undefined in React (rendered active) but
// disabled at gain 0 in the engine — active-looking lanes that made no sound.
test('a legacy snapshot with no routeIds still puts React and the engine in lock-step', () => {
  const setters = recorder()
  const engine = recorder()
  const legacy = {
    bpm: 120,
    muted: { M1: false, '4': true },   // laneManifest and routeIds both absent
    volumes: {}, trackSynthTypes: {}, trackADSRs: {}, trackScales: {},
  }
  applySnapshot(legacy, setters.target, engine.target, CITY)

  const disabledArg = setters.first('setDisabledRoutes').args[0]
  const engineFlags = Object.fromEntries(engine.of('setRouteDisabled').map(c => c.args))
  assert.deepEqual(disabledArg, engineFlags, 'React and engine must never disagree')
  assert.deepEqual(Object.keys(disabledArg).sort(), ['4', 'M1'], 'lanes recovered from muted keys')
})

test('engine solos are cleared before any are replayed', () => {
  const engine = recorder()
  const snap = buildSnapshot({ ...baseState(), soloRoutes: new Set(['M1']) })
  applySnapshot(snap, recorder().target, engine.target, CITY)

  const clearAt = engine.indexOf('clearSolos')
  const soloAt = engine.indexOf('setSolo')
  assert.ok(clearAt >= 0, 'clearSolos must be called')
  assert.ok(soloAt > clearAt, 'solo replay must come after the clear')
  assert.deepEqual(engine.of('setSolo').map(c => c.args), [['M1', true]])
})

// A stale solo id left engine._soloRoutes non-empty with nothing matching, which
// gates every lane silent — total silence from an invisible cause.
test('solo ids outside the lane set reach neither the engine nor React', () => {
  const setters = recorder()
  const engine = recorder()
  const snap = buildSnapshot({ ...baseState(), soloRoutes: new Set(['GONE', 'M1']) })
  applySnapshot(snap, setters.target, engine.target, CITY)

  assert.deepEqual([...setters.first('setSoloRoutes').args[0]], ['M1'])
  assert.deepEqual(engine.of('setSolo').map(c => c.args[0]), ['M1'])
})

test('a lane whose only saved setting is a transpose still reaches the engine', () => {
  const engine = recorder()
  const snap = buildSnapshot({
    ...baseState(),
    routeIds: ['47'], disabledRoutes: {}, volumes: {}, trackSynthTypes: {}, trackADSRs: {},
    trackScales: {}, trackSemitones: { '47': 5 }, laneManifest: [],
  })
  applySnapshot(snap, recorder().target, engine.target, CITY)
  assert.deepEqual(engine.of('setSemitoneShift').map(c => c.args), [['47', 5]])
})

test('a lane whose only saved setting is a drone root still reaches the engine', () => {
  const engine = recorder()
  const snap = buildSnapshot({
    ...baseState(),
    routeIds: ['47'], disabledRoutes: {}, volumes: {}, trackSynthTypes: {}, trackADSRs: {},
    trackScales: {}, trackDroneModes: {}, trackDroneRoots: { '47': 'G2' }, laneManifest: [],
  })
  applySnapshot(snap, recorder().target, engine.target, CITY)
  assert.deepEqual(engine.of('setDroneRoot').map(c => c.args), [['47', 'G2']])
})

test('a full song round-trips through build → apply', () => {
  const setters = recorder()
  const engine = recorder()
  const state = {
    ...baseState(),
    duplicates: [{ id: '4~dup~1', sourceId: '4', name: '4 (2)' }],
    merges: [{ id: 'm~1', sourceIds: ['47', '9'], name: 'Merged', synthType: 'PolySynth' }],
    routeIds: ['M1', '4', '47', '9'],
    trackPitchOffsets: { '4~dup~1': { s1: 2 } },
    automationCfg: { M1: { lane0: { sourceRouteId: '9', paramTarget: 'volume', points: { 0: 0.5 } } } },
  }
  const snap = buildSnapshot(state)
  applySnapshot(snap, setters.target, engine.target, CITY)

  assert.equal(setters.first('setBpm').args[0], 128)
  assert.equal(setters.first('setMasterVolume').args[0], -3)
  assert.deepEqual(setters.first('setGlobalHarmony').args[0], { root: 'D', scaleType: 'minor' })
  assert.equal(setters.first('setDrumsMuted').args[0], true)
  assert.deepEqual(setters.first('setDrumPattern').args[0], state.drumPattern)
  assert.deepEqual(setters.first('setDuplicates').args[0], state.duplicates)
  assert.deepEqual(setters.first('setMerges').args[0], state.merges)
  assert.deepEqual(setters.first('setSendMatrix').args[0], { 'M1:reverb': 0.5 })

  // The synthetic lanes resolve, so the engine configures them too.
  const disabledIds = engine.of('setRouteDisabled').map(c => c.args[0])
  assert.ok(disabledIds.includes('4~dup~1'), 'the duplicate lane must be configured')
  assert.ok(disabledIds.includes('m~1'), 'the merged lane must be configured')
  assert.deepEqual(engine.of('setMerge').map(c => c.args), [['m~1', ['47', '9']]])
  assert.deepEqual(engine.of('setPitchOffsets').map(c => c.args), [['4~dup~1', { s1: 2 }]])
  assert.deepEqual(engine.of('setSendLevel').map(c => c.args), [['M1', 'reverb', 0.5]])
  assert.deepEqual(engine.of('setDrumPattern').map(c => c.args), [[state.drumPattern]])
  assert.deepEqual(
    engine.of('setSynthType').map(c => c.args),
    [['M1', 'metro', 'FMSynth', { attack: 0.1, samplerPreset: 'piano' }]],
  )
})

test('applySnapshot tolerates a missing engine and a bare (unwrapped) snapshot', () => {
  const setters = recorder()
  applySnapshot({ state: buildSnapshot(baseState()) }, setters.target, null, CITY)
  assert.equal(setters.first('setBpm').args[0], 128, 'a wrapped row is unwrapped')
  assert.doesNotThrow(() => applySnapshot(null, setters.target, null, CITY))
})

test('a sidechain round-trips and reaches the engine', () => {
  const cfg = { enabled: true, source: '__drums__:kick', amountDb: -12, attack: 0.004, release: 0.25 }
  const snapshot = buildSnapshot({ ...baseState(), trackSidechains: { '4': cfg } })
  assert.deepEqual(snapshot.trackSidechains, { '4': cfg })

  const setters = recorder(), engine = recorder()
  applySnapshot(snapshot, setters.target, engine.target, CITY)
  assert.deepEqual(setters.first('setTrackSidechains').args[0], { '4': cfg })
  assert.deepEqual(engine.of('setSidechain').map(c => c.args), [['4', cfg]])
})

// A song saved before the feature existed has no such key. It must load with an
// empty map and touch the engine not at all, so old songs sound identical.
test('a pre-sidechain song loads clean', () => {
  const snapshot = buildSnapshot(baseState())
  delete snapshot.trackSidechains

  const setters = recorder(), engine = recorder()
  applySnapshot(snapshot, setters.target, engine.target, CITY)
  assert.deepEqual(setters.first('setTrackSidechains').args[0], {})
  assert.equal(engine.of('setSidechain').length, 0)
})
