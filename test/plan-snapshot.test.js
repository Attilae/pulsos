import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { withNewCompositionBaseline } from '../lib/ai/planApply.js'
import { buildSnapshot, applySnapshot } from '../lib/songState.js'
import { SYNTH_DEFAULTS, DRUMS_ROUTE_ID } from '../lib/soundSpecs.js'

const route = (id, type = 'tram') => ({ id, name: id, type, stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [route('M1', 'metro'), route('M2', 'metro'), route('4'), route('6'), route('9', 'bus')]
const kick = [1, 0, 0, 0, 0.7, 0, 0, 0, 1, 0, 0, 0, 0.7, 0, 0, 0]

const RAW_PLAN = {
  summary: 'dub', bpm: 100, masterVolume: -3,
  harmony: { root: 'A', scaleType: 'dorian' },
  tracks: [
    { routeId: 'M1', synthType: 'Sampler', samplerPreset: 'cello', volume: -6, label: 'Bass',
      scale: { root: 'D', scaleType: 'minor' },
      sidechain: { enabled: true, source: 'drums:kick', amountDb: -10, attack: 0.005, release: 0.2 } },
    { routeId: '4', synthType: 'FMSynth', envelope: { attack: 0.2, decay: 0.3, sustain: 0.5, release: 2 },
      arp: { enabled: true, style: 'up', rate: '16n', gate: 0.5, octaves: 1, steps: 3, distance: 2 },
      loopRegion: { startCell: 0, endCell: 32 }, speed: 2, pitchVariety: { contour: 'arch', variety: 0.3 } },
  ],
  drums: { enabled: true, volume: -8, filter: null, patterns: [{ padId: 'kick', steps: kick }] },
  fx: [{ busId: 'reverb', wet: 0.6, params: [{ paramId: 'irType', value: 'cave' }],
    sends: [{ routeId: 'M1', level: 0.4 }, { routeId: 'drums', level: 0.2 }] }],
}

function plan(raw = RAW_PLAN, routes = CITY, opts = {}) {
  const { plan: validated, dropped } = validatePlan(raw, routes, opts)
  return { validated, dropped }
}

// Load a snapshot through the app's real loader into a plain state object, then
// save it again. A snapshot MCP writes must be a fixed point of that round trip —
// i.e. already in exactly the shape the DAW itself would save after opening it.
function roundTrip(snapshot, routes) {
  const state = {}
  const setters = new Proxy({}, {
    get: (_t, name) => (value) => {
      const key = String(name).slice(3)
      state[key[0].toLowerCase() + key.slice(1)] = value
    },
  })
  const base = snapshot.routeIds.map(id => routes.find(r => r.id === id)).filter(Boolean)
  applySnapshot(snapshot, setters, null, base)
  return buildSnapshot({
    ...state,
    cityId: snapshot.cityId,
    routeIds: snapshot.routeIds,
    laneManifest: snapshot.laneManifest,
  })
}

test('defaultSnapshot carries exactly the keys buildSnapshot writes', () => {
  assert.deepEqual(Object.keys(defaultSnapshot('budapest')).sort(), Object.keys(buildSnapshot({})).sort())
})

test('a new song built from a plan survives the DAW load → save round trip unchanged', () => {
  const { validated } = plan()
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), validated)
  assert.deepEqual(roundTrip(snapshot, CITY), snapshot)
})

test('an existing song edited by a plan also round-trips unchanged', () => {
  const first = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated).snapshot
  const second = applyPlanToSnapshot(first, plan({
    bpm: 128, tracks: [{ routeId: '9', synthType: 'PolySynth' }, { routeId: 'M1', volume: -2 }],
  }).validated).snapshot
  assert.deepEqual(roundTrip(second, CITY), second)
})

