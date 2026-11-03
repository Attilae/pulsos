import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_REFERENCE, REFERENCE_NAME_MAX, cycleSeconds, guessBars, bpmForBars,
  referenceDrift, driftWarning, normalizeReference, computePeaks, durationBucket, formatOf,
} from '../lib/referenceTrack.js'

const ID = 'a1b2c3d4e5f6a7b8'

test('cycleSeconds is 4/4 bars at the tempo', () => {
  assert.equal(cycleSeconds(4, 120), 8)
  assert.equal(cycleSeconds(1, 60), 4)
  assert.equal(cycleSeconds(0, 120), 0)
  assert.equal(cycleSeconds(4, 0), 0)
})

test('guessBars picks the nearest power-of-two bar count', () => {
  assert.equal(guessBars(8, 120), 4)
  assert.equal(guessBars(8.2, 120), 4, 'a slightly long render still reads as 4 bars')
  assert.equal(guessBars(16, 120), 8)
  assert.equal(guessBars(2, 120), 1)
  assert.equal(guessBars(0.5, 120), 1, 'shorter than a bar clamps to 1')
  assert.equal(guessBars(500, 120), 32)
  assert.equal(guessBars(0, 120), DEFAULT_REFERENCE.bars)
})

test('bpmForBars inverts the cycle and clamps to the app range', () => {
  assert.equal(bpmForBars(8, 4), 120)
  assert.equal(bpmForBars(7.8, 4), 123.08)
  assert.equal(bpmForBars(100, 1), 40, 'clamped low')
  assert.equal(bpmForBars(0.1, 4), 240, 'clamped high')
  assert.equal(bpmForBars(0, 4), null)
  for (const [dur, bars] of [[8, 4], [9.6, 4], [31.2, 16]]) {
    const bpm = bpmForBars(dur, bars)
    assert.ok(Math.abs(cycleSeconds(bars, bpm) - dur) < 0.01, `round trip ${dur}s/${bars}`)
  }
})

test('drift: signed, offset-aware, and only warned past 1%', () => {
  assert.equal(referenceDrift(8, 4, 120), 0)
  assert.ok(referenceDrift(8.8, 4, 120) > 0.09)
  assert.ok(referenceDrift(7.2, 4, 120) < -0.09)
  assert.equal(referenceDrift(8.5, 4, 120, 0.5), 0, 'the start offset is skipped audio')
  assert.equal(driftWarning(8.04, 4, 120), null, 'under 1% is fine')
  assert.match(driftWarning(8.8, 4, 120), /10% longer than 4 bars at 120 BPM/)
  assert.match(driftWarning(7.2, 4, 120), /10% shorter/)
  assert.match(driftWarning(2.4, 1, 120), /than 1 bar /)
})

test('normalizeReference rejects junk and clamps everything', () => {
  assert.equal(normalizeReference(null), null)
  assert.equal(normalizeReference({ name: 'x' }), null, 'no id')
  assert.equal(normalizeReference({ id: '../../etc' }), null, 'unsafe id')
  assert.equal(normalizeReference({ id: 'short' }), null)
  const n = normalizeReference({
    id: ID, name: 'x'.repeat(500), durationSec: '8', bars: 3, offsetSec: 99,
    volumeDb: 50, muted: 'yes', includeInExport: true, extra: 'dropped',
  })
  assert.deepEqual(n, {
    id: ID, name: 'x'.repeat(REFERENCE_NAME_MAX), durationSec: 8, bars: DEFAULT_REFERENCE.bars,
    offsetSec: 10, volumeDb: 6, muted: false, includeInExport: true,
  })
  assert.equal(normalizeReference({ id: ID, volumeDb: -100 }).volumeDb, -40)
  assert.equal(normalizeReference({ id: ID }).volumeDb, DEFAULT_REFERENCE.volumeDb)
  assert.equal(normalizeReference({ id: ID, bars: 16 }).bars, 16)
})

test('computePeaks takes the max across channels per bucket', () => {
  const l = new Float32Array([0, 0.5, 0, 0, -0.9, 0, 0, 0])
  const r = new Float32Array([0, 0, 0.2, 0, 0, 0, 0, 2])
  const p = computePeaks([l, r], 4)
  assert.equal(p.length, 4)
  assert.deepEqual(Array.from(p).map(v => Math.round(v * 10) / 10), [0.5, 0.2, 0.9, 1])
  assert.equal(computePeaks([], 4).length, 0)
  assert.equal(computePeaks([new Float32Array(2)], 10).length, 2, 'never more buckets than samples')
})

test('analytics helpers never leak the file name', () => {
  assert.equal(durationBucket(3), '<5s')
  assert.equal(durationBucket(20), '15-30s')
  assert.equal(durationBucket(200), '60s+')
  assert.equal(formatOf('My Loop.AIF'), 'aiff')
  assert.equal(formatOf('beat.wav'), 'wav')
  assert.equal(formatOf('beat.mp3'), 'mp3')
  assert.equal(formatOf('noext'), 'unknown')
})
