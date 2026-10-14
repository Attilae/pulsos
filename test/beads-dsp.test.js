import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  BEADS_SCENARIOS, MAX_BLOCK, NEUTRAL, QUALITY, QUALITY_RATE, applyParams, renderScenarioWasm, testInput,
} from '../scripts/lib/beadsScenarios.js'

// Runs the committed Texture Mk II (Beads) wasm directly: no worklet, no Tone.
// Native-vs-wasm lives in scripts/beads_compare.js (needs a host compiler);
// these are properties the shipped artifact must have everywhere.

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/beads.manifest.json', import.meta.url), 'utf8'))
const bytes = readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url))
const module = new WebAssembly.Module(bytes)

const KEYS = ['time', 'size', 'shape', 'pitch', 'timeAmt', 'sizeAmt', 'shapeAmt', 'pitchAmt',
  'density', 'feedback', 'dryWet', 'reverb', 'inGain', 'freeze']
const P = (over = {}) => KEYS.map((k, i) => (k in over ? over[k] : NEUTRAL[i]))
const SEED = { gates: [0, 1], clock: [2, 1], free: [2, 0] }

// Render `input` (mono, at the quality's rate) for `seconds`. `gates`:
// [[block, offset, high]]. Returns the left channel.
function render({ quality = QUALITY.hifi, seed = SEED.free, params = P(), input = null, seconds = 2, gates = [], seedValue = 1 }) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.bd_init(seedValue)
  x.bd_set_quality(quality)
  x.bd_set_seed(...seed)
  applyParams(x, params)
  const mem = x.memory.buffer
  const inL = new Float32Array(mem, x.bd_in_l(), MAX_BLOCK)
  const inR = new Float32Array(mem, x.bd_in_r(), MAX_BLOCK)
  const outL = new Float32Array(mem, x.bd_out_l(), MAX_BLOCK)
  const n = x.bd_block_size()
  const blocks = Math.round(seconds * 4000)
  const out = new Float32Array(blocks * n)
  const byBlock = new Map()
  for (const g of gates) byBlock.set(g[0], [...(byBlock.get(g[0]) ?? []), g])
  for (let b = 0, k = 0; b < blocks; b++) {
    for (const [, off, high] of byBlock.get(b) ?? []) x.bd_gate(off, high)
    for (let i = 0; i < n; i++, k++) inL[i] = inR[i] = input && k < input.length ? input[k] : 0
    x.bd_render()
    out.set(outL.subarray(0, n), b * n)
  }
  return { out, x, rate: x.bd_sample_rate() }
}

const rms = (a, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / Math.max(1, to - from))
}
const sine = (hz, rate, seconds, amp = 0.3) => {
  const s = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < s.length; i++) s[i] = amp * Math.sin(2 * Math.PI * hz * i / rate)
  return s
}
const click = (rate, at, seconds) => {
  const s = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < 48; i++) s[Math.round(at * rate) + i] = 0.8
  return s
}
const notes = (period, count, holdBlocks = 40) => {
  const g = []
  for (let i = 0; i < count; i++) {
    const b = Math.round(i * period * 4000)
    g.push([b, 0, 1], [b + holdBlocks, 0, 0])
  }
  return g
}

test('the committed artifact matches its manifest and has no imports', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  assert.equal(bytes.length, manifest.bytes)
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  const exports = WebAssembly.Module.exports(module).map(e => e.name)
  for (const name of ['bd_init', 'bd_set_params', 'bd_set_seed', 'bd_set_quality', 'bd_gate', 'bd_render', 'bd_reset']) {
    assert.ok(exports.includes(name), name)
  }
})