test('plan lanes become the song lanes, in plan order, all audible', () => {
  const { snapshot, activeIds, addedRouteIds } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated)
  assert.deepEqual(snapshot.routeIds, ['M1', '4'])
  assert.deepEqual(addedRouteIds, ['M1', '4'])
  assert.deepEqual(activeIds, ['M1', '4'])
  assert.deepEqual(snapshot.laneManifest, [
    { id: 'M1', sourceId: null, kind: 'base' }, { id: '4', sourceId: null, kind: 'base' },
  ])
  assert.equal(snapshot.muted.M1, false)
  assert.equal(snapshot.muted['4'], false)
  assert.equal(snapshot.cityId, 'budapest')
  assert.equal(snapshot.bpm, 100)
  assert.equal(snapshot.mode, 'mock')
})

test('global harmony applies to every lane, then a per-track scale overrides its own', () => {
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated)
  assert.deepEqual(snapshot.globalHarmony, { root: 'A', scaleType: 'dorian' })
  assert.deepEqual(snapshot.trackScales['4'], { root: 'A', scaleType: 'dorian' })
  assert.deepEqual(snapshot.trackScales.M1, { root: 'D', scaleType: 'minor' })
})

test('synthType resets the envelope block to its defaults before preset/envelope merge', () => {
  const base = defaultSnapshot('budapest')
  base.trackADSRs = { '4': { attack: 1.9, oscillatorType: 'square' } }
  const { snapshot } = applyPlanToSnapshot(base, plan().validated)
  assert.deepEqual(snapshot.trackADSRs['4'], { ...SYNTH_DEFAULTS.FMSynth, attack: 0.2, decay: 0.3, sustain: 0.5, release: 2 })
  assert.equal(snapshot.trackADSRs.M1.samplerPreset, 'cello')
  assert.equal(snapshot.trackSynthTypes.M1, 'Sampler')
})

test('drums: enabled writes a 64-step backing and un-disables the drum lane; disabled clears it', () => {
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated)
  assert.equal(snapshot.drumPattern.patterns.kick.length, 64)
  assert.deepEqual(snapshot.drumPattern.patterns.kick.slice(16, 32), kick)
  assert.equal(snapshot.drumPattern.bpm, 100)
  assert.equal(snapshot.muted[DRUMS_ROUTE_ID], false)
  assert.equal(snapshot.volumes[DRUMS_ROUTE_ID], -8)
  assert.equal(snapshot.trackSidechains.M1.source, `${DRUMS_ROUTE_ID}:kick`)

  const off = applyPlanToSnapshot(snapshot, plan({ tracks: [{ routeId: 'M1' }], drums: { enabled: false } }).validated)
  assert.equal(off.snapshot.drumPattern, null)
})

test('FX: bus added once, params merged, sends keyed "<route>:<bus>"', () => {
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated)
  assert.equal(snapshot.activeFxTracks.filter(id => id === 'reverb').length, 1)
  assert.equal(snapshot.fxBusWet.reverb, 0.6)
  assert.deepEqual(snapshot.fxBusParams.reverb, { irType: 'cave' })
  assert.equal(snapshot.sendMatrix['M1:reverb'], 0.4)
  assert.equal(snapshot.sendMatrix[`${DRUMS_ROUTE_ID}:reverb`], 0.2)
})

test('lane cap: tracks beyond the limit are dropped by validation and stay disabled', () => {
  const raw = { tracks: ['M1', 'M2', '4', '6'].map(routeId => ({ routeId })) }
  const { validated, dropped } = plan(raw, CITY, { activeLaneLimit: 2 })
  assert.equal(dropped.length, 2)
  const { snapshot, activeIds, skippedIds } = applyPlanToSnapshot(defaultSnapshot('x'), validated, { activeLaneLimit: 2 })
  assert.deepEqual(activeIds, ['M1', 'M2'])
  assert.deepEqual(skippedIds, [])
  assert.deepEqual(snapshot.routeIds, ['M1', 'M2'])
})

