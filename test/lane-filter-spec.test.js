import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANALOG_MODEL, CLASSIC_MODEL, ANALOG_NOTCH_NOTICE, DEFAULT_LANE_FILTER,
  analogMaxCutoff, analogModeIndex, effectiveCutoff, filterModelPatch, filterTargetActive,
  normalizeLaneFilter, normalizeTrackFilters, resolveLaneFilter, resonanceFromPercent,
  resonanceToPercent, validatePlanFilter,
} from '../lib/laneFilterSpec.js'

test('a legacy filter normalises to itself (old songs reproduce exactly)', () => {
  const legacy = { type: 'bandpass', frequency: 840, Q: 7.5 }
  assert.deepEqual(normalizeLaneFilter(legacy), legacy)
  assert.deepEqual(normalizeTrackFilters({ M1: legacy, bad: 3 }), { M1: legacy })
})

test('missing model means Classic, with legacy defaults', () => {
  const r = resolveLaneFilter({})
  assert.equal(r.model, CLASSIC_MODEL)
  assert.equal(r.type, DEFAULT_LANE_FILTER.type)
  assert.equal(r.frequency, 20000)
  assert.equal(r.Q, 4)
  assert.equal(r.bypass, false)
  assert.equal(resolveLaneFilter(null).model, CLASSIC_MODEL)
})

test('untrusted values are dropped or clamped; nothing converts Q to resonance', () => {
  const n = normalizeLaneFilter({
    model: ANALOG_MODEL, type: 'comb', frequency: Infinity, Q: 99, resonance: NaN, drive: -2, slope: 18, bypass: 'yes', extra: 1,
  })
  assert.deepEqual(n, { model: ANALOG_MODEL, Q: 20, drive: 0 })
  assert.equal(normalizeLaneFilter({ model: 'moog' }).model, undefined)
  assert.equal(normalizeLaneFilter([]), null)
  assert.equal(normalizeLaneFilter({ Q: 0.5 }).resonance, undefined)
})

test('a stored Analog notch becomes lowpass', () => {
  assert.equal(normalizeLaneFilter({ model: ANALOG_MODEL, type: 'notch' }).type, 'lowpass')
  assert.equal(normalizeLaneFilter({ model: CLASSIC_MODEL, type: 'notch' }).type, 'notch')
})

test('effective cutoff: requested value kept, Analog clamps to 0.425 × rate', () => {
  assert.equal(analogMaxCutoff(44100), 0.425 * 44100)
  assert.equal(analogMaxCutoff(48000), 20000)
  assert.equal(effectiveCutoff({ model: ANALOG_MODEL, frequency: 20000 }, 44100), 0.425 * 44100)
  assert.equal(effectiveCutoff({ frequency: 20000 }, 44100), 20000)
  assert.equal(effectiveCutoff({ model: ANALOG_MODEL, frequency: 5 }, 48000), 20)
})

test('six mode mappings', () => {
  const got = []
  for (const type of ['lowpass', 'bandpass', 'highpass']) for (const slope of [24, 12]) got.push(analogModeIndex(type, slope))
  assert.deepEqual(got, [0, 1, 2, 3, 4, 5])
  assert.equal(analogModeIndex(undefined, undefined), 0)
})

test('resonance percent is linear over 0..1.8', () => {
  assert.equal(resonanceToPercent(0.2), 11.1)
  assert.equal(resonanceToPercent(1.8), 100)
  assert.equal(resonanceFromPercent(50), 0.9)
  assert.equal(resonanceFromPercent(150), 1.8)
})

test('switching to Analog from notch changes the response and says so', () => {
  const { patch, notice } = filterModelPatch({ type: 'notch', frequency: 900, Q: 3 }, ANALOG_MODEL)
  assert.deepEqual(patch, { model: ANALOG_MODEL, type: 'lowpass', resonance: 0.2, drive: 1, slope: 24 })
  assert.equal(notice, ANALOG_NOTCH_NOTICE)
  // Stored Analog values survive a round trip through Classic.
  const back = filterModelPatch({ model: ANALOG_MODEL, resonance: 1.1, drive: 2.5, slope: 12 }, ANALOG_MODEL)
  assert.deepEqual(back.patch, { model: ANALOG_MODEL })
  assert.deepEqual(filterModelPatch({ model: ANALOG_MODEL }, CLASSIC_MODEL), { patch: { model: CLASSIC_MODEL }, notice: null })
})

test('automation eligibility follows the model', () => {
  const analog = { model: ANALOG_MODEL }
  assert.equal(filterTargetActive('filter.frequency', analog), true)
  assert.equal(filterTargetActive('filter.frequency', {}), true)
  assert.equal(filterTargetActive('filter.Q', analog), false)
  assert.equal(filterTargetActive('filter.Q', {}), true)
  assert.equal(filterTargetActive('filter.resonance', analog), true)
  assert.equal(filterTargetActive('filter.drive', {}), false)
  assert.equal(filterTargetActive('volume', analog), true)
})

test('plan filters: Analog notch rejected, invalid values dropped', () => {
  assert.match(validatePlanFilter({ model: ANALOG_MODEL, type: 'notch' }).error, /notch/)
  assert.deepEqual(validatePlanFilter({ model: ANALOG_MODEL, type: 'lowpass', frequency: 1e9, resonance: 3, drive: NaN, slope: 12 }).filter,
    { model: ANALOG_MODEL, type: 'lowpass', frequency: 20000, resonance: 1.8, slope: 12 })
  assert.equal(validatePlanFilter({ type: 'notch' }).filter.type, 'notch')
  assert.deepEqual(validatePlanFilter({}), { filter: null, error: null })
})
