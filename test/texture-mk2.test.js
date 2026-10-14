import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_TEXTURE_MODEL, TEXTURE_DEFAULTS, TEXTURE_MK2_DEFAULTS, TEXTURE_MK2_ENABLED, TEXTURE_MK2_KNOBS,
  TEXTURE_MK2_MAKEUP_DB, TEXTURE_MK2_MIX_KNOBS, TEXTURE_MK2_PARAM_TARGETS, TEXTURE_MK2_QUALITIES,
  TEXTURE_MK2_RAND_KNOBS, TEXTURE_MK2_SEED_MODES, TEXTURE_MODELS, TEXTURE_PARAM_TARGETS, beadsDspParams,
  textureDspParams, textureMk2DensityText, textureMk2PitchSemitones, textureMk2RandAmount, textureModelOf,
  textureParamTargets, textureTargetActive,
} from '../lib/granularEngine.js'
import { DEFAULT_GRANULAR } from '../lib/soundSpecs.js'
import { testInput } from '../scripts/lib/beadsScenarios.js'

// Texture Mk II's vocabulary (lib/granularEngine.js): keys, laws, defaults,
// automation rules, and what its defaults sound like through the real host.

const ALL_KNOBS = [...TEXTURE_MK2_KNOBS, ...TEXTURE_MK2_RAND_KNOBS, ...TEXTURE_MK2_MIX_KNOBS]

test('Classic stays the default model, and Mk II is off unless its flag is set', () => {
  assert.deepEqual(TEXTURE_MODELS, ['classic', 'mk2'])
  assert.equal(DEFAULT_TEXTURE_MODEL, 'classic')
  for (const cfg of [undefined, null, {}, { txModel: 'nope' }, { txModel: 'classic' }]) assert.equal(textureModelOf(cfg), 'classic')
  assert.equal(textureModelOf({ txModel: 'mk2' }), 'mk2')
  assert.equal(TEXTURE_MK2_ENABLED, false)      // tests run without NEXT_PUBLIC_* flags
})

test('Mk II keys never collide with Classic\'s or the GrainPlayer layer\'s', () => {
  for (const k of Object.keys(TEXTURE_MK2_DEFAULTS)) {
    assert.ok(k.startsWith('tx2'), k)
    assert.ok(!(k in TEXTURE_DEFAULTS) && !(k in DEFAULT_GRANULAR), k)
  }
})

test('every Mk II control has a 0..1 default, a label, a hint and a readout', () => {
  for (const k of ALL_KNOBS) {
    assert.ok(k.default >= 0 && k.default <= 1, k.key)
    assert.ok(k.label && k.hint, k.key)
    for (const v of [0, 0.25, 0.5, 0.75, 1]) assert.equal(typeof k.format(v), 'string', k.key)
  }
  for (const list of [TEXTURE_MK2_QUALITIES, TEXTURE_MK2_SEED_MODES]) for (const o of list) assert.ok(o.id && o.label && o.hint)
  assert.equal(TEXTURE_MK2_DEFAULTS.tx2Quality, 'hifi')
  assert.equal(TEXTURE_MK2_DEFAULTS.tx2SeedMode, 'gates')
})

test('PITCH follows the module\'s detent law', () => {
  // Same law as dsp/beads/bridge.cc (DetuneLaw); test/beads-dsp.test.js checks
  // the DSP at these positions.
  for (const [knob, st] of [[0, -24], [0.075, -12], [0.5, 0], [0.8417, 7], [0.925, 12], [1, 24]]) {
    assert.equal(textureMk2PitchSemitones(knob), st, `knob ${knob}`)
  }
  // Detents: a little either side of a step still reads the step.
  assert.equal(textureMk2PitchSemitones(0.5 + 1 / 12 + 0.01), 1)
})

test('the randomization knobs: a dead zone at centre, drift right, per-grain left', () => {
  assert.equal(textureMk2RandAmount(0.5), 0)
  assert.equal(textureMk2RandAmount(0.52), 0)
  assert.ok(Math.abs(textureMk2RandAmount(1) - 1) < 1e-9)
  assert.ok(Math.abs(textureMk2RandAmount(0) + 1) < 1e-9)
  const r = TEXTURE_MK2_RAND_KNOBS[0]
  assert.equal(r.format(0.5), 'off')
  assert.match(r.format(0.9), /^drift /)
  assert.match(r.format(0.1), /^grain /)
})

test('DENSITY reads per seed mode', () => {
  assert.equal(textureMk2DensityText(0.5, 'gates'), 'each note')
  assert.equal(textureMk2DensityText(0.5, 'free'), 'off')
  assert.equal(textureMk2DensityText(0, 'clock'), '÷1')
  assert.equal(textureMk2DensityText(0.47, 'clock'), '÷16')
  assert.equal(textureMk2DensityText(1, 'clock'), '100%')
  assert.match(textureMk2DensityText(0.8, 'gates'), /^rnd /)
  assert.match(textureMk2DensityText(0.2, 'free'), /^reg /)
  // Delay mode (SIZE at full): free, the delay length (test/beads-dsp.test.js
  // measures 0.33 s at 0.7 in Hi-fi); with notes, a fraction of the note clock.
  assert.equal(textureMk2DensityText(0.5, 'free', { delay: true }), '4.00s')
  assert.equal(textureMk2DensityText(0.7, 'free', { delay: true }), '330ms')
  assert.equal(textureMk2DensityText(0.5, 'free', { delay: true, quality: 'dirtyTape' }), '16.00s')
  assert.equal(textureMk2DensityText(0.45, 'clock', { delay: true }), '1 note')
  assert.equal(textureMk2DensityText(0, 'gates', { delay: true }), '1/16 note')
  assert.equal(textureMk2DensityText(0.66, 'clock', { delay: true }), '1/3 note')
})

