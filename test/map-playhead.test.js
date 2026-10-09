import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lanePlayhead, loopWindow, trailFracs, wrapFade } from '../lib/mapPlayhead.js'

// A full line loops every 16 beats at 1x.
test('full line at 1x walks the whole route once per 16 beats', () => {
  assert.equal(lanePlayhead({ beats: 0 }).frac, 0)
  assert.equal(lanePlayhead({ beats: 8 }).frac, 0.5)
  assert.equal(lanePlayhead({ beats: 20 }).frac, 0.25)
})

test('speed shortens the loop', () => {
  assert.equal(lanePlayhead({ beats: 4, speed: 2 }).frac, 0.5)
})

test('a loop region keeps the dot inside it and loops on its own length', () => {
  const region = { startCell: 16, endCell: 32 }   // second quarter of the line, 4-beat loop
  assert.deepEqual(loopWindow(region), { startFrac: 0.25, endFrac: 0.5 })
  assert.equal(lanePlayhead({ beats: 0, region }).frac, 0.25)
  assert.equal(lanePlayhead({ beats: 2, region }).frac, 0.375)
  assert.equal(lanePlayhead({ beats: 6, region }).frac, 0.375)
})

test('degenerate inputs stay finite', () => {
  const { frac, phase } = lanePlayhead({ beats: -1, speed: 0, region: { startCell: 70, endCell: 2 } })
  assert.ok(Number.isFinite(frac) && Number.isFinite(phase))
})

test('wrapFade is 0 at the wrap and 1 mid-loop', () => {
  assert.equal(wrapFade(0), 0)
  assert.equal(wrapFade(0.5), 1)
  assert.ok(Math.abs(wrapFade(0.99) - 0.2) < 1e-9)
})

test('trail ends at the dot and spans trailBeats behind it', () => {
  const f = trailFracs({ beats: 8, trailBeats: 2, samples: 4 })   // full line, 16-beat loop
  assert.equal(f.length, 5)
  assert.equal(f.at(-1), 0.5)
  assert.equal(f[0], 0.375)
})

test('trail never reaches back past the loop start', () => {
  const region = { startCell: 16, endCell: 32 }
  const f = trailFracs({ beats: 4.5, region, trailBeats: 2, samples: 4 })  // just after the wrap
  assert.equal(f[0], 0.25)
  assert.ok(f.every(x => x >= 0.25 && x <= 0.5))
})
