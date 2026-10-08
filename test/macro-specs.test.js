import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_MACRO_ENGINE, MACRO_AUTOMATION_TARGETS, MACRO_DEFAULTS, MACRO_ENGINES, MACRO_PARAMS,
  MACRO_SELF_ENVELOPED, macroEngineIndex, macroPatch, macroTransposeSemitones, normalizeMacroParams, usesMacro,
} from '../lib/macroSpecs.js'

// The vocabulary must agree with the vendored DSP: engine indices are upstream's
// registration order in plaits/dsp/voice.cc.

const voiceCc = readFileSync(new URL('../vendor/plaits/src/plaits/dsp/voice.cc', import.meta.url), 'utf8')
const registrations = [...voiceCc.matchAll(/RegisterInstance\(&(\w+), (true|false)/g)]
  .map(([, member, enveloped]) => ({ member, enveloped: enveloped === 'true' }))

const MEMBER = {
  vaFilter: 'virtual_analog_vcf_engine_', phaseDist: 'phase_distortion_engine_',
  sixOpA: 'six_op_engine_', sixOpB: 'six_op_engine_', sixOpC: 'six_op_engine_',
  waveTerrain: 'wave_terrain_engine_', stringMachine: 'string_machine_engine_', chiptune: 'chiptune_engine_',
  va: 'virtual_analog_engine_', waveshaping: 'waveshaping_engine_', fm: 'fm_engine_', formant: 'grain_engine_',
  additive: 'additive_engine_', wavetable: 'wavetable_engine_', chords: 'chord_engine_', speech: 'speech_engine_',
  swarm: 'swarm_engine_', noise: 'noise_engine_', particle: 'particle_engine_', string: 'string_engine_',
  modal: 'modal_engine_', bassDrum: 'bass_drum_engine_', snare: 'snare_drum_engine_', hiHat: 'hi_hat_engine_',
}

test('engines follow upstream registration order, eight per bank', () => {
  assert.equal(registrations.length, 24)
  assert.equal(MACRO_ENGINES.length, 24)
  MACRO_ENGINES.forEach((e, i) => {
    assert.equal(e.index, i)
    assert.equal(registrations[i].member, MEMBER[e.id], e.id)
    assert.equal(e.bank, Math.floor(i / 8) + 1, e.id)
    for (const k of ['label', 'hint', 'harmonics', 'timbre', 'morph', 'aux']) assert.ok(e[k], `${e.id}.${k}`)
  })
  assert.equal(new Set(MACRO_ENGINES.map(e => e.id)).size, 24)
  assert.equal(macroEngineIndex(DEFAULT_MACRO_ENGINE), 8)
  assert.equal(macroEngineIndex('nope'), 8)
})

test('self-enveloped engines are upstream\'s, plus chiptune when triggered', () => {
  const upstream = MACRO_ENGINES.filter((e, i) => registrations[i].enveloped).map(e => e.id)
  // Chiptune declares already_enveloped at render time whenever TRIG is patched,
  // which a lane always is.
  assert.deepEqual([...MACRO_SELF_ENVELOPED].sort(), [...upstream, 'chiptune'].sort())
})

test('normalize fills defaults, clamps ranges and drops unknown keys', () => {
  assert.deepEqual(normalizeMacroParams(undefined), MACRO_DEFAULTS)
  const n = normalizeMacroParams({
    macroEngine: 'bogus', macroHarmonics: 3, macroFmAmt: -4, macroTimbreAmt: '0.25',
    macroDecay: NaN, macroVoices: 9, attack: 0.3,
  })
  assert.equal(n.macroEngine, DEFAULT_MACRO_ENGINE)
  assert.equal(n.macroHarmonics, 1)
  assert.equal(n.macroFmAmt, -1)
  assert.equal(n.macroTimbreAmt, 0.25)
  assert.equal(n.macroDecay, MACRO_DEFAULTS.macroDecay)
  assert.equal(n.macroVoices, 2)
  assert.ok(!('attack' in n))
  for (const p of MACRO_PARAMS) assert.ok(p.default >= p.min && p.default <= p.max, p.key)
})

test('FREQUENCY steps in semitones across the module\'s 14-semitone range', () => {
  assert.equal(macroTransposeSemitones(0), -7)
  assert.equal(macroTransposeSemitones(0.5), 0)
  assert.equal(macroTransposeSemitones(1), 7)
  assert.equal(macroTransposeSemitones(0.52), 0)
  assert.equal(macroTransposeSemitones(0.75), 4)
  assert.ok(!Object.is(macroTransposeSemitones(0.49), -0))
  const p = macroPatch({ macroFrequency: 1, macroFmAmt: -0.5 })
  assert.equal(p.transpose, 7)
  assert.equal(p.fmAmount, -0.5)
  for (const v of Object.values(p)) assert.ok(Number.isFinite(v))
})

test('automation covers every continuous control except the stepped Frequency', () => {
  const ids = MACRO_AUTOMATION_TARGETS.map(t => t.id)
  assert.ok(!ids.includes('synth.macroFrequency'))
  assert.equal(ids.length, MACRO_PARAMS.length - 1)
  for (const t of MACRO_AUTOMATION_TARGETS) {
    assert.ok(t.id.startsWith('synth.macro'))
    assert.ok(t.min < t.max)
  }
  assert.deepEqual(MACRO_AUTOMATION_TARGETS.find(t => t.id === 'synth.macroFmAmt'), { id: 'synth.macroFmAmt', label: 'FM amt', group: 'Macro', min: -1, max: 1 })
})

test('usesMacro reads synth-type maps and lists', () => {
  assert.equal(usesMacro({ a: 'Synth', b: 'Macro' }), true)
  assert.equal(usesMacro(['Synth']), false)
  assert.equal(usesMacro(null), false)
})
