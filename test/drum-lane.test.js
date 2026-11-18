import test from 'node:test'
import assert from 'node:assert/strict'
import { STEPS, SOURCE_STEPS, normalizeStep, cycleStepValue } from '../lib/drumSpecs.js'
import { drumSourceStep, drumVisibleStep, drumSourcePage, drumPlaybackStep, drumVelocityClass, drumWindowLabel, drumLaneEnabled } from '../lib/drumLane.js'

test('every source-page edit maps back through the existing offset-based handler', () => {
  for (let offset = 0; offset < SOURCE_STEPS; offset++) {
    for (let source = 0; source < SOURCE_STEPS; source++) {
      const relative = drumVisibleStep(offset, source)
      assert.equal((offset + relative) % SOURCE_STEPS, source)
      assert.equal(drumSourceStep(offset, relative), source)
    }
  }
})
test('four pages describe source slots, while playback stays a 16-step window', () => {
  assert.equal(STEPS, 16)
  assert.equal(SOURCE_STEPS, 64)
  assert.deepEqual([0, 15, 16, 31, 32, 47, 48, 63].map(drumSourcePage), [0, 0, 1, 1, 2, 2, 3, 3])
  assert.equal(drumSourceStep(60, 7), 3)
  assert.equal(drumSourcePage(drumSourceStep(60, 7)), 0)
  assert.equal(drumVisibleStep(60, 3) < STEPS, true)
  assert.equal(drumVisibleStep(60, 20) < STEPS, false)
})
test('playhead follows tempo and wraps every bar, including nonzero pad offsets', () => {
  assert.equal(drumPlaybackStep(0, 120), 0)
  assert.equal(drumPlaybackStep(.125, 120), 1)
  assert.equal(drumPlaybackStep(1.875, 120), 15)
  assert.equal(drumPlaybackStep(2, 120), 0)
  assert.equal(drumPlaybackStep(.25, 240), 4)
  assert.equal(drumPlaybackStep(.125, 0), 1)
  assert.equal(drumPlaybackStep(-1, 120), 0)
  assert.equal(drumSourceStep(16, drumPlaybackStep(.25, 120)), 18)
})
test('legacy booleans retain velocity cycling and the existing vel classes', () => {
  assert.equal(normalizeStep(true), 1)
  assert.equal(normalizeStep(false), 0)
  let value = 0
  const cycle = Array.from({ length: 4 }, () => (value = cycleStepValue(value)))
  assert.deepEqual(cycle, [1, .7, .4, 0])
  assert.equal(cycleStepValue(true), .7)
  assert.deepEqual([false, true, .7, .4].map(drumVelocityClass), ['', 'vel-accent', 'vel-norm', 'vel-soft'])
  assert.equal(drumVelocityClass(.85), 'vel-accent')
  assert.equal(drumVelocityClass(.55), 'vel-norm')
})
test('window labels show wraparound and normalized source offsets truthfully', () => {
  assert.equal(drumWindowLabel(0), '1–16')
  assert.equal(drumWindowLabel(16), '17–32')
  assert.equal(drumWindowLabel(60), '61–64, 1–12')
  assert.equal(drumWindowLabel(64), '1–16')
  assert.equal(drumSourceStep(-4, 0), 60)
})

test('sound diagnostics count enabled drums without treating a muted bus as audible', () => {
  assert.equal(drumLaneEnabled(null, false), false)
  assert.equal(drumLaneEnabled({ patterns: {}, muted: {} }, true), false)
  assert.equal(drumLaneEnabled({ patterns: {}, muted: {} }, false), true)
  const allMuted = Object.fromEntries(['kick', 'snare', 'hat', 'rim', 'ride', 'clap'].map(id => [id, true]))
  assert.equal(drumLaneEnabled({ patterns: {}, muted: allMuted }, false), false)
  assert.equal(drumLaneEnabled({ patterns: {}, muted: { ...allMuted, kick: false } }, false), true)
})