test('beadsDspParams: defaults, clamping, unknown ids and the in-gain law', () => {
  const p = beadsDspParams({})
  assert.equal(p.quality, 'hifi')
  assert.equal(p.seedMode, 'gates')
  assert.equal(p.pitch, 0.5)
  assert.equal(p.timeAmt, 0.5)
  assert.ok(Math.abs(p.inGain - 1) < 1e-9)
  assert.equal(p.freeze, false)
  const q = beadsDspParams({ tx2Time: 3, tx2Size: -1, tx2Pitch: NaN, tx2Quality: 'cassette', tx2SeedMode: 'x', tx2Freeze: 1 })
  assert.equal(q.time, 1)
  assert.equal(q.size, 0)
  assert.equal(q.pitch, 0.5)
  assert.equal(q.quality, 'hifi')
  assert.equal(q.seedMode, 'gates')
  assert.equal(q.freeze, true)
  assert.equal(beadsDspParams({ tx2Quality: 'dirtyTape', tx2SeedMode: 'free' }).quality, 'dirtyTape')
  // Classic's keys don't reach Mk II and vice versa.
  assert.deepEqual(beadsDspParams({ txPosition: 0.9 }), p)
  assert.deepEqual(textureDspParams({ tx2Time: 0.9 }), textureDspParams({}))
})

test('automation: every continuous Mk II control, never quality, seed mode or freeze', () => {
  const ids = TEXTURE_MK2_PARAM_TARGETS.map(t => t.id)
  assert.equal(ids.length, ALL_KNOBS.length)
  assert.ok(ids.every(id => id.startsWith('grain.tx2')))
  for (const k of ['tx2Quality', 'tx2SeedMode', 'tx2Freeze']) assert.ok(!ids.includes(`grain.${k}`))
  assert.ok(TEXTURE_MK2_PARAM_TARGETS.every(t => t.min === 0 && t.max === 1 && t.textureModel === 'mk2'))
})

test('a lane lists its own model\'s targets first; the other model\'s stay valid but inactive', () => {
  // Flag off (as in tests): a Classic lane offers only Classic, as before.
  assert.deepEqual(textureParamTargets({}), TEXTURE_PARAM_TARGETS)
  const mk2 = textureParamTargets({ txModel: 'mk2' })
  assert.equal(mk2[0].id, 'grain.tx2Time')
  assert.ok(mk2.some(t => t.id === 'grain.txPosition'))
  assert.equal(textureTargetActive('grain.tx2Time', { txModel: 'mk2' }), true)
  assert.equal(textureTargetActive('grain.txPosition', { txModel: 'mk2' }), false)
  assert.equal(textureTargetActive('grain.tx2Time', {}), false)
  assert.equal(textureTargetActive('grain.txPosition', {}), true)
  assert.equal(textureTargetActive('volume', { txModel: 'mk2' }), true)
  assert.equal(textureTargetActive('grain.mix', { txModel: 'mk2' }), true)   // GrainPlayer's, not Texture's
})

test('Mk II\'s defaults through the real host land within 1 dB of Classic\'s, after make-up', () => {
  const load = (f, cls) => new Function(`${readFileSync(new URL(`../public/worklets/${f}`, import.meta.url), 'utf8')}\nreturn ${cls}`)()
  const wasm = (m) => new WebAssembly.Module(readFileSync(new URL(`../public/wasm/${JSON.parse(readFileSync(new URL(`../public/wasm/${m}`, import.meta.url))).asset}`, import.meta.url)))
  const TextureHost = load('clouds-granular-processor.js', 'TextureHost')
  const BeadsHost = load('beads-processor.js', 'BeadsHost')
  const sr = 48000
  const input = testInput(sr, 8)                    // a lane note every 0.5 s
  const run = (host, onNote) => {
    const out = new Float32Array(input.length)
    let next = 0
    for (let off = 0; off < input.length; off += 128) {
      while (next * 0.5 * sr < off + 128 + 4800) { onNote(next * 0.5, off); next++ }
      const n = Math.min(128, input.length - off)
      const buf = input.subarray(off, off + n)
      host.process(buf, buf, out.subarray(off, off + n), null, n, off)
    }
    let s = 0
    for (let i = 2 * sr; i < out.length; i++) s += out[i] * out[i]
    return Math.sqrt(s / (out.length - 2 * sr))
  }
  const classic = new TextureHost(new WebAssembly.Instance(wasm('clouds-granular.manifest.json'), {}).exports, sr,
    { seed: 4, params: textureDspParams(TEXTURE_DEFAULTS) })
  const mk2 = new BeadsHost(new WebAssembly.Instance(wasm('beads.manifest.json'), {}).exports, sr,
    { seed: 4, params: beadsDspParams(TEXTURE_MK2_DEFAULTS) })
  const a = run(classic, (t, off) => classic.trig({ time: t, gen: 0 }, off))
  const b = run(mk2, (t) => mk2.note({ time: t, dur: 0.25, gen: 0 })) * 10 ** (TEXTURE_MK2_MAKEUP_DB / 20)
  const db = 20 * Math.log10(b / a)
  assert.ok(Math.abs(db) < 1, `Mk II is ${db.toFixed(2)} dB from Classic`)
})
