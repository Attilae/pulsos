import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The worklet file has no exports (see its header), so evaluate it the way
// standardized-audio-context does — as a function body — and pull the class out.
const source = readFileSync(new URL('../public/worklets/true-peak-limiter.js', import.meta.url), 'utf8')
const { TruePeakLimiter } = new Function(`${source}\nreturn { TruePeakLimiter }`)()

const SR = 48000
const BLOCK = 128

// Run a stereo signal (same in both channels) through the limiter in worklet-sized
// blocks and return the left output.
function run(lim, signal) {
  const out = new Float32Array(signal.length)
  for (let off = 0; off < signal.length; off += BLOCK) {
    const n = Math.min(BLOCK, signal.length - off)
    const inL = signal.subarray(off, off + n)
    const oL = new Float32Array(n), oR = new Float32Array(n)
    lim.process([inL, inL], [oL, oR], n)
    out.set(oL, off)
  }
  return out
}

const sine = (len, amp, freq, phase = 0) =>
  Float32Array.from({ length: len }, (_, i) => amp * Math.sin(2 * Math.PI * freq * i / SR + phase))

const peak = (a, from = 0) => { let p = 0; for (let i = from; i < a.length; i++) p = Math.max(p, Math.abs(a[i])); return p }

// Reference true peak: 16× sinc reconstruction, far finer than the limiter's own
// 4× detector, so the test checks the waveform and not the detector against itself.
function truePeak(a, from, to) {
  let p = 0
  for (let i = from; i < to; i++) {
    for (let f = 0; f < 1; f += 1 / 16) {
      let acc = 0
      for (let k = -32; k <= 32; k++) {
        const j = i + k
        if (j < 0 || j >= a.length) continue
        const t = k - f
        acc += a[j] * (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t))
      }
      p = Math.max(p, Math.abs(acc))
    }
  }
  return p
}

test('quiet material passes bit-transparently, delayed by the reported latency', () => {
  const lim = new TruePeakLimiter({ sampleRate: SR })
  const x = sine(4800, 0.5, 440)
  const y = run(lim, x)
  const d = lim.latency
  for (let i = d; i < x.length; i++) assert.ok(Math.abs(y[i] - x[i - d]) < 1e-6)
  assert.equal(lim.takeReductionDb(), 0)
})

test('a loud sine never exceeds the ceiling', () => {
  const lim = new TruePeakLimiter({ sampleRate: SR, ceilingDb: -1 })
  const y = run(lim, sine(9600, 2, 220))
  assert.ok(peak(y) <= lim.ceiling + 1e-6)
  assert.ok(peak(y, 4800) > lim.ceiling * 0.95, 'limits to the ceiling, not far below it')
  assert.ok(lim.takeReductionDb() < -6)
})

test('a sudden transient is caught before it arrives (lookahead)', () => {
  const lim = new TruePeakLimiter({ sampleRate: SR, ceilingDb: -1 })
  const x = new Float32Array(4800)
  for (let i = 2400; i < 2600; i++) x[i] = 1.6
  const y = run(lim, x)
  assert.ok(peak(y) <= lim.ceiling + 1e-6)
})

test('inter-sample peaks are limited, not just sample peaks', () => {
  // fs/4 at 45°: samples sit at ±0.707·A while the waveform peaks at A.
  const A = 1.1
  const x = sine(9600, A, SR / 4, Math.PI / 4)
  assert.ok(peak(x) < 0.891, 'sample peaks alone are under a -1 dB ceiling')
  const lim = new TruePeakLimiter({ sampleRate: SR, ceilingDb: -1 })
  const y = run(lim, x)
  assert.ok(truePeak(y, 4800, 5000) <= lim.ceiling * 1.02)
})

test('gain recovers after the loud part ends', () => {
  const lim = new TruePeakLimiter({ sampleRate: SR, releaseMs: 50 })
  const loud = sine(4800, 2, 220)
  const quiet = sine(SR, 0.3, 220)
  const x = new Float32Array(loud.length + quiet.length)
  x.set(loud); x.set(quiet, loud.length)
  const y = run(lim, x)
  // Half a second later (10 release time constants) the quiet tone is back to unity.
  const from = loud.length + SR / 2
  assert.ok(Math.abs(peak(y, from) - 0.3) < 0.003)
})
