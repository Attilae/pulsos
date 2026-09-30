import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOUDS_DSP_RATE, CLOUDS_MAX_GRAINS, CLOUDS_MAX_GRAIN_SAMPLES, CLOUDS_MIN_GRAIN_SAMPLES,
  DEFAULT_GRANULAR_ENGINE, GRANULAR_ENGINES, cloudsDensity, cloudsGrainSamples,
  cloudsParamsFromGranular, normalizeGranularEngine,
} from '../lib/granularEngine.js'
import { DEFAULT_GRANULAR } from '../lib/soundSpecs.js'

test('engine switch defaults to the original GrainPlayer layer', () => {
  assert.equal(DEFAULT_GRANULAR_ENGINE, 'grainplayer')
  assert.deepEqual(GRANULAR_ENGINES, ['grainplayer', 'clouds'])
  for (const v of [undefined, null, '', 'nope', 42]) assert.equal(normalizeGranularEngine(v), 'grainplayer')
  assert.equal(normalizeGranularEngine('clouds'), 'clouds')
  assert.equal(normalizeGranularEngine(' Clouds '), 'clouds')
  assert.equal(normalizeGranularEngine('GRAINPLAYER'), 'grainplayer')
})

test('grain size converts seconds to 32 kHz samples, clamped to the DSP range', () => {
  assert.equal(cloudsGrainSamples(0.09), Math.round(0.09 * CLOUDS_DSP_RATE))
  assert.equal(cloudsGrainSamples(0.01), 320)      // below the hardware knob's 32 ms floor, kept
  assert.equal(cloudsGrainSamples(0.5), 16000)     // the UI's top value fits
  assert.equal(cloudsGrainSamples(2), CLOUDS_MAX_GRAIN_SAMPLES)
  assert.equal(cloudsGrainSamples(0), CLOUDS_MIN_GRAIN_SAMPLES)
  assert.equal(cloudsGrainSamples(NaN), cloudsGrainSamples(0.09))
})

test('density follows overlap / grainSize and stays within the grain pool', () => {
  assert.ok(Math.abs(cloudsDensity(0.09, 0.05) - 2 * (1 + 0.05 / 0.09)) < 1e-9)
  assert.ok(cloudsDensity(0.09, 0.3) > cloudsDensity(0.09, 0.05))
  assert.ok(cloudsDensity(0.02, 0.05) > cloudsDensity(0.3, 0.05))
  assert.equal(cloudsDensity(0.01, 0.5), CLOUDS_MAX_GRAINS)
  assert.equal(cloudsDensity(0.5, 0), 2)
})

test('the full default granular config maps to a sane DSP block', () => {
  const p = cloudsParamsFromGranular(DEFAULT_GRANULAR)
  assert.equal(p.size, 2880)
  assert.equal(p.scanRate, 1)
  assert.equal(p.winStart, 0)
  assert.equal(p.winEnd, 1)
  assert.equal(p.jitter, 0)
  assert.equal(p.reverse, false)
  for (const v of Object.values(p)) assert.ok(typeof v === 'boolean' || Number.isFinite(v))
})

test('window is ordered, rate/jitter clamp, reverse passes through', () => {
  const p = cloudsParamsFromGranular({ loopStart: 0.8, loopEnd: 0.2, playbackRate: 99, jitter: -1, reverse: 1 })
  assert.equal(p.winStart, 0.2)
  assert.equal(p.winEnd, 0.8)
  assert.equal(p.scanRate, 16)
  assert.equal(p.jitter, 0)
  assert.equal(p.reverse, true)
})
