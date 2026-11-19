import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eqResponse, eqHasGain, eqHasQ, eqTypeLabel } from '../lib/touchEq.js'

test('response combines 24 dB sections and excludes bypassed and unused bands', () => {
  const calls = []
  const runtime = {
    audioCtx: { sampleRate: 48000 },
    spec: [{ type: 'peaking24' }, { type: 'lowpass12', bypass: true }, { type: 'noop' }, { type: 'lowshelf12' }],
    getFrequencyResponse(band, section, frequencies, magnitude) {
      calls.push([band, section])
      if (band === 1) return false
      magnitude.fill(band === 0 ? 2 : .5)
      return true
    },
  }
  const result = eqResponse(runtime, 3)
  assert.deepEqual(calls, [[0, 0], [0, 1], [1, 0], [3, 0]])
  assert.equal(result.frequencies[0], 10)
  assert.equal(result.frequencies[2], 24000)
  assert.ok(Math.abs(result.frequencies[1] - Math.sqrt(10 * 24000)) < .001)
  assert.ok(result.db.every(v => Math.abs(v - 20 * Math.log10(2)) < .00001))
})

test('a flat or fully bypassed response is finite and unity; deep cuts stay finite', () => {
  const runtime = { audioCtx: { sampleRate: 44100 }, spec: [{ type: 'notch24' }], getFrequencyResponse() { return false } }
  assert.ok(eqResponse(runtime).db.every(v => v === 0))
  runtime.getFrequencyResponse = (i, s, f, magnitude) => { magnitude.fill(0); return true }
  assert.ok(eqResponse(runtime).db.every(v => Number.isFinite(v) && v < -100))
})

test('filter controls follow the runtime topology', () => {
  for (const suffix of ['12', '24']) {
    for (const type of ['lowpass', 'highpass', 'bandpass', 'notch']) assert.equal(eqHasGain(type + suffix), false)
    for (const type of ['lowshelf', 'highshelf', 'peaking']) assert.equal(eqHasGain(type + suffix), true)
    assert.equal(eqHasQ('lowshelf' + suffix), false)
    assert.equal(eqHasQ('highshelf' + suffix), false)
    assert.equal(eqHasQ('peaking' + suffix), true)
  }
  assert.equal(eqHasGain('noop'), false)
  assert.equal(eqHasQ('noop'), false)
  assert.equal(eqTypeLabel('noop'), 'Unused')
  assert.equal(eqTypeLabel('peaking24'), 'Bell 24 dB')
})