test('editing an existing song keeps its other lanes (disabled) and their settings', () => {
  const first = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated).snapshot
  first.duplicates = [{ id: 'M1~dup~1', sourceId: 'M1', name: 'M1 +3' }]
  first.laneManifest.push({ id: 'M1~dup~1', sourceId: 'M1', kind: 'duplicate' })
  const { snapshot, addedRouteIds } = applyPlanToSnapshot(first, plan({
    harmony: { root: 'E', scaleType: 'minor' }, tracks: [{ routeId: '9', synthType: 'PolySynth' }],
  }).validated)
  assert.deepEqual(addedRouteIds, ['9'])
  assert.deepEqual(snapshot.routeIds, ['M1', '4', '9'])
  assert.equal(snapshot.muted.M1, true)
  assert.equal(snapshot.muted['M1~dup~1'], true)
  assert.equal(snapshot.muted['9'], false)
  assert.equal(snapshot.trackSynthTypes['4'], 'FMSynth', 'untouched lane keeps its instrument')
  assert.deepEqual(snapshot.trackScales['M1~dup~1'], { root: 'E', scaleType: 'minor' }, 'harmony reaches duplicates')
})

test('the input snapshot is never mutated', () => {
  const base = defaultSnapshot('budapest')
  const before = JSON.stringify(base)
  applyPlanToSnapshot(base, plan().validated)
  assert.equal(JSON.stringify(base), before)
})

test('a plan with no playable tracks is rejected', () => {
  assert.throws(() => applyPlanToSnapshot(defaultSnapshot('x'), plan({ tracks: [{ routeId: 'nope' }] }).validated))
})

test('describeSnapshot summarizes only the audible lanes', () => {
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated)
  const summary = describeSnapshot(snapshot, CITY)
  assert.deepEqual(summary.lanes.map(l => [l.routeId, l.synthType]), [['M1', 'Sampler'], ['4', 'FMSynth']])
  assert.equal(summary.lanes[0].samplerPreset, 'cello')
  assert.deepEqual(summary.drums, { pads: ['kick'], muted: false })
})

test('note chance and loop pattern: stored like the handlers do, sparse at their defaults, round-trip clean', () => {
  const raw = { tracks: [
    { routeId: 'M1', noteChance: 0.456, loopPattern: { play: 1, rest: 3, offset: 1 } },
    { routeId: '4', noteChance: 1, loopPattern: { play: 1, rest: 0, offset: 0 } },
    { routeId: '6', noteChance: 'often', loopPattern: { play: 'x', rest: 1 } },
  ] }
  const { validated, dropped } = plan(raw)
  assert.deepEqual(dropped, ['noteChance on "6"', 'loopPattern on "6"'])
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), validated)
  assert.deepEqual(snapshot.trackNoteChances, { M1: 0.46 })
  assert.deepEqual(snapshot.trackLoopPatterns, { M1: { play: 1, rest: 3, offset: 1 } })
  assert.deepEqual(roundTrip(snapshot, CITY), snapshot)
})

test('an existing chance/pattern is cleared when a plan sets the lane back to always-play', () => {
  const base = { ...defaultSnapshot('budapest'), routeIds: ['M1'],
    trackNoteChances: { M1: 0.5 }, trackLoopPatterns: { M1: { play: 1, rest: 1, offset: 0 } } }
  const { validated } = plan({ tracks: [{ routeId: 'M1', noteChance: 1, loopPattern: { play: 1, rest: 0, offset: 0 } }] })
  const { snapshot } = applyPlanToSnapshot(base, validated)
  assert.deepEqual(snapshot.trackNoteChances, {})
  assert.deepEqual(snapshot.trackLoopPatterns, {})
})

test('drone: a missing root defaults into the key, an unusable one is reported and replaced', () => {
  const { validated, dropped } = plan({ harmony: { root: 'G', scaleType: 'minor' }, tracks: [
    { routeId: 'M1', octave: -1, drone: { enabled: true, root: null } },
    { routeId: 'M2', drone: { enabled: true, root: 'G' } },
    { routeId: '4', scale: { root: 'D', scaleType: 'dorian' }, drone: { enabled: true, root: 'A1' } },
  ] })
  assert.deepEqual(validated.tracks.map(t => t.drone.root), ['G1', 'G2', 'A1'])
  assert.deepEqual(dropped, ['drone root "G" on "M2"'])
})

