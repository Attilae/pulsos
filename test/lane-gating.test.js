import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_LOOP_PATTERN, LOOP_PATTERN_PRESETS,
  normalizeNoteChance, normalizeLoopPattern, patternPeriod, isDefaultPattern,
  loopPlays, loopIndexAt, resolveNoteChance, rollChance, formatLoopPattern,
  normalizeNoteChanceMap, normalizeStopChanceMap, normalizeLoopPatternMap,
} from '../lib/laneGating.js'

const plays = (p, n) => Array.from({ length: n }, (_, i) => loopPlays(i, p))

test('normalizeNoteChance: clamps, and junk means always', () => {
  assert.equal(normalizeNoteChance(0.4), 0.4)
  assert.equal(normalizeNoteChance(-1), 0)
  assert.equal(normalizeNoteChance(7), 1)
  assert.equal(normalizeNoteChance(undefined), 1)
  assert.equal(normalizeNoteChance(null), 1)
  assert.equal(normalizeNoteChance('abc'), 1)
})

test('normalizeLoopPattern: clamps fields and wraps offset into the period', () => {
  assert.deepEqual(normalizeLoopPattern(undefined), { ...DEFAULT_LOOP_PATTERN })
  assert.deepEqual(normalizeLoopPattern({ play: 0, rest: -3 }), { play: 1, rest: 0, offset: 0 })
  assert.deepEqual(normalizeLoopPattern({ play: 99, rest: 99 }), { play: 16, rest: 16, offset: 0 })
  assert.deepEqual(normalizeLoopPattern({ play: 1, rest: 3, offset: 5 }), { play: 1, rest: 3, offset: 1 })
  assert.deepEqual(normalizeLoopPattern({ play: 1, rest: 3, offset: -1 }), { play: 1, rest: 3, offset: 3 })
  assert.deepEqual(normalizeLoopPattern({ play: 'x', rest: null }), { play: 1, rest: 0, offset: 0 })
})

test('patternPeriod / isDefaultPattern', () => {
  assert.equal(patternPeriod({ play: 2, rest: 2 }), 4)
  assert.equal(patternPeriod(undefined), 1)
  assert.equal(isDefaultPattern(undefined), true)
  assert.equal(isDefaultPattern({ play: 3, rest: 0 }), true)
  assert.equal(isDefaultPattern({ play: 1, rest: 1 }), false)
})

test('loopPlays: default plays every loop', () => {
  assert.deepEqual(plays(undefined, 5), [true, true, true, true, true])
})

test('loopPlays: every 4th loop', () => {
  assert.deepEqual(plays({ play: 1, rest: 3 }, 8), [true, false, false, false, true, false, false, false])
})

test('loopPlays: skip 2 loops', () => {
  assert.deepEqual(plays({ play: 1, rest: 2 }, 6), [true, false, false, true, false, false])
})

test('loopPlays: 2 on 2 off', () => {
  assert.deepEqual(plays({ play: 2, rest: 2 }, 8), [true, true, false, false, true, true, false, false])
})

test('loopPlays: offset shifts the phase so two lanes can interlock', () => {
  assert.deepEqual(plays({ play: 1, rest: 1, offset: 1 }, 4), [false, true, false, true])
  assert.deepEqual(plays({ play: 1, rest: 3, offset: 2 }, 8), [false, false, true, false, false, false, true, false])
})

test('loopIndexAt: counts whole loops from the anchor', () => {
  assert.equal(loopIndexAt(0, 0, 2), 0)
  assert.equal(loopIndexAt(1.99, 0, 2), 0)
  assert.equal(loopIndexAt(2, 0, 2), 1)
  assert.equal(loopIndexAt(10, 4, 2), 3)
  // float error right on a boundary still lands in the new loop
  assert.equal(loopIndexAt(0.1 + 0.2, 0, 0.3), 1)
})

test('loopIndexAt: before the anchor or with a bad loop length is loop 0', () => {
  assert.equal(loopIndexAt(1, 4, 2), 0)
  assert.equal(loopIndexAt(5, 0, 0), 0)
  assert.equal(loopIndexAt(5, 0, NaN), 0)
})

test('resolveNoteChance: stop override beats lane, lane beats default', () => {
  assert.equal(resolveNoteChance(0.5, undefined), 0.5)
  assert.equal(resolveNoteChance(0.5, 0), 0)
  assert.equal(resolveNoteChance(0.5, 1), 1)
  assert.equal(resolveNoteChance(undefined, undefined), 1)
})

test('rollChance: certain outcomes never consume the rng', () => {
  const boom = () => { throw new Error('rng consumed') }
  assert.equal(rollChance(1, boom), true)
  assert.equal(rollChance(0, boom), false)
  assert.equal(rollChance(NaN, boom), false)
  assert.equal(rollChance(0.5, () => 0.49), true)
  assert.equal(rollChance(0.5, () => 0.5), false)
})

test('formatLoopPattern', () => {
  assert.equal(formatLoopPattern(undefined), '')
  assert.equal(formatLoopPattern({ play: 1, rest: 3 }), '1:3')
  assert.equal(formatLoopPattern({ play: 1, rest: 3, offset: 2 }), '1:3+2')
})

test('LOOP_PATTERN_PRESETS are already normalized', () => {
  for (const p of LOOP_PATTERN_PRESETS) {
    const n = normalizeLoopPattern(p)
    assert.equal(n.play, p.play)
    assert.equal(n.rest, p.rest)
  }
})

test('snapshot sanitizers: drop defaults and junk, keep real values', () => {
  assert.deepEqual(normalizeNoteChanceMap({ a: 0.5, b: 1, c: 'x', d: null, e: 3, f: -2 }), { a: 0.5, f: 0 })
  assert.deepEqual(normalizeNoteChanceMap(null), {})
  assert.deepEqual(normalizeStopChanceMap({ a: { s1: 0, s2: 1, s3: 'x' }, b: {}, c: 5 }), { a: { s1: 0, s2: 1 } })
  assert.deepEqual(normalizeLoopPatternMap({ a: { play: 1, rest: 3 }, b: { play: 2, rest: 0 }, c: 'x' }),
    { a: { play: 1, rest: 3, offset: 0 } })
})
