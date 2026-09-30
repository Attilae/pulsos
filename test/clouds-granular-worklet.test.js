import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { testSource } from '../scripts/lib/cloudsScenarios.js'
import { cloudsParamsFromGranular } from '../lib/granularEngine.js'
import { DEFAULT_GRANULAR } from '../lib/soundSpecs.js'

// The worklet file has no exports (see its header), so evaluate it the way
// standardized-audio-context does — as a function body — and pull the host class
// out. The real wasm module drives it: timestamp → DSP block → resampled output.

const source = readFileSync(new URL('../public/worklets/clouds-granular-processor.js', import.meta.url), 'utf8')
const { CloudsHost } = new Function(`${source}\nreturn { CloudsHost }`)()

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/clouds-granular.manifest.json', import.meta.url), 'utf8'))
const module = new WebAssembly.Module(readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url)))

const QUANTUM = 128
const RATES = [44100, 48000, 96000]

function makeHost(sampleRate, cfg = {}) {
  const x = new WebAssembly.Instance(module, {}).exports
  const host = new CloudsHost(x, sampleRate, { seed: 4, params: cloudsParamsFromGranular({ ...DEFAULT_GRANULAR, ...cfg }) })
  return host
}

function run(host, sampleRate, seconds, { startFrame = 0, beforeQuantum } = {}) {
  const frames = Math.round(seconds * sampleRate)
  const L = new Float32Array(frames), R = new Float32Array(frames)
  for (let off = 0; off < frames; off += QUANTUM) {
    beforeQuantum?.(startFrame + off)
    const n = Math.min(QUANTUM, frames - off)
    host.render(L.subarray(off, off + n), R.subarray(off, off + n), n, startFrame + off)
  }
  return { L, R }
}

const firstOnset = (sig, threshold = 1e-3) => sig.findIndex(v => Math.abs(v) > threshold)

test('a scheduled note seeds its grain within ±0.5 ms of its timestamp', () => {
  for (const sr of RATES) {
    for (const at of [0.1, 0.10037, 0.2513]) {
      const host = makeHost(sr)
      // DC source + a sharp window: the output is the grain envelope itself, so
      // its first non-zero sample is the grain's start. A near-zero density
      // stops the grain clock, so only the note's seeded grain can sound.
      host.x.cg_set_params(3200, 0.01, 0, 0.1, 0.5, 0, 0, 0, 0)
      host.loadSource(new Float32Array(64000).fill(0.5), true)
      host.note({ time: at, semis: 0, gen: 0 })
      const { L } = run(host, sr, 0.4)
      const onset = firstOnset(L, 1e-6)
      assert.ok(onset > 0, `${sr}: no onset`)
      const errMs = (onset / sr - at) * 1000
      assert.ok(Math.abs(errMs) <= 0.5 + 1000 / sr, `${sr} @${at}: onset ${errMs.toFixed(3)} ms from its timestamp`)
    }
  }
})

test('resampled output is continuous and finite at every host rate', () => {
  for (const sr of RATES) {
    const host = makeHost(sr)
    host.loadSource(testSource(), true)
    host.note({ time: 0.01, semis: 0, gen: 0 })
    const { L, R } = run(host, sr, 1)
    let peak = 0
    for (let i = 0; i < L.length; i++) {
      assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]))
      peak = Math.max(peak, Math.abs(L[i]))
    }
    assert.ok(peak > 0.05 && peak < 2, `${sr}: peak ${peak}`)
  }
})

test('cancel drops queued notes from older generations', () => {
  const host = makeHost(48000)
  host.loadSource(testSource(), true)
  host.note({ time: 0.5, semis: 12, gen: 1 })
  host.note({ time: 0.6, semis: 7, gen: 1 })
  host.cancel(2)
  assert.equal(host.queue.length, 0)
  assert.equal(host.note({ time: 0.7, semis: 0, gen: 1 }), false)
  assert.equal(host.note({ time: 0.7, semis: 0, gen: 2 }), true)
})

test('stale notes after a stall are dropped, slightly late ones still play', () => {
  const host = makeHost(48000)
  host.loadSource(testSource(), true)
  run(host, 48000, 0.2)
  host.note({ time: 0.19, semis: 0, gen: 0 })   // ~10 ms late
  host.note({ time: 0.05, semis: 0, gen: 0 })   // 150 ms late
  run(host, 48000, 0.05, { startFrame: Math.round(0.2 * 48000) })
  assert.equal(host.stats.late, 1)
  assert.equal(host.stats.dropped, 1)
})

test('a source replacement fades rather than jumping', () => {
  const host = makeHost(48000)
  host.loadSource(testSource(2, 220), true)
  host.note({ time: 0, semis: 0, gen: 0 })
  run(host, 48000, 0.3)
  host.loadSource(testSource(2, 440))
  const { L } = run(host, 48000, 0.05, { startFrame: Math.round(0.3 * 48000) })
  let maxStep = 0
  for (let i = 1; i < L.length; i++) maxStep = Math.max(maxStep, Math.abs(L[i] - L[i - 1]))
  assert.ok(maxStep < 0.2, `discontinuity ${maxStep}`)
})