test('a new-composition plan over an effects-heavy song leaves the planned lanes clean', () => {
  const heavy = applyPlanToSnapshot(defaultSnapshot('budapest'), plan({
    ...RAW_PLAN,
    tracks: [
      { routeId: 'M1', synthType: 'FMSynth', noteChance: 0.4, loopPattern: { play: 1, rest: 3, offset: 0 },
        granular: { enabled: true, mix: 0.6 }, drone: { enabled: true, root: 'A2' },
        sidechain: { enabled: true, source: 'drums:kick', amountDb: -10, attack: 0.005, release: 0.2 } },
      RAW_PLAN.tracks[1],
    ],
  }).validated).snapshot
  assert.equal(heavy.sendMatrix['M1:reverb'], 0.4)

  const fresh = withNewCompositionBaseline(plan({
    bpm: 72, tracks: [{ routeId: 'M1', synthType: 'AMSynth' }, { routeId: '4', synthType: 'Synth' }],
  }).validated)
  const { snapshot } = applyPlanToSnapshot(heavy, fresh)

  assert.equal(snapshot.trackArps['4'].enabled, false, 'old arp off')
  assert.equal(snapshot.trackGranulars.M1.enabled, false, 'old granular off')
  assert.equal(snapshot.trackDroneModes.M1, false, 'old drone off')
  assert.equal(snapshot.trackSidechains.M1.enabled, false, 'old sidechain off')
  assert.equal('M1' in snapshot.trackNoteChances, false, 'chance back to always-play')
  assert.equal('M1' in snapshot.trackLoopPatterns, false, 'rest pattern cleared')
  assert.deepEqual(snapshot.trackLoopRegions['4'], { startCell: 0, endCell: 64 }, 'crop cleared')
  assert.equal(snapshot.trackSpeeds['4'], 1)
  assert.equal(snapshot.sendMatrix['M1:reverb'], 0, 'old lane send zeroed')
  assert.equal(snapshot.sendMatrix[`${DRUMS_ROUTE_ID}:reverb`], 0, 'old drum send zeroed')
  assert.equal(snapshot.drumPattern, null, 'no drums block → no drums')
  assert.deepEqual(roundTrip(snapshot, CITY), snapshot)
})

test('an edit plan (no baseline) keeps settings and sends it does not mention', () => {
  const first = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated).snapshot
  const { snapshot } = applyPlanToSnapshot(first, plan({ tracks: [{ routeId: '4', volume: -3 }, { routeId: 'M1' }] }).validated)
  assert.equal(snapshot.trackArps['4'].enabled, true)
  assert.equal(snapshot.sendMatrix['M1:reverb'], 0.4)
  assert.ok(snapshot.drumPattern, 'drums untouched')
})

test('describeSnapshot detail carries what an edit must preserve', () => {
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), plan().validated)
  const brief = describeSnapshot(snapshot, CITY)
  assert.equal('speed' in brief.lanes[1], false, 'brief form unchanged')
  const detail = describeSnapshot(snapshot, CITY, { detail: true })
  const lane4 = detail.lanes.find(l => l.routeId === '4')
  assert.equal(lane4.speed, 2)
  assert.deepEqual(lane4.loopRegion, { startCell: 0, endCell: 32 })
  assert.deepEqual(lane4.arp, { enabled: true, style: 'up', rate: '16n' })
  assert.deepEqual(lane4.pitchVariety, { contour: 'arch', variety: 0.3 })
  const m1 = detail.lanes.find(l => l.routeId === 'M1')
  assert.deepEqual(m1.sends, [{ busId: 'reverb', level: 0.4 }])
  assert.deepEqual(m1.sidechain, { enabled: true, source: 'drums:kick', amountDb: -10 })
  assert.deepEqual(m1.scale, { root: 'D', scaleType: 'minor' }, 'a lane scale that differs from the song key')
  assert.deepEqual(detail.drums.patterns, [{ padId: 'kick', steps: kick }])
  assert.deepEqual(detail.drums.sends, [{ busId: 'reverb', level: 0.2 }])
  assert.ok(detail.fx.some(f => f.busId === 'reverb' && f.params?.irType === 'cave'))
})
