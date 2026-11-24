import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLoopMidiEvents, loopLengthSec } from '../lib/midiEvents.js'
import { GRID_TOTAL_CELLS } from '../lib/mappings.js'
import { laneGridStops } from '../lib/lanePitch.js'

const stops = Array.from({ length: 16 }, (_, i) => ({
  id: String(i), name: `S${i}`, lat: 47.48 + (i % 5) * .004, lon: 19.03 + i * .003, dist: i * 100,
}))
const route = { id: 'A', name: 'A', type: 'tram', stops, totalDist: 1600 }

function assertInsideLoop(events, loopSec) {
  for (const ev of events) {
    assert.ok(ev.time >= 0 && ev.time < loopSec, `note at ${ev.time} starts inside the ${loopSec}s loop`)
    assert.ok(ev.time + ev.duration <= loopSec + 1e-9, `note at ${ev.time} ends inside the loop`)
  }
}

test('a full lane exports exactly one 4-bar pass, starting at 0', () => {
  const ctx = { bpm: 120, trackNoteLengths: { A: '1n' } }
  const events = buildLoopMidiEvents(route, ctx)
  assert.equal(loopLengthSec(route, ctx), 8)
  assert.equal(events.length, stops.length)
  assert.equal(events[0].time, 0)
  assertInsideLoop(events, 8)
})

test('a shortened loop exports only the notes inside it, rebased to 0', () => {
  const half = { startCell: GRID_TOTAL_CELLS / 2, endCell: GRID_TOTAL_CELLS * 3 / 4 }
  const ctx = { bpm: 120, trackLoopRegions: { A: half } }
  const events = buildLoopMidiEvents(route, ctx)
  assert.equal(loopLengthSec(route, ctx), 2)
  const inside = laneGridStops(route, { loopRegion: half })
  assert.ok(inside.length > 0 && inside.length < stops.length)
  assert.equal(events.length, inside.length)
  assert.equal(events[0].time, 0)
  assertInsideLoop(events, 2)
})

test('notes never overlap the next note of the same pitch', () => {
  const same = { ...route, stops: stops.map(s => ({ ...s, lat: 47.5, lon: 19.05 })) }
  const events = buildLoopMidiEvents(same, { bpm: 120, trackNoteLengths: { A: '1n' } })
  const sorted = [...events].sort((a, b) => a.time - b.time)
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].midi === sorted[i + 1].midi) {
      assert.ok(sorted[i].time + sorted[i].duration <= sorted[i + 1].time + 1e-9)
    }
  }
})

test('an arpeggiated lane exports its arp steps, clipped to the loop', () => {
  const arp = { enabled: true, style: 'up', rate: '16n', gate: 0.5, octaves: 1, steps: 3, distance: 2 }
  const ctx = { bpm: 120, trackArps: { A: arp } }
  const plain = buildLoopMidiEvents(route, { bpm: 120 })
  const events = buildLoopMidiEvents(route, ctx)
  assert.equal(events.length, plain.length * 3)
  const step = 0.125   // a 16th at 120 bpm
  assert.ok(events.every(ev => Math.abs(ev.duration - step * 0.5) < 1e-9))
  assertInsideLoop(events, 8)
})

test('an Arp on/off lane arpeggiates only the notes inside its on stretch', () => {
  const arp = { enabled: false, style: 'up', rate: '16n', gate: 0.5, octaves: 1, steps: 3, distance: 2 }
  // On from bar 3 (cell 32) to the loop end; the manual switch is off.
  const automationCfg = { A: { l: { paramTarget: 'device.arp', steps: [{ cell: 0, on: false }, { cell: 32, on: true }] } } }
  const plain = buildLoopMidiEvents(route, { bpm: 120 })
  const events = buildLoopMidiEvents(route, { bpm: 120, trackArps: { A: arp }, automationCfg })
  const firstHalf = plain.filter(ev => ev.time < 4).length
  const secondHalf = plain.length - firstHalf
  assert.ok(firstHalf > 0 && secondHalf > 0)
  assert.equal(events.length, firstHalf + secondHalf * 3)
  // An unconfigured arp switched on by the lane plays at the arp defaults.
  const defaults = buildLoopMidiEvents(route, { bpm: 120, automationCfg })
  assert.equal(defaults.length, events.length)
  // A lane with every point off keeps the lane plain even when the button is on.
  const off = { A: { l: { paramTarget: 'device.arp', steps: [{ cell: 0, on: false }] } } }
  assert.equal(buildLoopMidiEvents(route, { bpm: 120, trackArps: { A: { ...arp, enabled: true } }, automationCfg: off }).length, plain.length)
  assertInsideLoop(events, 8)
})
