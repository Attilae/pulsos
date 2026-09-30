import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { BLOCK, CLOUDS_SCENARIOS, DSP_RATE, NEUTRAL, renderScenarioWasm, testInput } from '../scripts/lib/cloudsScenarios.js'

// Runs the committed Texture (Clouds granular) wasm directly: no worklet, no
// Tone. Native-vs-wasm lives in scripts/clouds_compare.js (needs a host
// compiler); these are properties the shipped artifact must have everywhere.

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/clouds-granular.manifest.json', import.meta.url), 'utf8'))
const bytes = readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url))
const module = new WebAssembly.Module(bytes)

// params: [position, size, pitchKnob, density, texture, dryWet, spread, feedback, reverb, inGain, freeze]
const P = (over = {}) => {
  const keys = ['position', 'size', 'pitch', 'density', 'texture', 'dryWet', 'spread', 'feedback', 'reverb', 'inGain', 'freeze']
  return keys.map((k, i) => (k in over ? over[k] : NEUTRAL[i]))
}
const wetMono = (out, from = 0, to = out.length / 3) => {
  const s = new Float32Array(to - from)
  for (let i = from; i < to; i++) s[i - from] = 0.5 * (out[3 * i] + out[3 * i + 1])
  return s
}
const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length))
const sine = (hz, seconds, amp = 0.3) => {
  const n = Math.round(seconds * DSP_RATE), s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = amp * Math.sin(2 * Math.PI * hz * i / DSP_RATE)
  return s
}

// Fundamental by normalized autocorrelation: first strong peak.
function pitchHz(signal, sampleRate, minHz = 60, maxHz = 2000) {
  const minLag = Math.floor(sampleRate / maxHz), maxLag = Math.ceil(sampleRate / minHz)
  const n = signal.length - maxLag
  const corr = new Float64Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let acc = 0, e1 = 0, e2 = 0
    for (let i = 0; i < n; i++) { acc += signal[i] * signal[i + lag]; e1 += signal[i] ** 2; e2 += signal[i + lag] ** 2 }
    corr[lag] = acc / Math.sqrt(e1 * e2 || 1)
  }
  const globalMax = Math.max(...corr.slice(minLag, maxLag + 1))
  let bestLag = 0
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > 0.9 * globalMax) { bestLag = lag; break }
  }
  const a = corr[bestLag - 1], b = corr[bestLag], c = corr[bestLag + 1]
  return sampleRate / (bestLag + (a - c) / (2 * (a - 2 * b + c)))
}
const cents = (hz, ref) => 1200 * Math.log2(hz / ref)
// Pure-sine inputs stay near-sinusoidal through the grains, so rising zero
// crossings are a robust pitch estimate across the whole ±24 st range.
const zeroCrossHz = (sig) => {
  let zc = 0
  for (let i = 1; i < sig.length; i++) if (sig[i - 1] < 0 && sig[i] >= 0) zc++
  return zc / (sig.length / DSP_RATE)
}

test('the committed artifact matches its manifest and has no imports', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  const x = new WebAssembly.Instance(module, {}).exports
  assert.equal(x.cg_block_size(), BLOCK)
  assert.equal(x.cg_sample_rate(), DSP_RATE)
  assert.equal(x.cg_buffer_samples(), 32704)   // upstream's stereo HQ buffer
})

test('every scenario renders finite, bounded audio without faults', () => {
  const input = testInput()
  for (const sc of CLOUDS_SCENARIOS) {
    const { out, exports } = renderScenarioWasm(module, sc, input)
    let peak = 0
    for (const v of out) {
      assert.ok(Number.isFinite(v), `${sc.name}: non-finite sample`)
      peak = Math.max(peak, Math.abs(v))
    }
    assert.ok(peak > 0.01, `${sc.name}: silent`)
    assert.ok(peak < 2.5, `${sc.name}: runaway level (peak ${peak})`)
    assert.equal(exports.cg_fault_count(), 0, `${sc.name}: DSP faults`)
  }
})

test('renders are deterministic for a given seed', () => {
  const input = testInput()
  const sc = CLOUDS_SCENARIOS.find(s => s.name === 'feedback-reverb')
  assert.deepEqual(renderScenarioWasm(module, sc, input).out, renderScenarioWasm(module, sc, input).out)
})

