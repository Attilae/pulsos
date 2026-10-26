import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeVelocityMapping, normalizeVelocityMappingMap, stopSignal, stopSignals, mergedChordSignals,
  mappedStopVelocity, resolveStopVelocity, stopVelocityStatus, DEFAULT_STOP_VELOCITY,
} from '../lib/stopVelocity.js'
import { buildLoopMidiEvents } from '../lib/midiEvents.js'
import { buildMergedPitchCells } from '../lib/lanePitch.js'
import { buildLaneNoteRows } from '../lib/laneNotes.js'
import { buildSnapshot, applySnapshot } from '../lib/songState.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA } from '../lib/ai/planSchema.js'
import { withNewCompositionBaseline } from '../lib/ai/planApply.js'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'

// Stop-driven velocity (lib/stopVelocity.js): a lane's stop notes take a
// velocity from each stop's baked-in demand or transfer centrality.

const DEMAND = { source: 'demand', min: 0.4, max: 1, invert: false }
const HUBS = { source: 'hubs', min: 0.4, max: 1, invert: false }
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} ≉ ${b}`)

test('normalize: defaults, clamped and reordered bounds, malformed configs dropped', () => {
  assert.deepEqual(normalizeVelocityMapping({ source: 'demand' }), DEFAULT_STOP_VELOCITY)
  assert.deepEqual(normalizeVelocityMapping({ source: 'hubs', min: null, max: null, invert: null }),
    { ...DEFAULT_STOP_VELOCITY, source: 'hubs' }, 'nulls (strict schema) take the defaults')
  assert.deepEqual(normalizeVelocityMapping({ source: 'hubs', min: 1.5, max: 0 }),
    { source: 'hubs', min: 0.2, max: 1, invert: false }, 'clamped to 0.2..1, then put in order')
  for (const bad of [null, undefined, 'demand', [], {}, { source: 'off' }, { source: 'gap' },
    { source: 'demand', min: '0.5' }, { source: 'demand', max: NaN }, { source: 'demand', invert: 'yes' }]) {
    assert.equal(normalizeVelocityMapping(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(normalizeVelocityMappingMap({ a: DEMAND, b: { source: 'x' }, c: null }), { a: DEMAND })
  assert.deepEqual(normalizeVelocityMappingMap('nope'), {})
})

test('signals: demand and centrality read, clamped, zero kept; anything else is missing', () => {
  const stop = { signals: { demand: 0.3, centrality: 1.4 } }
  assert.equal(stopSignal(stop, 'demand'), 0.3)
  assert.equal(stopSignal(stop, 'hubs'), 1)
  assert.equal(stopSignal({ signals: { centrality: 0 } }, 'hubs'), 0)
  for (const v of [undefined, null, '0.5', NaN, Infinity]) assert.equal(stopSignal({ signals: { demand: v } }, 'demand'), null)
  assert.equal(stopSignal({}, 'demand'), null)
  assert.deepEqual(stopSignals({ signals: { demand: 0.5 } }), { demand: 0.5, hubs: null })
  assert.deepEqual(mergedChordSignals([{ demand: 0.2, hubs: null }, { demand: 0.9, hubs: 0.1 }, null]), { demand: 0.9, hubs: 0.1 })
  assert.deepEqual(mergedChordSignals([]), { demand: null, hubs: null })
})

test('mapping: demand is linear, hubs squared, invert flips, no signal → null', () => {
  close(mappedStopVelocity(DEMAND, 0), 0.4)
  close(mappedStopVelocity(DEMAND, 0.5), 0.7)
  close(mappedStopVelocity(DEMAND, 1), 1)
  close(mappedStopVelocity(HUBS, 0.5), 0.4 + 0.25 * 0.6, 'a mid-centrality stop stays near the floor')
  close(mappedStopVelocity(HUBS, 1), 1)
  close(mappedStopVelocity({ ...DEMAND, invert: true }, 1), 0.4)
  close(mappedStopVelocity({ ...HUBS, invert: true }, 0), 1)
  assert.equal(mappedStopVelocity(DEMAND, null), null)
  assert.equal(mappedStopVelocity(null, 0.5), null)
})

test('precedence: authored → mapping → gap-derived variety → 1', () => {
  const signals = { demand: 1, hubs: 0 }
  assert.deepEqual(resolveStopVelocity({ authored: 0.3, cfg: DEMAND, signals, gap: 0.6 }), { velocity: 0.3, origin: 'authored' })
  assert.deepEqual(resolveStopVelocity({ authored: 1, cfg: DEMAND, signals: { demand: 0 } }), { velocity: 1, origin: 'authored' },
    'an authored 100% is an accent, not "no edit"')
  assert.deepEqual(resolveStopVelocity({ cfg: DEMAND, signals, gap: 0.6 }), { velocity: 1, origin: 'demand' })
  assert.deepEqual(resolveStopVelocity({ cfg: HUBS, signals, gap: 0.6 }), { velocity: 0.4, origin: 'hubs' })
  assert.deepEqual(resolveStopVelocity({ cfg: DEMAND, signals: { demand: null }, gap: 0.6 }), { velocity: 0.6, origin: 'variety' },
    'a stop without the signal falls back to the gap map')
  assert.deepEqual(resolveStopVelocity({ signals, gap: 0.8 }), { velocity: 0.8, origin: 'variety' })
  assert.deepEqual(resolveStopVelocity({}), { velocity: 1, origin: 'variety' })
})

test('status: off is not active; PluckSynth keeps the mapping inactive', () => {
  assert.deepEqual(stopVelocityStatus({ cfg: null, synthType: 'Synth' }), { active: false, reason: null })
  assert.equal(stopVelocityStatus({ cfg: DEMAND, synthType: 'Synth' }).active, true)
  assert.equal(stopVelocityStatus({ cfg: DEMAND, synthType: 'Drums' }).active, true)
  const pluck = stopVelocityStatus({ cfg: DEMAND, synthType: 'PluckSynth' })
  assert.equal(pluck.active, false)
  assert.match(pluck.reason, /velocity/)
})

// ── MIDI export + display ──────────────────────────────────────────────────

const stops = Array.from({ length: 8 }, (_, i) => ({
  id: String(i), name: `S${i}`, lat: 47.48 + i * 0.004, lon: 19.03 + i * 0.003, dist: i * 200,
  signals: { demand: i / 7, centrality: i % 2 },
}))
const route = { id: 'P', name: 'P', type: 'bus', stops, totalDist: 1600 }
const byTime = events => [...events].sort((a, b) => a.time - b.time)

test('MIDI: velocities follow the mapping on the 0.8 export baseline; authored stops win', () => {
  const flat = buildLoopMidiEvents(route, { bpm: 120 })
  assert.ok(flat.every(e => e.velocity === 0.8), 'off: unchanged flat export')

  const mapped = byTime(buildLoopMidiEvents(route, { bpm: 120, trackStopVelocityMaps: { P: DEMAND } }))
  assert.equal(mapped.length, stops.length)
  mapped.forEach((e, i) => close(e.velocity, 0.8 * (0.4 + 0.6 * (i / 7)), `stop ${i}`))

  const hubs = byTime(buildLoopMidiEvents(route, { bpm: 120, trackStopVelocityMaps: { P: HUBS } }))
  hubs.forEach((e, i) => close(e.velocity, 0.8 * (i % 2 ? 1 : 0.4), `hub ${i}`))

  const authored = byTime(buildLoopMidiEvents(route, {
    bpm: 120, trackStopVelocityMaps: { P: DEMAND }, trackStopVelocities: { P: { 0: 0.9 } },
  }))
  close(authored[0].velocity, 0.8 * 0.9)
})

test('MIDI: arp steps inherit the stop velocity', () => {
  const arp = { enabled: true, style: 'up', rate: '16n', gate: 0.5, octaves: 1, steps: 2, distance: 2 }
  const events = byTime(buildLoopMidiEvents(route, { bpm: 120, trackArps: { P: arp }, trackStopVelocityMaps: { P: HUBS } }))
  close(events[0].velocity, 0.8 * 0.4)
  close(events[1].velocity, 0.8 * 0.4, 'second step of the first (non-hub) stop')
})

test('merged chords: cells carry every signal and the chord follows its strongest stop', () => {
  const quiet = { ...route, id: 'Q', stops: stops.map(s => ({ ...s, signals: { demand: 0, centrality: 0 } })) }
  const busy  = { ...route, id: 'B', stops: stops.map(s => ({ ...s, lat: s.lat + 0.01, signals: { demand: 1, centrality: 0.5 } })) }
  const merged = { ...route, id: 'merge~1', isMerged: true, sourceRoutes: [quiet, busy] }
  const cells = buildMergedPitchCells(merged, {})
  assert.deepEqual(cells[0].signals, { demand: 1, hubs: 0.5 })

  const off = buildLoopMidiEvents(merged, { bpm: 120 })
  assert.ok(off.every(e => e.velocity === 0.8), 'off: merged export unchanged')
  const events = buildLoopMidiEvents(merged, { bpm: 120, trackStopVelocityMaps: { 'merge~1': HUBS } })
  assert.ok(events.every(e => Math.abs(e.velocity - 0.8 * (0.4 + 0.25 * 0.6)) < 1e-9))
})

test('note rows: show the mapped velocity and where it comes from', () => {
  const rows = buildLaneNoteRows(route, { pitchMap: [], stopVelocities: { 1: 0.5 }, velocityMapping: DEMAND })
  assert.equal(rows[0].velocityOrigin, 'demand')
  close(rows[0].velocity, 0.4)
  assert.deepEqual([rows[1].velocity, rows[1].velocityOrigin], [0.5, 'authored'])
  const plain = buildLaneNoteRows(route, { pitchMap: [] })
  assert.deepEqual([plain[3].velocity, plain[3].velocityOrigin], [1, 'variety'])
})

// ── Song state ─────────────────────────────────────────────────────────────

function capture(snapshot, routes = [route]) {
  const state = {}
  const engineCalls = []
  const setters = new Proxy({}, {
    get: (_t, name) => (value) => { const k = String(name).slice(3); state[k[0].toLowerCase() + k.slice(1)] = value },
  })
  const engine = new Proxy({}, { get: (_t, name) => (...args) => { engineCalls.push({ name, args }) } })
  applySnapshot(snapshot, setters, engine, routes)
  return { state, engineCalls }
}

test('song state: saved sparse, sanitized on load, and an old song clears the mapping', () => {
  const snap = buildSnapshot({ routeIds: ['P'], trackStopVelocityMaps: { P: { source: 'hubs', min: 1, max: 0.5 }, X: { source: 'bogus' } } })
  assert.deepEqual(snap.trackStopVelocityMaps, { P: { source: 'hubs', min: 0.5, max: 1, invert: false } })
  assert.deepEqual(buildSnapshot({}).trackStopVelocityMaps, {}, 'absent = off everywhere')

  const { state, engineCalls } = capture({ ...snap, trackStopVelocityMaps: { P: snap.trackStopVelocityMaps.P, Q: 5 } })
  assert.deepEqual(state.trackStopVelocityMaps, { P: snap.trackStopVelocityMaps.P })
  const push = engineCalls.filter(c => c.name === 'setStopVelocityMaps')
  assert.equal(push.length, 1)
  assert.deepEqual(push[0].args[0], { P: snap.trackStopVelocityMaps.P })

  const old = buildSnapshot({ routeIds: ['P'] })
  delete old.trackStopVelocityMaps
  const cleared = capture(old)
  assert.deepEqual(cleared.state.trackStopVelocityMaps, {})
  assert.deepEqual(cleared.engineCalls.find(c => c.name === 'setStopVelocityMaps').args[0], {})
})

// ── AI plans ───────────────────────────────────────────────────────────────

const planRoute = (id) => ({ id, name: id, type: 'bus', stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [planRoute('P'), planRoute('Q')]

test('plans: validated, defaulted, and a bad config reported', () => {
  const raw = { tracks: [
    { routeId: 'P', stopVelocity: { source: 'hubs', min: null, max: 0.9, invert: null } },
    { routeId: 'Q', stopVelocity: { source: 'loud' } },
  ] }
  assert.ok(PLAN_INPUT_SCHEMA.parse({ tracks: [raw.tracks[0]] }), 'the MCP input schema accepts it, nulls included')
  const { plan, dropped } = validatePlan(raw, CITY)
  assert.deepEqual(plan.tracks[0].stopVelocity, { source: 'hubs', min: DEFAULT_STOP_VELOCITY.min, max: 0.9, invert: false })
  assert.equal(plan.tracks[1].stopVelocity, undefined)
  assert.ok(dropped.includes('stopVelocity on "Q"'))
  assert.deepEqual(validatePlan({ tracks: [{ routeId: 'P', stopVelocity: { source: 'off' } }] }, CITY).plan.tracks[0].stopVelocity,
    { source: 'off' })
})

test('plans: apply, describe, switch off, and a new idea starts off', () => {
  const on = validatePlan({ tracks: [{ routeId: 'P', stopVelocity: { source: 'demand', invert: true } }] }, CITY).plan
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), on)
  assert.deepEqual(snapshot.trackStopVelocityMaps, { P: { ...DEFAULT_STOP_VELOCITY, invert: true } })
  const detail = describeSnapshot(snapshot, CITY, { detail: true })
  assert.deepEqual(detail.lanes.find(l => l.routeId === 'P').stopVelocity, { ...DEFAULT_STOP_VELOCITY, invert: true })

  const off = validatePlan({ tracks: [{ routeId: 'P', stopVelocity: { source: 'off' } }] }, CITY).plan
  assert.deepEqual(applyPlanToSnapshot(snapshot, off).snapshot.trackStopVelocityMaps, {})

  const fresh = withNewCompositionBaseline(validatePlan({ tracks: [{ routeId: 'P', synthType: 'Synth' }] }, CITY).plan)
  assert.deepEqual(fresh.tracks[0].stopVelocity, { source: 'off' })
  assert.deepEqual(applyPlanToSnapshot(snapshot, fresh).snapshot.trackStopVelocityMaps, {}, 'a reused lane does not inherit it')
})

test('advisories: PluckSynth and a too-narrow range are named', () => {
  const advise = (track) => planAdvisories({ bpm: 120, tracks: [{ routeId: 'P', ...track }] }, { mode: 'edit' })
  assert.ok(advise({ synthType: 'PluckSynth', stopVelocity: DEMAND }).some(a => /stopVelocity.*PluckSynth/.test(a)))
  assert.ok(advise({ synthType: 'Synth', stopVelocity: { ...DEMAND, min: 0.95 } }).some(a => /barely differ/.test(a)))
  assert.deepEqual(advise({ synthType: 'Synth', stopVelocity: DEMAND }).filter(a => /stopVelocity/.test(a)), [])
})
