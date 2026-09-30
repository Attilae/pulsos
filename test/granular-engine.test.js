import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GRANULAR_ENGINE, GRANULAR_ENGINES, TEXTURE_BLEND_PARAMS, TEXTURE_DEFAULTS, TEXTURE_KNOBS,
  TEXTURE_PARAM_TARGETS, normalizeGranularEngine, textureDspParams, textureInGainDb, texturePitchSemitones,
} from '../lib/granularEngine.js'
import { DEFAULT_GRANULAR } from '../lib/soundSpecs.js'
import { TEXTURE_PITCH_TABLE } from '../lib/texturePitchTable.js'
import { readFileSync } from 'node:fs'

test('engine switch defaults to the original GrainPlayer layer', () => {
  assert.equal(DEFAULT_GRANULAR_ENGINE, 'grainplayer')
  assert.deepEqual(GRANULAR_ENGINES, ['grainplayer', 'clouds'])
  for (const v of [undefined, null, '', 'nope', 42]) assert.equal(normalizeGranularEngine(v), 'grainplayer')
  assert.equal(normalizeGranularEngine('clouds'), 'clouds')
  assert.equal(normalizeGranularEngine(' Clouds '), 'clouds')
  assert.equal(normalizeGranularEngine('GRAINPLAYER'), 'grainplayer')
})

test('Texture keys never collide with the GrainPlayer layer’s', () => {
  for (const k of Object.keys(TEXTURE_DEFAULTS)) {
    assert.ok(k.startsWith('tx'), k)
    assert.ok(!(k in DEFAULT_GRANULAR), k)
  }
})

test('every control has a 0..1 default, a label and a readout', () => {
  for (const k of [...TEXTURE_KNOBS, ...TEXTURE_BLEND_PARAMS]) {
    assert.ok(k.default >= 0 && k.default <= 1, k.key)
    assert.ok(k.label && k.hint, k.key)
  }
  for (const k of TEXTURE_KNOBS) {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) assert.equal(typeof k.format(v), 'string')
  }
})

test('automation targets cover every continuous control, not Freeze', () => {
  const ids = TEXTURE_PARAM_TARGETS.map(t => t.id)
  assert.equal(ids.length, TEXTURE_KNOBS.length + TEXTURE_BLEND_PARAMS.length)
  assert.ok(ids.every(id => id.startsWith('grain.tx')))
  assert.ok(!ids.includes('grain.txFreeze'))
  for (const t of TEXTURE_PARAM_TARGETS) { assert.equal(t.min, 0); assert.equal(t.max, 1) }
})

test('pitch readout follows upstream’s knob curve; in gain spans -18..+6 dB', () => {
  assert.equal(texturePitchSemitones(0), -24)
  assert.equal(texturePitchSemitones(0.45), 0)       // the dead zone at centre
  assert.equal(texturePitchSemitones(0.5), 0)
  assert.equal(texturePitchSemitones(0.8), 4)
  assert.equal(texturePitchSemitones(0.2), -4)
  assert.equal(texturePitchSemitones(1), 24)
  assert.equal(textureInGainDb(0), -18)
  assert.equal(textureInGainDb(0.75), 0)
  assert.equal(textureInGainDb(1), 6)
})

test('defaults map to the DSP block the bridge expects', () => {
  const p = textureDspParams({})
  assert.equal(p.position, TEXTURE_DEFAULTS.txPosition)
  assert.equal(p.pitch, 0.5)
  assert.ok(Math.abs(p.inGain - 1) < 1e-9)
  assert.equal(p.freeze, false)
  for (const [k, v] of Object.entries(p)) assert.ok(typeof v === 'boolean' || Number.isFinite(v), k)
})

test('dry/wet uses the module’s CV-scaler trim so both ends are reachable', () => {
  assert.equal(textureDspParams({ txBlend: 0 }).dryWet, 0)
  assert.equal(textureDspParams({ txBlend: 1 }).dryWet, 1)
  assert.ok(Math.abs(textureDspParams({ txBlend: 0.5 }).dryWet - 0.5) < 1e-9)
})

test('out-of-range and non-numeric values are clamped or defaulted', () => {
  const p = textureDspParams({ txPosition: 3, txSize: -1, txPitch: NaN, txFreeze: 1 })
  assert.equal(p.position, 1)
  assert.equal(p.size, 0)
  assert.equal(p.pitch, 0.5)
  assert.equal(p.freeze, true)
})

test('the generated pitch table matches the vendored lut_quantized_pitch', () => {
  const src = readFileSync(new URL('../vendor/clouds/src/clouds/resources.cc', import.meta.url), 'utf8')
  const i = src.indexOf('const float lut_quantized_pitch[]')
  const lut = src.slice(src.indexOf('{', i) + 1, src.indexOf('};', i)).split(',').map(Number).filter(n => !Number.isNaN(n))
  assert.equal(TEXTURE_PITCH_TABLE.length, 257)
  TEXTURE_PITCH_TABLE.forEach((v, k) => assert.ok(Math.abs(v - lut[k * 4]) < 0.006, `point ${k}`))
})
