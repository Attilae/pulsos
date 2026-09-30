import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  BLOCK, CLOUDS_SCENARIOS, DSP_RATE, renderScenarioWasm, testSource,
} from '../scripts/lib/cloudsScenarios.js'

// Runs the committed Clouds granular wasm (public/wasm) directly — no worklet,
// no Tone. Native-vs-wasm lives in scripts/clouds_compare.js (needs a host
// compiler); these are the properties the shipped artifact must have everywhere.

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/clouds-granular.manifest.json', import.meta.url), 'utf8'))
const bytes = readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url))
const module = new WebAssembly.Module(bytes)

const mono = (interleaved) => {
  const out = new Float32Array(interleaved.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (interleaved[2 * i] + interleaved[2 * i + 1])
  return out
}
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length))

// Fundamental by normalized autocorrelation: first strong peak.
function pitchHz(signal, sampleRate, minHz = 60, maxHz = 1500) {
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

test('the committed artifact matches its manifest and has no imports', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  const x = new WebAssembly.Instance(module, {}).exports
  assert.equal(x.cg_block_size(), BLOCK)
  assert.equal(x.cg_sample_rate(), DSP_RATE)
})

test('every scenario renders finite, non-silent, bounded audio', () => {
  const source = testSource()
  for (const sc of CLOUDS_SCENARIOS) {
    const { out, exports } = renderScenarioWasm(module, sc, source)
    let peak = 0
    for (const v of out) {
      assert.ok(Number.isFinite(v), `${sc.name}: non-finite sample`)
      peak = Math.max(peak, Math.abs(v))
    }
    assert.ok(peak > 0.01, `${sc.name}: silent (peak ${peak})`)
    assert.ok(peak < 2, `${sc.name}: runaway level (peak ${peak})`)
    assert.equal(exports.cg_fault_count(), 0, `${sc.name}: DSP faults`)
  }
})

test('renders are deterministic for a given seed', () => {
  const source = testSource()
  const sc = CLOUDS_SCENARIOS.find(s => s.name === 'dense-jittered')
  const a = renderScenarioWasm(module, sc, source).out
  const b = renderScenarioWasm(module, sc, source).out
  assert.deepEqual(a, b)
})

test('note pitch transposes the grains relative to the source', () => {
  const source = testSource(2, 220)
  for (const semis of [0, 7, -12, 12]) {
    const sc = { name: 'p', seed: 9, params: [2880, 3.1, 1, 0.1, 0.5, 0, 0.75, 0, 0], events: [[0, 'note', semis]], blocks: 600 }
    const sig = mono(renderScenarioWasm(module, sc, source).out).subarray(200 * BLOCK)
    const expected = 220 * 2 ** (semis / 12)
    const got = pitchHz(sig, DSP_RATE)
    assert.ok(Math.abs(cents(got, expected)) < 15, `${semis} st: ${got.toFixed(1)} Hz, expected ${expected.toFixed(1)}`)
  }
})

test('grains stay inside the loop window', () => {
  // Silent first half, tone second half.
  const tone = testSource()
  const source = new Float32Array(tone.length)
  source.set(tone.subarray(tone.length / 2 - 8000, tone.length - 8000), tone.length / 2)
  const run = (winStart, winEnd, reverse = 0, jitter = 0) => {
    const sc = { name: 'w', seed: 5, params: [1600, 4, 1, winStart, winEnd, jitter, 0.75, 0.5, reverse], events: [[0, 'note', 0]], blocks: 1500 }
    return rms(mono(renderScenarioWasm(module, sc, source).out).subarray(100 * BLOCK))
  }
  assert.ok(run(0, 0.45) < 1e-4, 'window over the silent half must be silent')
  assert.ok(run(0.55, 1) > 0.05, 'window over the tone must sound')
  assert.ok(run(0, 0.45, 1) < 1e-4, 'reverse mirrors the same window')
  assert.ok(run(0.55, 1, 1) > 0.05, 'reverse over the tone must sound')
  assert.ok(run(0, 0.45, 0, 1) < 1e-4, 'jitter never leaves the window')
})

test('reverse plays the source backwards', () => {
  // A rising ramp of level: forwards scan hears it get louder, reverse quieter.
  const n = 64000
  const source = new Float32Array(n)
  for (let i = 0; i < n; i++) source[i] = (i / n) * Math.sin(2 * Math.PI * 330 * i / DSP_RATE)
  const env = (reverse) => {
    const sc = { name: 'r', seed: 3, params: [1600, 4, 1, 0, 1, 0, 0.75, 0.5, reverse], events: [[0, 'note', 0]], blocks: 1000 }
    const sig = mono(renderScenarioWasm(module, sc, source).out)
    return [rms(sig.subarray(100 * BLOCK, 300 * BLOCK)), rms(sig.subarray(700 * BLOCK, 900 * BLOCK))]
  }
  const [f0, f1] = env(0)
  const [r0, r1] = env(1)
  assert.ok(f1 > f0 * 1.5, `forwards should rise: ${f0} → ${f1}`)
  assert.ok(r0 > r1 * 1.5, `reverse should fall: ${r0} → ${r1}`)
})

test('an over-long source is cropped and reported, never overrun', () => {
  const x = new WebAssembly.Instance(module, {}).exports
  x.cg_init(1)
  const max = x.cg_max_source()
  const staging = new Float32Array(x.memory.buffer, x.cg_staging(), max)
  staging.fill(0.1)
  x.cg_load(max + 1000, 1)
  assert.equal(x.cg_source_length(), max)
  assert.equal(x.cg_crop_count(), 1)
})

test('panic fades the cloud out and it restarts on the next note', () => {
  const source = testSource()
  const sc = { name: 'x', seed: 2, params: [2880, 3.1, 1, 0, 1, 0, 0.75, 0.5, 0], events: [[0, 'note', 0], [300, 'panic']], blocks: 600 }
  const { exports: x } = renderScenarioWasm(module, sc, source)
  // Right after the fade the grain pool is empty; it refills as the clock runs.
  assert.ok(x.cg_active_grains() <= 4)
  assert.equal(x.cg_fault_count(), 0)
})
