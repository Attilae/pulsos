import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analogModeIndex } from '../lib/laneFilterSpec.js'

// The worklet file has no exports (see its header), so evaluate it the way
// standardized-audio-context does (as a function body) and pull the host class
// out. The real wasm module drives it.

const source = readFileSync(new URL('../public/worklets/ladder-processor.js', import.meta.url), 'utf8')
const { LadderHost, modeIndex } = new Function(`${source}\nreturn { LadderHost, modeIndex }`)()

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/ladder.manifest.json', import.meta.url), 'utf8'))
const module = new WebAssembly.Module(readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url)))

const QUANTUM = 128
const RATES = [44100, 48000, 96000]

const makeHost = (sampleRate, opts = {}) =>
  new LadderHost(new WebAssembly.Instance(module, {}).exports, sampleRate, { cutoff: 1000, resonance: 0.4, drive: 1, ...opts })

// Feed input(frame) → [l, r] | number (mono) through the host. `params(off, n)`
// returns the quantum's AudioParam arrays; default: none (the host's last values).
function run(host, frames, input, { params, mono = false, beforeQuantum } = {}) {
  const L = new Float32Array(frames), R = new Float32Array(frames)
  const inL = new Float32Array(QUANTUM), inR = new Float32Array(QUANTUM)
  for (let off = 0; off < frames; off += QUANTUM) {
    beforeQuantum?.(off)
    const n = Math.min(QUANTUM, frames - off)
    for (let j = 0; j < n; j++) {
      const v = input ? input(off + j) : 0
      inL[j] = Array.isArray(v) ? v[0] : v
      inR[j] = Array.isArray(v) ? v[1] : v
    }
    host.process(input ? inL.subarray(0, n) : null, input && !mono ? inR.subarray(0, n) : null,
      L.subarray(off, off + n), R.subarray(off, off + n), n, params?.(off, n))
  }
  return { L, R }
}
const sine = (hz, sr, amp = 0.3) => (f) => amp * Math.sin(2 * Math.PI * hz * f / sr)
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length))

test('the worklet and the spec agree on mode indices', () => {
  for (const type of ['lowpass', 'highpass', 'bandpass']) {
    for (const slope of [12, 24]) assert.equal(modeIndex(type, slope), analogModeIndex(type, slope))
  }
})

test('a wasm with the wrong ABI is refused', () => {
  const x = new WebAssembly.Instance(module, {}).exports
  assert.throws(() => new LadderHost({ ...x, ld_abi_version: () => 2 }, 48000), /ABI/)
})

test('real processing at every host rate: finite, filtered, stereo-isolated', () => {
  for (const sr of RATES) {
    const host = makeHost(sr)
    const s = sine(220, sr)
    const { L, R } = run(host, sr / 2, (f) => [s(f), 0])
    assert.ok(L.every(Number.isFinite))
    assert.ok(rms(L) > 0.01, `${sr}`)
    assert.ok(R.every(v => v === 0), `${sr}: right stays silent`)
  }
})

test('a mono input (no second channel) plays identically on both sides', () => {
  const host = makeHost(48000)
  const { L, R } = run(host, 24000, sine(330, 48000), { mono: true })
  assert.ok(rms(L) > 0.01)
  assert.deepEqual(L, R)
})

test('no input still advances the filter: self-oscillation keeps ringing', () => {
  const host = makeHost(48000, { cutoff: 660, resonance: 1.8 })
  run(host, 9600, sine(110, 48000))
  const { L } = run(host, 24000, null)
  assert.ok(rms(L.subarray(-4800)) > 0.05)
})

test('a scheduled step lands on its sample: per-sample arrays == split renders', () => {
  const sr = 48000
  const s = sine(180, sr)
  const step = 70    // inside the second quantum
  const a = makeHost(sr), b = makeHost(sr)
  const cut = new Float32Array(QUANTUM)
  const ya = run(a, QUANTUM * 4, s, {
    params: (off) => {
      for (let j = 0; j < QUANTUM; j++) cut[j] = off + j < QUANTUM + step ? 400 : 3000
      return { cutoff: cut }
    },
  })
  // b: constant arrays, switching exactly at the step (split quantum by hand).
  const L = new Float32Array(QUANTUM * 4), R = new Float32Array(QUANTUM * 4)
  const inp = new Float32Array(QUANTUM * 4).map((_, f) => s(f))
  const seg = (from, to, hz) =>
    b.process(inp.subarray(from, to), inp.subarray(from, to), L.subarray(from, to), R.subarray(from, to), to - from, { cutoff: new Float32Array([hz]) })
  seg(0, QUANTUM, 400); seg(QUANTUM, QUANTUM + step, 400); seg(QUANTUM + step, 2 * QUANTUM, 3000)
  seg(2 * QUANTUM, 3 * QUANTUM, 3000); seg(3 * QUANTUM, 4 * QUANTUM, 3000)
  assert.ok(rms(L) > 0.01)
  assert.deepEqual(ya.L, L)
})