test('every scenario is finite, bounded, fault-free and reproducible', () => {
  for (const sc of BEADS_SCENARIOS) {
    const input = testInput(QUALITY_RATE[sc.quality])
    const a = renderScenarioWasm(module, sc, input)
    const b = renderScenarioWasm(module, sc, input)
    assert.equal(a.exports.bd_fault_count(), 0, sc.name)
    let peak = 0
    for (let i = 0; i < a.out.length; i++) {
      const v = a.out[i]
      assert.ok(Number.isFinite(v), `${sc.name}: sample ${i}`)
      peak = Math.max(peak, Math.abs(v))
      if (v !== b.out[i]) assert.fail(`${sc.name}: not reproducible at sample ${i}`)
    }
    assert.ok(peak > 0.01 && peak <= 1, `${sc.name}: peak ${peak}`)
  }
})

test('the RNG seed changes the grains, not the dry path', () => {
  const input = testInput(48000, 2)
  const a = render({ input, seedValue: 1 }).out
  const b = render({ input, seedValue: 2 }).out
  assert.ok(a.some((v, i) => v !== b[i]))
  const dry = P({ dryWet: 0 })
  const c = render({ input, params: dry, seedValue: 1 }).out
  const d = render({ input, params: dry, seedValue: 2 }).out
  assert.deepEqual(c, d)
})

test('each quality runs at its own rate in 4 kHz blocks', () => {
  const expect = { dirtyTape: [24000, 6], cleanTape: [48000, 12], vintage: [32000, 8], hifi: [48000, 12] }
  const x = new WebAssembly.Instance(module, {}).exports
  x.bd_init(1)
  assert.equal(x.bd_quality(), QUALITY.hifi)
  assert.equal(x.bd_max_block_size(), MAX_BLOCK)
  for (const [id, [rate, block]] of Object.entries(expect)) {
    x.bd_set_quality(QUALITY[id])
    assert.equal(x.bd_sample_rate(), rate, id)
    assert.equal(x.bd_block_size(), block, id)
  }
})

test('fully dry is 0.75 × the input (upstream\'s dry law), degraded only in the lo-fi qualities', () => {
  for (const [id, tol] of [['hifi', 0.002], ['cleanTape', 0.002], ['vintage', 0.01], ['dirtyTape', 0.05]]) {
    const rate = QUALITY_RATE[QUALITY[id]]
    const input = sine(330, rate, 1)
    const { out } = render({ quality: QUALITY[id], params: P({ dryWet: 0 }), input, seconds: 1 })
    const ratio = rms(out, rate / 4, rate) / rms(input, rate / 4, rate)
    assert.ok(Math.abs(ratio - 0.75) < tol, `${id}: dry ratio ${ratio}`)
  }
})

test('PITCH transposes grains by its detent intervals', () => {
  const rate = 48000
  const input = sine(220, rate, 3, 0.4)
  // DETUNE law (cv_reader.h): knob 0.5 ± k/12 lands on the k-th detent.
  for (const [knob, semis] of [[0.5, 0], [0.925, 12], [0.075, -12], [0.8417, 7]]) {
    const { out } = render({
      params: P({ time: 0, size: 0.8, shape: 0.5, pitch: knob, density: 1, dryWet: 1, timeAmt: 0.5, pitchAmt: 0.5 }),
      input, seconds: 3,
    })
    let zc = 0
    const from = rate, to = 3 * rate
    for (let i = from + 1; i < to; i++) if (out[i - 1] < 0 && out[i] >= 0) zc++
    const hz = zc / ((to - from) / rate)
    const cents = 1200 * Math.log2(hz / (220 * 2 ** (semis / 12)))
    assert.ok(Math.abs(cents) < 15, `knob ${knob}: ${hz.toFixed(1)} Hz is ${cents.toFixed(1)} cents from ${semis} st`)
  }
})

