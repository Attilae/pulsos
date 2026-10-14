import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The worklet file has no exports (see its header), so evaluate it the way
// standardized-audio-context does (as a function body) and pull the host class
// out. The real wasm module drives it: lane audio in → the quality's DSP rate →
// the processor's full output (dry and wet) back at the context rate.

const source = readFileSync(new URL('../public/worklets/beads-processor.js', import.meta.url), 'utf8')
const { BeadsHost } = new Function(`${source}\nreturn { BeadsHost }`)()

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/beads.manifest.json', import.meta.url), 'utf8'))
const module = new WebAssembly.Module(readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url)))

const QUANTUM = 128
const RATES = [44100, 48000, 96000]
const QUALITIES = { dirtyTape: 24000, cleanTape: 48000, vintage: 32000, hifi: 48000 }
const SEED_DELAY_MS = 2.5        // the firmware's SEED delay (bridge.cc)

// Panel positions; attenuverters and pitch centred (no randomization, no transpose).
const PARAMS = {
  time: 0.02, size: 0.5, shape: 0.5, pitch: 0.5, timeAmt: 0.5, sizeAmt: 0.5, shapeAmt: 0.5, pitchAmt: 0.5,
  density: 0.5, feedback: 0, dryWet: 0.5, reverb: 0, inGain: 1, freeze: false, quality: 'hifi', seedMode: 'gates',
}

function makeHost(sampleRate, over = {}) {
  const x = new WebAssembly.Instance(module, {}).exports
  return new BeadsHost(x, sampleRate, { seed: 4, params: { ...PARAMS, ...over } })
}

// Feed `input(frame)` (mono) through the host for `seconds`, starting at context
// frame `startFrame` (to continue an earlier run); returns L/R.
function run(host, sampleRate, seconds, input, { beforeQuantum, startFrame = 0 } = {}) {
  const frames = Math.round(seconds * sampleRate)
  const L = new Float32Array(frames), R = new Float32Array(frames)
  const inBuf = new Float32Array(QUANTUM)
  for (let off = 0; off < frames; off += QUANTUM) {
    beforeQuantum?.(off)
    const n = Math.min(QUANTUM, frames - off)
    for (let j = 0; j < n; j++) inBuf[j] = input ? input(startFrame + off + j) : 0
    const i = input ? inBuf.subarray(0, n) : null
    host.process(i, i, L.subarray(off, off + n), R.subarray(off, off + n), n, startFrame + off)
  }
  return { L, R }
}

