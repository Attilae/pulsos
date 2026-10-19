import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeStopNoteLength, normalizeStopNoteLengthMap, stopDemand, mergedChordDemand,
  resolveDemandLength, resolveStopHold, stopNoteLengthStatus, nextSamePitchFrac,
  previewStopHolds, DEFAULT_STOP_NOTE_LENGTH,
} from '../lib/stopNoteLength.js'
import { buildLoopMidiEvents } from '../lib/midiEvents.js'
import { buildMergedPitchCells, laneGridStops } from '../lib/lanePitch.js'
import { buildSnapshot, applySnapshot } from '../lib/songState.js'
import { validatePlan } from '../lib/ai/planContract.js'
import { PLAN_INPUT_SCHEMA } from '../lib/ai/planSchema.js'
import { withNewCompositionBaseline } from '../lib/ai/planApply.js'
import { applyPlanToSnapshot, defaultSnapshot, describeSnapshot } from '../lib/ai/planSnapshot.js'
import { planAdvisories } from '../lib/ai/planAdvisories.js'

// Stop-driven note length (lib/stopNoteLength.js): a PolySynth lane's stop
// notes hold for a length derived from each stop's baked-in demand.

const DEMAND = { source: 'demand', min: '4n', max: '1n', invert: false }

test('normalize: defaults, reordered bounds, malformed configs dropped', () => {
  assert.deepEqual(normalizeStopNoteLength({ source: 'demand' }), DEFAULT_STOP_NOTE_LENGTH)
  assert.deepEqual(normalizeStopNoteLength({ source: 'demand', min: '1n', max: '8n' }),
    { source: 'demand', min: '8n', max: '1n', invert: false }, 'reversed bounds are put in order')
  for (const bad of [null, undefined, 'demand', [], {}, { source: 'fixed' }, { source: 'gap' },
    { source: 'demand', min: '3n' }, { source: 'demand', max: 4 }, { source: 'demand', invert: 'yes' }]) {
    assert.equal(normalizeStopNoteLength(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(normalizeStopNoteLengthMap({ a: DEMAND, b: { source: 'x' }, c: null }), { a: DEMAND })
  assert.deepEqual(normalizeStopNoteLengthMap('nope'), {})
})

test('demand reads finite values, clamps them and keeps zero; anything else is missing', () => {
  assert.equal(stopDemand({ signals: { demand: 0 } }), 0)
  assert.equal(stopDemand({ signals: { demand: 0.4 } }), 0.4)
  assert.equal(stopDemand({ signals: { demand: 1.7 } }), 1)
  assert.equal(stopDemand({ signals: { demand: -2 } }), 0)
  for (const d of [undefined, null, '0.5', NaN, Infinity, -Infinity]) assert.equal(stopDemand({ signals: { demand: d } }), null)
  assert.equal(stopDemand({}), null)
})

test('mapping: endpoints, inversion, quantization ties to the shorter length, equal bounds', () => {
  assert.equal(resolveDemandLength(DEMAND, 0), '4n')
  assert.equal(resolveDemandLength(DEMAND, 1), '1n')
  assert.equal(resolveDemandLength({ ...DEMAND, invert: true }, 0), '1n')
  assert.equal(resolveDemandLength({ ...DEMAND, invert: true }, 1), '4n')
  // 4n..1n is 1..4 beats; 0.5 → 2.5 beats sits between 2n (2) and 1n (4): 2n.
  assert.equal(resolveDemandLength(DEMAND, 0.5), '2n')
  // 1/6 → 1.5 beats is exactly 4n. (1.5); 1/12 → 1.25 is a tie of 4n and 4n.: shorter.
  assert.equal(resolveDemandLength(DEMAND, 1 / 6), '4n.')
  assert.equal(resolveDemandLength(DEMAND, 1 / 12), '4n')
  assert.equal(resolveDemandLength({ source: 'demand', min: '2n', max: '2n' }, 0.9), '2n')
  assert.equal(resolveDemandLength({ source: 'demand', min: '1n', max: '16n' }, 0), '16n', 'reversed bounds still map low → short')
  assert.equal(resolveDemandLength(DEMAND, null), null)
  assert.equal(resolveDemandLength(null, 0.5), null)
})

test('a stop without demand holds the fixed gate, not a quiet stop', () => {
  assert.deepEqual(resolveStopHold(DEMAND, null, '8n'), { length: '8n', beats: 0.5, demand: null, fallback: true })
  assert.deepEqual(resolveStopHold(DEMAND, null), { length: null, beats: 1, demand: null, fallback: true })
  assert.equal(resolveStopHold(DEMAND, 0, '1n').length, '4n', 'zero demand is the shortest bound')
})

test('merged chords take the busiest contributor and ignore missing ones', () => {
  assert.equal(mergedChordDemand([0.2, null, 0.7, undefined]), 0.7)
  assert.equal(mergedChordDemand([NaN, null]), null)
  assert.equal(mergedChordDemand([]), null)
  assert.equal(mergedChordDemand([1.4]), 1)
})

test('status: drone, arp and legato win over the mapping; only PolySynth is driven', () => {
  const on = { cfg: DEMAND, synthType: 'PolySynth' }
  assert.equal(stopNoteLengthStatus(on).active, true)
  assert.match(stopNoteLengthStatus({ ...on, drone: true, arp: true }).reason, /Drone/)
  assert.match(stopNoteLengthStatus({ ...on, arp: true, legato: true }).reason, /Arpeggiator/)
  assert.match(stopNoteLengthStatus({ ...on, legato: true }).reason, /Legato/)
  assert.equal(stopNoteLengthStatus({ ...on, legato: true, merged: true }).active, true, 'merged lanes have no legato')
  assert.match(stopNoteLengthStatus({ ...on, synthType: 'Synth' }).reason, /Poly/)
  assert.deepEqual(stopNoteLengthStatus({ synthType: 'PolySynth' }), { active: false, reason: null })
})

test('same-pitch protection wraps the loop and counts the event itself last', () => {
  const events = [{ frac: 0, pitches: [60] }, { frac: 0.25, pitches: [62] }, { frac: 0.5, pitches: [60, 64] }]
  assert.equal(nextSamePitchFrac(events, 0, 60), 0.5)
  assert.equal(nextSamePitchFrac(events, 2, 60), 0.5, 'wraps to the next pass')
  assert.equal(nextSamePitchFrac(events, 1, 62), 1, 'its only onset: a whole loop')
  assert.equal(nextSamePitchFrac(events, 2, 64), 1)
})

test('preview: requested vs effective hold, cut by the next same pitch', () => {
  const points = [
    { key: 'a', frac: 0, midi: 60, demand: 1 },        // 1n requested, next C at a quarter of 16 beats = 4
    { key: 'b', frac: 0.125, midi: 60, demand: 1 },    // next C wraps: 14 beats away
    { key: 'c', frac: 0.5, midi: 67, demand: null },
  ]
  const holds = previewStopHolds(points, { cfg: DEMAND, fixedLength: '2n', loopBeats: 16 })
  assert.equal(holds.get('a').requested.length, '1n')
  assert.equal(holds.get('a').effectiveBeats, 2)
  assert.equal(holds.get('a').cut, true)
  assert.equal(holds.get('b').effectiveBeats, 4)
  assert.equal(holds.get('b').cut, false)
  assert.equal(holds.get('c').requested.fallback, true)
  assert.equal(holds.get('c').effectiveBeats, 2)
})

// ── MIDI export ────────────────────────────────────────────────────────────

const stops = Array.from({ length: 8 }, (_, i) => ({
  id: String(i), name: `S${i}`, lat: 47.48 + i * 0.004, lon: 19.03 + i * 0.003, dist: i * 200,
  signals: { demand: i / 7 },
}))
const route = { id: 'P', name: 'P', type: 'bus', stops, totalDist: 1600 }

test('MIDI: mapped holds follow demand, independent of speed and loop trimming', () => {
  const ctx = { bpm: 120, trackSynthTypes: { P: 'PolySynth' }, trackStopNoteLengths: { P: DEMAND } }
  const events = buildLoopMidiEvents(route, ctx)
  const beatSec = 0.5
  // Stops are 2 beats apart, so every hold under 2 beats survives export as-is.
  assert.equal(events[0].duration, 1 * beatSec, 'demand 0 → 4n')
  const fixed = buildLoopMidiEvents(route, { bpm: 120, trackNoteLengths: { P: '8n' } })
  assert.ok(fixed.every(e => e.duration === 0.25), 'Off reproduces the fixed gate')
  const sped = buildLoopMidiEvents(route, { ...ctx, trackSpeeds: { P: 0.5 } })
  assert.equal(sped[0].duration, events[0].duration, 'speed spaces onsets but does not scale holds')
  assert.ok(sped.at(-1).duration > sped[0].duration, 'busier stops hold longer')
  // Trimming the loop must not re-normalize demand over the remaining stops.
  const region = { startCell: 32, endCell: 64 }
  const trimmed = buildLoopMidiEvents(route, { ...ctx, trackSpeeds: { P: 0.25 }, trackLoopRegions: { P: region } })
  const slow = buildLoopMidiEvents(route, { ...ctx, trackSpeeds: { P: 0.25 } })
  const inside = laneGridStops(route, { loopRegion: region }).length
  assert.deepEqual(trimmed.map(e => e.duration), slow.slice(-inside).map(e => e.duration))
})

test('MIDI: tempo scales the hold; inactive lanes keep the fixed gate', () => {
  const ctx = { bpm: 60, trackSynthTypes: { P: 'PolySynth' }, trackStopNoteLengths: { P: DEMAND }, trackSpeeds: { P: 0.25 } }
  const slow = buildLoopMidiEvents(route, ctx)
  assert.equal(slow.at(-1).duration, 4, 'demand 1 → 1n = 4 s at 60 BPM')
  const synth = buildLoopMidiEvents(route, { ...ctx, trackSynthTypes: { P: 'Synth' } })
  assert.ok(synth.every(e => e.duration === 1), 'not a PolySynth: the default one-beat gate')
  const legato = buildLoopMidiEvents(route, { ...ctx, trackLegatos: { P: true } })
  assert.ok(legato[0].duration > 4, 'legato wins: holds to the next stop')
  const arp = buildLoopMidiEvents(route, { ...ctx, trackArps: { P: { enabled: true, style: 'up', rate: '16n', gate: 0.5, octaves: 1, steps: 2, distance: 2 } } })
  assert.ok(arp.every(e => e.duration === 0.125), 'arp steps keep their own gate')
})

test('MIDI: a repeated pitch never overlaps itself, and nothing rings past the loop', () => {
  const same = { ...route, stops: stops.map(s => ({ ...s, lat: 47.5, lon: 19.05, signals: { demand: 1 } })) }
  const events = buildLoopMidiEvents(same, { bpm: 120, trackSynthTypes: { P: 'PolySynth' }, trackStopNoteLengths: { P: DEMAND } })
  for (let i = 0; i < events.length - 1; i++) assert.ok(events[i].time + events[i].duration <= events[i + 1].time + 1e-9)
  const last = events.at(-1)
  assert.ok(last.time + last.duration <= 8 + 1e-9)
})

test('merged chords: contributors carry demand; the chord holds for the busiest', () => {
  const quiet = { ...route, id: 'Q', stops: stops.map(s => ({ ...s, signals: { demand: 0 } })) }
  const busy  = { ...route, id: 'B', stops: stops.map(s => ({ ...s, lat: s.lat + 0.01, signals: { demand: 1 } })) }
  const none  = { ...route, id: 'N', stops: stops.map(({ signals, ...s }) => s) }
  const merged = { ...route, id: 'merge~1', isMerged: true, sourceRoutes: [quiet, busy, none] }
  const cells = buildMergedPitchCells(merged, {})
  assert.equal(cells[0].demand, 1)
  assert.deepEqual(cells[0].sources.map(c => c.routeId), ['Q', 'B', 'N'])
  assert.equal(cells[0].sources[2].demand, null)
  const allMissing = buildMergedPitchCells({ ...merged, sourceRoutes: [none] }, {})
  assert.equal(allMissing[0].demand, null)

  const ctx = { bpm: 120, trackSynthTypes: { 'merge~1': 'PolySynth' }, trackStopNoteLengths: { 'merge~1': { ...DEMAND, min: '16n', max: '8n.' } } }
  const events = buildLoopMidiEvents(merged, ctx)
  assert.ok(events.every(e => e.duration === 0.375), 'every chord note holds 8n. (0.375 s), from the busy source')
  const fallback = buildLoopMidiEvents({ ...merged, sourceRoutes: [none] }, ctx)
  assert.ok(fallback.every(e => e.duration === 0.5), 'all contributors missing → the fixed one-beat gate')
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
  const snap = buildSnapshot({ routeIds: ['P'], trackStopNoteLengths: { P: { source: 'demand', min: '1n', max: '8n' }, X: { source: 'bogus' } } })
  assert.deepEqual(snap.trackStopNoteLengths, { P: { source: 'demand', min: '8n', max: '1n', invert: false } })
  assert.deepEqual(buildSnapshot({}).trackStopNoteLengths, {}, 'absent = Fixed everywhere')

  const { state, engineCalls } = capture({ ...snap, trackStopNoteLengths: { P: snap.trackStopNoteLengths.P, Q: 5 } })
  assert.deepEqual(state.trackStopNoteLengths, { P: snap.trackStopNoteLengths.P })
  const push = engineCalls.filter(c => c.name === 'setStopNoteLengths')
  assert.equal(push.length, 1)
  assert.deepEqual(push[0].args[0], { P: snap.trackStopNoteLengths.P })

  // A pre-feature song has no key at all: the whole map is replaced with {}.
  const old = buildSnapshot({ routeIds: ['P'] })
  delete old.trackStopNoteLengths
  const cleared = capture(old)
  assert.deepEqual(cleared.state.trackStopNoteLengths, {})
  assert.deepEqual(cleared.engineCalls.find(c => c.name === 'setStopNoteLengths').args[0], {})
})

// ── AI plans ───────────────────────────────────────────────────────────────

const planRoute = (id) => ({ id, name: id, type: 'bus', stops: [{ lat: 1, lon: 2 }], totalDist: 10 })
const CITY = [planRoute('P'), planRoute('Q')]

test('plans: validated, defaulted, and a bad config reported', () => {
  const raw = { tracks: [
    { routeId: 'P', synthType: 'PolySynth', stopNoteLength: { source: 'demand', min: null, max: '2n', invert: null } },
    { routeId: 'Q', synthType: 'PolySynth', stopNoteLength: { source: 'demand', min: '3n' } },
  ] }
  assert.ok(PLAN_INPUT_SCHEMA.parse({ tracks: [raw.tracks[0]] }), 'the MCP input schema accepts it, nulls included')
  const { plan, dropped } = validatePlan(raw, CITY)
  assert.deepEqual(plan.tracks[0].stopNoteLength, { source: 'demand', min: '4n', max: '2n', invert: false })
  assert.equal(plan.tracks[1].stopNoteLength, undefined)
  assert.ok(dropped.includes('stopNoteLength on "Q"'))
  assert.deepEqual(validatePlan({ tracks: [{ routeId: 'P', stopNoteLength: { source: 'fixed' } }] }, CITY).plan.tracks[0].stopNoteLength,
    { source: 'fixed' })
})

test('plans: both apply paths agree, Fixed keeps the fixed length, and a new idea starts Fixed', () => {
  const on = validatePlan({ tracks: [{ routeId: 'P', synthType: 'PolySynth', noteLength: '2n', stopNoteLength: { source: 'demand', invert: true } }] }, CITY).plan
  const { snapshot } = applyPlanToSnapshot(defaultSnapshot('budapest'), on)
  assert.deepEqual(snapshot.trackStopNoteLengths, { P: { ...DEFAULT_STOP_NOTE_LENGTH, invert: true } })
  assert.equal(snapshot.trackNoteLengths.P, '2n')
  const detail = describeSnapshot(snapshot, CITY, { detail: true })
  assert.deepEqual(detail.lanes.find(l => l.routeId === 'P').stopNoteLength, { ...DEFAULT_STOP_NOTE_LENGTH, invert: true })

  const off = validatePlan({ tracks: [{ routeId: 'P', stopNoteLength: { source: 'fixed' } }] }, CITY).plan
  const { snapshot: fixed } = applyPlanToSnapshot(snapshot, off)
  assert.deepEqual(fixed.trackStopNoteLengths, {})
  assert.equal(fixed.trackNoteLengths.P, '2n', 'switching back never erases the fixed gate')

  const fresh = withNewCompositionBaseline(validatePlan({ tracks: [{ routeId: 'P', synthType: 'PolySynth' }] }, CITY).plan)
  assert.deepEqual(fresh.tracks[0].stopNoteLength, { source: 'fixed' })
  const { snapshot: reset } = applyPlanToSnapshot(snapshot, fresh)
  assert.deepEqual(reset.trackStopNoteLengths, {}, 'a reused lane does not inherit the old mapping')
})

test('advisories: inert mappings are named, and the attack check uses the longest hold', () => {
  const advise = (track) => planAdvisories({ bpm: 120, tracks: [{ routeId: 'P', ...track }] }, { mode: 'edit' })
  const demand = { source: 'demand', min: '4n', max: '1n', invert: false }
  assert.ok(advise({ synthType: 'Synth', stopNoteLength: demand }).some(a => /stopNoteLength.*Poly \/ Pad/.test(a)))
  assert.ok(advise({ synthType: 'PolySynth', legato: true, stopNoteLength: demand }).some(a => /stopNoteLength.*legato/.test(a)))
  const env = (attack) => ({ attack, decay: 0.2, sustain: 0.8, release: 1 })
  assert.deepEqual(advise({ synthType: 'PolySynth', stopNoteLength: demand, envelope: env(1.5) }).filter(a => /attack/.test(a)), [],
    'a 1.5 s attack peaks within a 2 s (1n) hold')
  assert.ok(advise({ synthType: 'PolySynth', stopNoteLength: demand, envelope: env(2.5) }).some(a => /at most 1n/.test(a)))
})

// Tone.PolySynth's release takes the *oldest unreleased* voice of a pitch
// (node_modules/tone/build/esm/instrument/PolySynth.js _triggerRelease). This
// replays that rule over several loop passes with the same bound the engine
// applies (_mappedHoldSec → nextSamePitchFrac) and checks every release lands
// on the voice its own note started, and nothing is left sounding.
test('release ownership: with same-pitch protection every gate releases its own voice', () => {
  const pitches = [60, 62, 60, 60, 64, 62, 60]
  const points = pitches.map((midi, i) => ({ key: String(i), frac: i / pitches.length, midi, demand: i % 2 ? 1 : 0.6 }))
  const loopBeats = 4   // short loop: 1n (4 beats) gates would cross the wrap
  const holds = previewStopHolds(points, { cfg: DEMAND, loopBeats })
  const unbounded = [...holds.values()].some(h => h.requested.beats > loopBeats / pitches.length * 2)
  assert.ok(unbounded, 'the scenario really asks for overlapping same-pitch gates')

  const events = []
  for (let pass = 0; pass < 4; pass++) {
    points.forEach((p, i) => {
      const t = (pass + p.frac) * loopBeats
      events.push({ t, kind: 'attack', midi: p.midi, id: `${pass}:${i}`, order: events.length })
      events.push({ t: t + holds.get(p.key).effectiveBeats, kind: 'release', midi: p.midi, id: `${pass}:${i}`, order: events.length })
    })
  }
  // Tone's timeline runs same-time events in insertion order; a release was
  // always scheduled before the later note's attack.
  events.sort((a, b) => a.t - b.t || a.order - b.order)
  const active = []
  for (const ev of events) {
    if (ev.kind === 'attack') { active.push({ midi: ev.midi, id: ev.id, released: false }); continue }
    const voice = active.find(v => v.midi === ev.midi && !v.released)
    assert.ok(voice, `release of ${ev.id} found a voice`)
    assert.equal(voice.id, ev.id, `release of ${ev.id} released its own note`)
    voice.released = true
  }
  assert.ok(active.every(v => v.released), 'no stuck notes')
})