test('note gates: no grains without notes, and a grain about 2.5 ms after each note', () => {
  const rate = 48000
  const input = testInput(rate, 2)
  const wet = P({ time: 0.02, density: 0.5, dryWet: 1 })
  const silent = render({ seed: SEED.gates, params: wet, input, seconds: 2 }).out
  assert.ok(rms(silent, rate / 2) === 0, 'grains without notes')
  // Gate rises at block 4000 (1.000 s); the firmware delays SEED by 10 blocks.
  const { out } = render({ seed: SEED.gates, params: wet, input, seconds: 2, gates: [[4000, 0, 1], [4400, 0, 0]] })
  const onset = out.findIndex((v, i) => i >= rate && Math.abs(v) > 1e-3)
  const ms = (onset / rate - 1) * 1000
  assert.ok(ms >= 2.5 && ms < 4, `grain ${ms.toFixed(2)} ms after the gate`)
})

test('free delay: DENSITY sets the delay length, at 0.77× and 1× taps', () => {
  const rate = 48000
  // Delay mode engages 1.5 s after SIZE reaches full; the click comes at 2 s.
  const { out } = render({ params: P({ time: 0, size: 1, shape: 0.5, density: 0.7, feedback: 0, dryWet: 1 }), input: click(rate, 2, 3), seconds: 3 })
  const interval = 192000 * 2 ** (-0.2 * 216 / 12) / rate      // delay_controller.cc, max delay 4 s
  const peaks = []
  let last = -1e9
  for (let i = 2 * rate + 480; i < out.length; i++) {
    if (Math.abs(out[i]) > 0.02 && i - last > 480) { peaks.push(i / rate - 2); last = i }
  }
  assert.ok(peaks.length >= 2, `taps: ${peaks}`)
  assert.ok(Math.abs(peaks[0] - 0.77 * interval) < 0.02, `first tap ${peaks[0]} vs ${0.77 * interval}`)
  assert.ok(Math.abs(peaks[1] - interval) < 0.02, `second tap ${peaks[1]} vs ${interval}`)
})

test('note clock in delay mode: the repeats follow the lanes\' note period', () => {
  const rate = 48000
  for (const period of [0.3, 0.4, 0.6]) {
    const { out } = render({
      seed: SEED.clock, params: P({ time: 0, size: 1, shape: 0.3, density: 0.45, feedback: 0.5, dryWet: 1 }),
      input: click(rate, 2, 7), seconds: 7, gates: notes(period, Math.ceil(7 / period)),
    })
    // Peak envelope in 5 ms cells from 0.3 s after the click, then its strongest
    // autocorrelation lag.
    const cell = 240, env = []
    for (let s = Math.round(2.3 * rate); s + cell < out.length; s += cell) {
      let mx = 0
      for (let i = s; i < s + cell; i++) mx = Math.max(mx, Math.abs(out[i]))
      env.push(mx)
    }
    let best = 0, bestLag = 0
    for (let lag = 20; lag < 200; lag++) {
      let acc = 0
      for (let i = 0; i + lag < env.length; i++) acc += env[i] * env[i + lag]
      acc /= env.length - lag
      if (acc > best) { best = acc; bestLag = lag }
    }
    const got = bestLag * cell / rate
    assert.ok(Math.abs(got - period) < 0.011, `clock ${period} s: repeats every ${got} s`)
  }
})

test('non-finite input and extreme parameters never produce non-finite output', () => {
  const input = new Float32Array(48000)
  for (let i = 0; i < input.length; i++) input[i] = i % 97 === 0 ? NaN : (i % 89 === 0 ? Infinity : Math.sin(i / 7))
  for (const params of [P({ inGain: 4, feedback: 1, reverb: 1, dryWet: 1, density: 1 }), [NaN, -1, 2, Infinity, NaN, 9, -9, NaN, NaN, 5, NaN, -3, NaN, 1]]) {
    for (let q = 0; q < 4; q++) {
      const { out, x } = render({ quality: q, params, input, seconds: 1 })
      assert.ok(out.every(Number.isFinite), `quality ${q}`)
      assert.ok(out.every(v => v >= -1 && v < 1), `quality ${q}: clamp`)
      assert.equal(x.bd_fault_count(), 0, `quality ${q}`)
    }
  }
})