const sineAt = (hz, sr, amp = 0.3) => (f) => amp * Math.sin(2 * Math.PI * hz * f / sr)
const rms = (a, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

test('fully dry at 48 kHz Hi-fi: 0.75 × the input, `latency` samples late, sample for sample', () => {
  const host = makeHost(48000, { dryWet: 0 })
  const input = sineAt(330, 48000)
  const { L, R } = run(host, 48000, 0.5, input)
  assert.equal(host.latency, 32)
  for (let f = 4800; f < L.length; f++) {       // after the dry/wet knob has settled
    const want = 0.75 * Math.fround(input(f - host.latency))
    assert.ok(Math.abs(L[f] - want) < 1e-5, `frame ${f}: ${L[f]} vs ${want}`)
    assert.equal(R[f], L[f])
  }
  assert.equal(host.stats.underrun, 0)
})

test('every quality at every host rate: dry level within 1.5%, latency under 1 ms, no underruns', () => {
  for (const sr of RATES) {
    for (const [quality, dspRate] of Object.entries(QUALITIES)) {
      const host = makeHost(sr, { dryWet: 0, quality })
      assert.equal(host.dspRate, dspRate)
      assert.ok(host.latency / dspRate < 0.001, `${sr}/${quality}: latency ${host.latency} samples`)
      const input = sineAt(330, sr)
      const { L } = run(host, sr, 1, input)
      const ref = new Float32Array(L.length).map((_, f) => input(f))
      const ratio = rms(L, sr / 4) / rms(ref, sr / 4)
      // Dirty tape's mu-law dry path costs a little level.
      const tol = quality === 'dirtyTape' ? 0.05 : 0.015
      assert.ok(Math.abs(ratio - 0.75) < tol, `${sr}/${quality}: dry ratio ${ratio}`)
      assert.equal(host.stats.underrun, 0, `${sr}/${quality}`)
      assert.ok(L.every(Number.isFinite))
    }
  }
})

test('a lane note seeds a grain at its timestamp plus the SEED delay and the host latency', () => {
  // Hi-fi and Vintage add nothing of their own. Clean tape's 2× resampler and
  // Dirty tape's wow-and-flutter delay line add a fixed, upstream delay; what the
  // host owns is that every quality lands the same at every context rate.
  const OWN_MS = { hifi: 0, vintage: 0, cleanTape: 0.35, dirtyTape: 2.5 }
  for (const [quality, ownMs] of Object.entries(OWN_MS)) {
    for (const sr of RATES) {
      // Wet only, density at centre: one grain per note, read from just behind
      // the write head (a continuous tone, so the grain starts at full level).
      const host = makeHost(sr, { dryWet: 1, density: 0.5, time: 0.02, quality })
      const at = 0.4
      let sent = false
      const { L } = run(host, sr, 0.6, sineAt(440, sr), {
        beforeQuantum: (off) => { if (!sent && off >= 0.35 * sr) { host.note({ time: at, dur: 0.05, gen: 0 }); sent = true } },
      })
      assert.ok(rms(L, 0.1 * sr, 0.39 * sr) === 0, `${sr}/${quality}: grains before the note`)
      const onset = L.findIndex((v, f) => f >= 0.36 * sr && Math.abs(v) > 1e-4)
      assert.ok(onset > 0, `${sr}/${quality}: no grain`)
      const latencyMs = host.latency / host.dspRate * 1000
      const errMs = (onset / sr - at) * 1000 - SEED_DELAY_MS - latencyMs - ownMs
      assert.ok(Math.abs(errMs) < 0.25, `${sr}/${quality}: onset ${errMs.toFixed(3)} ms off`)
    }
  }
})

test('note gates: grains run while the note is held and stop after it', () => {
  const sr = 48000
  // Right of centre: a random grain train while the gate is high.
  const host = makeHost(sr, { dryWet: 1, density: 0.9, size: 0.3, time: 0.05 })
  host.note({ time: 0.5, dur: 0.5, gen: 0 })
  const { L } = run(host, sr, 2.5, sineAt(220, sr))
  assert.ok(rms(L, 0.1 * sr, 0.5 * sr) < 1e-3, 'before the note')
  assert.ok(rms(L, 0.6 * sr, sr) > 0.02, 'while held')
  assert.ok(rms(L, 2 * sr, 2.5 * sr) < 1e-3, 'after the note')
})

test('a very short note still makes one grain (the gate stays high for a sample)', () => {
  const sr = 48000
  const host = makeHost(sr, { dryWet: 1, density: 0.5, time: 0.05 })
  host.note({ time: 0.5, dur: 1e-6, gen: 0 })
  const { L } = run(host, sr, 1, sineAt(220, sr))
  assert.ok(rms(L, 0.5 * sr, sr) > 1e-3)
})

test('cancel drops queued notes from older generations and closes an open gate', () => {
  const host = makeHost(48000)
  host.note({ time: 0.5, dur: 0.1, gen: 1 })
  host.note({ time: 0.6, dur: 0.1, gen: 1 })
  host.cancel(2)
  assert.equal(host.queue.length, 0)
  assert.equal(host.note({ time: 0.7, gen: 1 }), false)
  assert.equal(host.note({ time: 0.7, gen: 2 }), true)

  // A long note is held when the song stops: grains must stop with it.
  const sr = 48000
  const h = makeHost(sr, { dryWet: 1, density: 0.9, size: 0.3, time: 0.05 })
  h.note({ time: 0.2, dur: 30, gen: 0 })
  run(h, sr, 0.6, sineAt(220, sr))
  assert.equal(h.gateHigh, true)
  h.cancel(1)
  const { L } = run(h, sr, 2, sineAt(220, sr), { startFrame: Math.round(0.6 * sr) })
  assert.equal(h.gateHigh, false)
  assert.ok(rms(L, 1.5 * sr, 2 * sr) < 1e-3, 'grains after cancel')
})

test('stale gate-highs after a stall are dropped, slightly late ones fire, gate-lows never drop', () => {
  const sr = 48000
  const host = makeHost(sr)
  run(host, sr, 0.2, sineAt(220, sr))
  host.note({ time: 0.195, dur: 0.001, gen: 0 })   // high and low both already due: late
  host.note({ time: 0.05, dur: 0.01, gen: 0 })     // 150 ms late: stale high, its low still applies
  run(host, sr, 0.05, sineAt(220, sr), { startFrame: Math.round(0.2 * sr) })
  assert.equal(host.stats.late, 1)
  assert.equal(host.stats.dropped, 1)
  assert.equal(host.queue.length, 0)
  assert.equal(host.gateHigh, false)
})

test('switching quality fades out, retimes the DSP and fades back in without clicks or NaN', () => {
  const sr = 48000
  const host = makeHost(sr, { dryWet: 0.6, density: 0.8 })
  const input = sineAt(220, sr)
  const order = ['dirtyTape', 'vintage', 'cleanTape', 'hifi']
  let i = 0
  const { L } = run(host, sr, 3, input, {
    beforeQuantum: (off) => {
      if (off >= (0.5 + 0.5 * i) * sr && i < order.length) host.setParams({ ...PARAMS, dryWet: 0.6, density: 0.8, quality: order[i++] })
    },
  })
  assert.equal(host.stats.switches, 4)
  assert.equal(host.quality, 'hifi')
  assert.equal(host.dspRate, 48000)
  assert.equal(host.stats.underrun, 0)
  let jump = 0
  for (let f = 1; f < L.length; f++) {
    assert.ok(Number.isFinite(L[f]))
    jump = Math.max(jump, Math.abs(L[f] - L[f - 1]))
  }
  // A 220 Hz, 0.3-amplitude sine moves at most 0.0087 per sample; grains and
  // the dry path add some, but a hard cut would jump by the full amplitude.
  assert.ok(jump < 0.08, `largest step ${jump}`)
})

test('notes queued across a quality switch still land on time', () => {
  const sr = 48000
  const host = makeHost(sr, { dryWet: 1, density: 0.5, time: 0.02 })
  host.note({ time: 0.8, dur: 0.05, gen: 0 })
  let switched = false
  const { L } = run(host, sr, 1, sineAt(440, sr), {
    beforeQuantum: (off) => { if (!switched && off >= 0.4 * sr) { host.setParams({ ...PARAMS, dryWet: 1, density: 0.5, time: 0.02, quality: 'vintage' }); switched = true } },
  })
  assert.equal(host.quality, 'vintage')
  const onset = L.findIndex((v, f) => f >= 0.45 * sr && Math.abs(v) > 1e-4)
  const errMs = (onset / sr - 0.8) * 1000 - SEED_DELAY_MS - host.latency / host.dspRate * 1000
  assert.ok(errMs > -0.5 && errMs < 1, `onset ${errMs.toFixed(3)} ms off`)
})

test('seed modes: free runs without notes, gates and clock wait for them', () => {
  const sr = 48000
  for (const [seedMode, expectSound] of [['free', true], ['gates', false], ['clock', false]]) {
    const host = makeHost(sr, { dryWet: 1, density: 0.8, seedMode })
    const { L } = run(host, sr, 1.5, sineAt(220, sr))
    assert.equal(rms(L, 0.5 * sr) > 1e-3, expectSound, seedMode)
  }
})

test('with nothing connected it renders silence', () => {
  const host = makeHost(48000, { dryWet: 1, seedMode: 'free' })
  const { L } = run(host, 48000, 0.3, null)
  assert.ok(L.every(v => v === 0))
})
