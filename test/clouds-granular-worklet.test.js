import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { textureDspParams } from '../lib/granularEngine.js'

// The worklet file has no exports (see its header), so evaluate it the way
// standardized-audio-context does (as a function body) and pull the host class
// out. The real wasm module drives it: lane audio in → 32 kHz DSP → dry + wet out.

const source = readFileSync(new URL('../public/worklets/clouds-granular-processor.js', import.meta.url), 'utf8')
const { TextureHost } = new Function(`${source}\nreturn { TextureHost }`)()

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/clouds-granular.manifest.json', import.meta.url), 'utf8'))
const module = new WebAssembly.Module(readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url)))

const QUANTUM = 128
const RATES = [44100, 48000, 96000]
const LATENCY_MS = (2 * 32 + 8) / 32000 * 1000

function makeHost(sampleRate, cfg = {}) {
  const x = new WebAssembly.Instance(module, {}).exports
  return new TextureHost(x, sampleRate, { seed: 4, params: textureDspParams(cfg) })
}

// Feed `input(frame)` (mono) through the host for `seconds`; returns L/R.
function run(host, sampleRate, seconds, input, { beforeQuantum } = {}) {
  const frames = Math.round(seconds * sampleRate)
  const L = new Float32Array(frames), R = new Float32Array(frames)
  const inBuf = new Float32Array(QUANTUM)
  for (let off = 0; off < frames; off += QUANTUM) {
    beforeQuantum?.(off)
    const n = Math.min(QUANTUM, frames - off)
    for (let j = 0; j < n; j++) inBuf[j] = input ? input(off + j) : 0
    const i = input ? inBuf.subarray(0, n) : null
    host.process(i, i, L.subarray(off, off + n), R.subarray(off, off + n), n, off)
  }
  return { L, R }
}

const sineAt = (hz, sr, amp = 0.3) => (f) => amp * Math.sin(2 * Math.PI * hz * f / sr)

test('fully dry, the lane passes through bit-exact at every host rate', () => {
  for (const sr of RATES) {
    const host = makeHost(sr, { txBlend: 0 })
    const input = sineAt(330, sr)
    const { L, R } = run(host, sr, 0.5, input)
    for (let f = 0; f < L.length; f++) {
      assert.equal(L[f], Math.fround(input(f)), `${sr}: frame ${f}`)
      assert.equal(R[f], Math.fround(input(f)))
    }
  }
})

test('wet output is finite and the dry gain follows BLEND', () => {
  for (const sr of RATES) {
    const host = makeHost(sr, { txBlend: 1, txDensity: 0.8 })
    const { L } = run(host, sr, 1.5, sineAt(220, sr))
    let peak = 0
    for (const v of L) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)) }
    assert.ok(peak > 0.05 && peak < 2.5, `${sr}: peak ${peak}`)
    assert.ok(host.dryGain < 0.01, `${sr}: dry gain ${host.dryGain}`)
    assert.equal(host.stats.underrun, 0)
  }
})

test('a lane note seeds its grain at its timestamp plus the fixed wet latency', () => {
  for (const sr of RATES) {
    // Record a tone for 0.2 s, then silence: after that the output is wet only.
    // Density at centre: grains only on TRIG. Texture 0: square window, so the
    // grain's first sample is its onset.
    const host = makeHost(sr, { txBlend: 1, txDensity: 0.5, txTexture: 0, txPosition: 0.35, txSize: 0.3, txReverb: 0 })
    const tone = sineAt(440, sr)
    const input = f => (f < 0.2 * sr ? tone(f) : 0)
    const at = 0.4
    let sent = false
    const { L } = run(host, sr, 0.6, input, {
      beforeQuantum: (off) => { if (!sent && off >= 0.3 * sr) { host.trig({ time: at, gen: 0 }, off); sent = true } },
    })
    const from = Math.round(0.21 * sr)
    const onset = L.findIndex((v, f) => f >= from && Math.abs(v) > 1e-4)
    assert.ok(onset > 0, `${sr}: no grain`)
    const errMs = (onset / sr - at) * 1000 - LATENCY_MS
    assert.ok(errMs > -0.6 && errMs < 1.2, `${sr}: onset ${errMs.toFixed(3)} ms from timestamp + latency`)
  }
})

test('cancel drops queued triggers from older generations', () => {
  const host = makeHost(48000)
  host.trig({ time: 0.5, gen: 1 })
  host.trig({ time: 0.6, gen: 1 })
  host.cancel(2)
  assert.equal(host.queue.length, 0)
  assert.equal(host.trig({ time: 0.7, gen: 1 }), false)
  assert.equal(host.trig({ time: 0.7, gen: 2 }), true)
})

test('stale triggers after a stall are dropped, slightly late ones still fire', () => {
  const sr = 48000
  const host = makeHost(sr, { txDensity: 0.5 })
  run(host, sr, 0.2, sineAt(220, sr))
  host.trig({ time: 0.195, gen: 0 })   // its block is already rendered: late
  host.trig({ time: 0.05, gen: 0 })    // 150 ms late: stale
  run(host, sr, 0.05, sineAt(220, sr), { startFrame: Math.round(0.2 * sr) })
  assert.equal(host.stats.late, 1)
  assert.equal(host.stats.dropped, 1)
})

test('with nothing connected it renders silence', () => {
  const host = makeHost(48000, { txBlend: 1 })
  const { L } = run(host, 48000, 0.3, null)
  assert.ok(L.every(v => v === 0))
})