test('BLEND dry/wet: fully dry has no grains and unity dry gain, fully wet no dry', () => {
  const input = testInput(2)
  const dry = renderScenarioWasm(module, { name: 'd', seed: 1, params: P({ dryWet: 0 }), events: [], blocks: 1500 }, input).out
  assert.ok(rms(wetMono(dry, 500 * BLOCK)) < 1e-4)
  assert.ok(Math.abs(dry[dry.length - 1] - 1) < 1e-3)
  const wet = renderScenarioWasm(module, { name: 'w', seed: 1, params: P({ dryWet: 1 }), events: [], blocks: 1500 }, input).out
  assert.ok(rms(wetMono(wet, 500 * BLOCK)) > 0.02)
  assert.ok(wet[wet.length - 1] < 1e-3)
})

test('DENSITY at centre makes grains only on TRIG', () => {
  const input = sine(330, 2)
  const quiet = renderScenarioWasm(module, { name: 'q', seed: 2, params: P({ density: 0.5, dryWet: 1, reverb: 0 }), events: [], blocks: 1500 }, input).out
  assert.ok(rms(wetMono(quiet, 300 * BLOCK)) < 1e-4, 'no TRIG: no grains')
  const trig = renderScenarioWasm(module, { name: 't', seed: 2, params: P({ density: 0.5, dryWet: 1, reverb: 0 }), events: [[600, 'trig']], blocks: 1500 }, input).out
  assert.ok(rms(wetMono(trig, 600 * BLOCK, 700 * BLOCK)) > 0.01, 'TRIG seeds a grain')
  assert.ok(rms(wetMono(trig, 300 * BLOCK, 599 * BLOCK)) < 1e-4, 'nothing before it')
})

test('PITCH transposes the grains along upstream’s quantized knob curve', () => {
  const input = sine(220, 3)
  for (const [knob, semis] of [[0.5, 0], [0.8, 4], [0.2, -4], [1, 24], [0, -24]]) {
    const sc = { name: 'p', seed: 3, params: P({ pitch: knob, density: 0.8, texture: 0.6, dryWet: 1, spread: 0 }), events: [], blocks: 2500 }
    const sig = wetMono(renderScenarioWasm(module, sc, input).out, 1200 * BLOCK, 2400 * BLOCK)
    const expected = 220 * 2 ** (semis / 12)
    const got = zeroCrossHz(sig)
    assert.ok(Math.abs(cents(got, expected)) < 25, `knob ${knob}: ${got.toFixed(1)} Hz, expected ${expected.toFixed(1)}`)
  }
})

test('FREEZE stops recording: grains keep the frozen material', () => {
  // 220 Hz for 1.5 s, then 440 Hz. Frozen at 1.4 s, grains must stay at 220.
  const a = sine(220, 1.5), b = sine(440, 1.5)
  const input = new Float32Array(a.length + b.length)
  input.set(a); input.set(b, a.length)
  const frozenAt = Math.round(1.4 * DSP_RATE / BLOCK)
  const base = { position: 0.3, density: 0.8, texture: 0.6, dryWet: 1, spread: 0 }
  const sc = { name: 'f', seed: 4, params: P(base), events: [[frozenAt, 'params', ...P({ ...base, freeze: 1 })]], blocks: 2800 }
  const sig = wetMono(renderScenarioWasm(module, sc, input).out, 2000 * BLOCK, 2800 * BLOCK)
  assert.ok(Math.abs(cents(pitchHz(sig, DSP_RATE, 50, 1500), 220)) < 20, 'frozen buffer still plays 220 Hz')
  const live = { ...sc, events: [] }
  const sig2 = wetMono(renderScenarioWasm(module, live, input).out, 2000 * BLOCK, 2800 * BLOCK)
  assert.ok(Math.abs(cents(pitchHz(sig2, DSP_RATE, 50, 1500), 440)) < 20, 'unfrozen buffer follows the input')
})

test('reset forgets the recording', () => {
  const input = sine(330, 0.5)
  const sc = { name: 'r', seed: 5, params: P({ dryWet: 1, reverb: 0, feedback: 0 }), events: [[700, 'reset']], blocks: 1200 }
  const out = renderScenarioWasm(module, sc, input).out
  assert.ok(rms(wetMono(out, 900 * BLOCK)) < 1e-4)
})