test('a linear resonance ramp is applied per sample (bulk arrays, one call per quantum)', () => {
  const sr = 48000
  const host = makeHost(sr)
  let calls = 0
  const real = host.x.ld_process
  let flags = 0
  host.x = { ...host.x, ld_process: (n, f) => { calls++; flags |= f; return real(n, f) } }
  const res = new Float32Array(QUANTUM)
  run(host, QUANTUM * 8, sine(200, sr), {
    params: (off) => { for (let j = 0; j < QUANTUM; j++) res[j] = 1.8 * (off + j) / (QUANTUM * 8); return { resonance: res } },
  })
  assert.equal(calls, 8)
  assert.ok(flags & 4, 'resonance passed per sample')
})

test('a render quantum larger than the bridge block is processed in chunks', () => {
  const sr = 48000
  const a = makeHost(sr), b = makeHost(sr)
  const n = 512
  const inp = new Float32Array(n).map((_, f) => sine(250, sr)(f))
  const La = new Float32Array(n), Ra = new Float32Array(n)
  a.process(inp, inp, La, Ra, n, null)
  const { L } = run(b, n, sine(250, sr))
  assert.ok(rms(L) > 0.01)
  assert.deepEqual(La, L)
})

test('suspend outputs silence and resets; resume starts from a clean state', () => {
  const sr = 48000
  const s = sine(140, sr)
  const host = makeHost(sr, { resonance: 1.6 })
  run(host, 9600, s)
  host.suspend()
  const quiet = run(host, 2400, s)
  assert.ok(quiet.L.every(v => v === 0) && quiet.R.every(v => v === 0))
  host.resume()
  const resumed = run(host, 4800, s)
  const fresh = run(makeHost(sr, { resonance: 1.6 }), 4800, s)
  assert.ok(rms(fresh.L) > 0.01)
  assert.deepEqual(resumed.L, fresh.L)
})

test('a response change crossfades over 20 ms and then is exactly the new response', () => {
  const sr = 48000
  const s = sine(150, sr)
  const host = makeHost(sr, { mode: 0, resonance: 0.7, cutoff: 160 })
  const lp = makeHost(sr, { mode: 0, resonance: 0.7, cutoff: 160 })
  const hp = makeHost(sr, { mode: 4, resonance: 0.7, cutoff: 160 })
  run(host, 4800, s); run(lp, 4800, s); run(hp, 4800, s)
  host.setMode(4)
  const y = run(host, 4800, s).L
  const a = run(lp, 4800, s).L
  const b = run(hp, 4800, s).L
  const fade = host.fadeSamples
  assert.equal(fade, 960)
  for (let i = 0; i < fade; i++) {
    const lo = Math.min(a[i], b[i]) - 1e-6, hi = Math.max(a[i], b[i]) + 1e-6
    assert.ok(y[i] >= lo && y[i] <= hi, `frame ${i} outside the two responses`)
  }
  for (let i = fade; i < y.length; i++) assert.equal(y[i], b[i])
  assert.ok(rms(a) > 0.01 && rms(b) > 0.01)
})

test('a suspended filter switches response immediately (nothing to crossfade)', () => {
  const host = makeHost(48000)
  host.suspend()
  host.setMode(5)
  assert.equal(host.x.ld_mode(), 5)
})

test('a nonfinite output is reported once, and the filter recovers', () => {
  const sr = 48000
  const host = makeHost(sr)
  const L = new Float32Array(QUANTUM), R = new Float32Array(QUANTUM)
  const bad = new Float32Array(QUANTUM); bad[3] = NaN
  assert.equal(host.process(bad, bad, L, R, QUANTUM, null), true)
  assert.ok(L.every(Number.isFinite))
  assert.equal(host.process(bad, bad, L, R, QUANTUM, null), false, 'reported only once')
  const { L: after } = run(host, 4800, sine(200, sr))
  assert.ok(after.every(Number.isFinite) && rms(after) > 0.01)
})

test('separate hosts never share DSP state (two Song Chainer engines)', () => {
  const sr = 48000
  const a = makeHost(sr, { resonance: 1.8, cutoff: 500 }), b = makeHost(sr, { resonance: 1.8, cutoff: 500 })
  run(a, 9600, sine(100, sr))
  const { L } = run(b, 4800, null)
  assert.ok(L.every(v => v === 0))
})
