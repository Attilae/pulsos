import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RING, RING_CAP, effectiveReducedMotion, ringOpacity, coalesceAttacks, RingSlots, nextFlushDelay,
} from '../lib/mapMotion.js'

test('reduced motion is the OS setting or the user opt-in, never less', () => {
  assert.equal(effectiveReducedMotion(false, false), false)
  assert.equal(effectiveReducedMotion(true, false), true)
  assert.equal(effectiveReducedMotion(false, true), true)
  assert.equal(effectiveReducedMotion(true, true), true)
})

test('ring constants match the plan', () => {
  assert.deepEqual([RING.lifeMs, RING.fromPx, RING.toPx, RING.opacity], [220, 12, 28, 0.65])
  assert.deepEqual(RING_CAP, { desktop: 8, phone: 4 })
  assert.equal(ringOpacity(1), 0.65)
  assert.ok(ringOpacity(0) < ringOpacity(0.5))
  assert.equal(ringOpacity(undefined), 0.65)
})

const stops = { s1: { lat: 52.5, lon: 13.4 }, s2: { lat: 52.6, lon: 13.5 } }
const locate = ev => (stops[ev.stopId] ? { stop: stops[ev.stopId], color: '#fff' } : null)

test('coalesceAttacks: one ring per lane+stop at the loudest velocity', () => {
  const out = coalesceAttacks([
    { routeId: 'a', stopId: 's1', velocity: 0.4 },
    { routeId: 'a', stopId: 's1', velocity: 0.9 },
    { routeId: 'b', stopId: 's1', velocity: 0.5 },     // other lane, same stop: its own ring
    { routeId: 'a', stopId: 's2' },                    // no velocity → full
  ], locate)
  assert.deepEqual(out.map(r => [r.key, r.velocity]), [['a|s1', 0.9], ['b|s1', 0.5], ['a|s2', 1]])
})

test('coalesceAttacks: no ring without real geometry', () => {
  const out = coalesceAttacks([
    { routeShortName: '__drums__', note: 'C2' },            // drums: no route/stop
    { routeId: 'merge~x', routeShortName: 'A+B', note: 'C4' }, // merged chord: no stopId
    { routeId: 'a', stopId: 'nowhere', stopName: 'Somewhere' }, // unknown stop: never guessed
  ], locate)
  assert.deepEqual(out, [])
})

test('RingSlots: reuses a live lane+stop slot, then free slots, then the oldest', () => {
  const slots = new RingSlots(2, 220)
  assert.equal(slots.take('a', 0), 0)
  assert.equal(slots.take('a', 50), 0)       // same lane+stop while live: same effect
  assert.equal(slots.take('b', 60), 1)
  assert.equal(slots.live(100), 2)
  assert.equal(slots.take('c', 100), 0)      // full: replace the oldest (a, restarted at 50)
  assert.equal(slots.take('d', 400), 0)      // all expired: first free slot
  assert.equal(slots.live(400), 1)
  slots.clear()
  assert.equal(slots.live(400), 0)
})

test('current-stop flushes are spaced at least 500ms apart', () => {
  assert.equal(nextFlushDelay(1000, 0), 0)
  assert.equal(nextFlushDelay(1200, 1000), 300)
  assert.equal(nextFlushDelay(1500, 1000), 0)
})
