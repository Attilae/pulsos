import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The worklet file has no exports (see its header), so evaluate it the way
// standardized-audio-context does — as a function body — and pull the host class
// out. The real wasm module drives it, so these check the shipped pipeline:
// timestamp → DSP block → resampled output.

const source = readFileSync(new URL('../public/worklets/resonator-processor.js', import.meta.url), 'utf8')
const { ResonatorHost } = new Function(`${source}\nreturn { ResonatorHost }`)()

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/resonator.manifest.json', import.meta.url), 'utf8'))
const module = new WebAssembly.Module(readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url)))

const QUANTUM = 128
const patch = { structure: 0.25, brightness: 0.5, damping: 0.7, position: 0.3 }

function makeHost(sampleRate, opts = {}) {
  const x = new WebAssembly.Instance(module, {}).exports
  return new ResonatorHost(x, sampleRate, { seed: 3, voices: 2, model: 0, patch, ...opts })
}

// Render `seconds` in 128-frame quanta from context frame `startFrame`, calling
// `beforeQuantum(frame)` so tests can post messages the way the port would.
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

function pitchHz(signal, sampleRate) {
  const minLag = Math.floor(sampleRate / 2000), maxLag = Math.ceil(sampleRate / 50)
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

const firstOnset = (sig, threshold = 1e-4) => sig.findIndex(v => Math.abs(v) > threshold)

test('tuning holds at 44.1, 48 and 96 kHz host rates', () => {
  for (const sr of [44100, 48000, 96000]) {
    const host = makeHost(sr, { voices: 1 })
    host.note({ time: 0.01, midi: 57, velocity: 1, gen: 0 })
    const { L } = run(host, sr, 0.5)
    const hz = pitchHz(L.subarray(Math.round(0.1 * sr), Math.round(0.4 * sr)), sr)
    const cents = 1200 * Math.log2(hz / 220)
    assert.ok(Math.abs(cents) < 10, `${sr} Hz host: ${hz.toFixed(2)} Hz (${cents.toFixed(1)} cents)`)
  }
})

test('a note lands within a quarter millisecond of its timestamp, at any host rate', () => {
  // Reference: the same strike at DSP time 0 — its own onset latency (the strike
  // filter) is part of the instrument, not scheduling error.
  const onsetOf = (sr, time, startFrame) => {
    const host = makeHost(sr, { voices: 1 })
    host.note({ time, midi: 60, velocity: 1, gen: 0 }, startFrame)
    const { L } = run(host, sr, 0.3, { startFrame })
    return (startFrame + firstOnset(L)) / sr
  }
  for (const sr of [44100, 48000]) {
    const base = onsetOf(sr, 0, 0)            // strike at t = 0
    for (const t of [0.05, 0.1234, 0.2001]) {
      for (const startFrame of [0, 12345]) {
        const scheduled = t + startFrame / sr
        const err = onsetOf(sr, scheduled, startFrame) - scheduled - base
        assert.ok(Math.abs(err) <= 0.00026, `${sr} Hz, t=${t}, origin=${startFrame}: ${(err * 1000).toFixed(3)} ms`)
      }
    }
  }
})

test('queued notes play in time order regardless of arrival order', () => {
  const host = makeHost(48000)
  host.note({ time: 0.2, midi: 64, velocity: 1, gen: 0 })
  host.note({ time: 0.1, midi: 60, velocity: 1, gen: 0 })
  assert.deepEqual(host.queue.map(e => e.midi), [60, 64])
  host.note({ time: 0.1, midi: 67, velocity: 1, gen: 0 })   // same block: after 60
  assert.deepEqual(host.queue.map(e => e.midi), [60, 67, 64])
})

test('cancel drops queued notes from older generations only', () => {
  const host = makeHost(48000)
  host.note({ time: 0.1, midi: 60, velocity: 1, gen: 1 })
  host.note({ time: 0.2, midi: 62, velocity: 1, gen: 2 })
  host.cancel(2)
  assert.deepEqual(host.queue.map(e => e.midi), [62])
  assert.equal(host.note({ time: 0.3, midi: 64, velocity: 1, gen: 1 }), false, 'stale generation rejected')
  const { L } = run(host, 48000, 0.15)
  assert.ok(L.every(v => v === 0), 'the cancelled note never sounded')
})

test('late notes play at once; stale ones are dropped instead of bursting after a stall', () => {
  const sr = 48000
  const host = makeHost(sr)
  run(host, sr, 0.5)                         // DSP has advanced to 0.5 s
  host.note({ time: 0.48, midi: 60, velocity: 1, gen: 0 }, 0.5 * sr)   // 20 ms late
  host.note({ time: 0.2, midi: 62, velocity: 1, gen: 0 }, 0.5 * sr)    // 300 ms late
  run(host, sr, 0.05, { startFrame: 0.5 * sr })
  assert.equal(host.stats.late, 1)
  assert.equal(host.stats.dropped, 1)
})

test('the queue is bounded', () => {
  const host = makeHost(48000)
  for (let i = 0; i < 300; i++) host.note({ time: 1 + i * 0.01, midi: 60, velocity: 1, gen: 0 })
  assert.equal(host.queue.length, 256)
  assert.equal(host.stats.overflow, 44)
})

test('output is stereo, mono-compatible and finite', () => {
  const sr = 44100
  const host = makeHost(sr, { model: 1, voices: 4 })
  for (const [i, midi] of [48, 52, 55, 59].entries()) host.note({ time: 0.01 + i * 0.05, midi, velocity: 0.8, gen: 0 })
  const { L, R } = run(host, sr, 1)
  let diff = 0, sum = 0
  for (let i = 0; i < L.length; i++) {
    assert.ok(Number.isFinite(L[i]) && Number.isFinite(R[i]))
    diff += (L[i] - R[i]) ** 2
    sum += (L[i] + R[i]) ** 2
  }
  assert.ok(diff > 0, 'channels differ (stereo)')
  assert.ok(sum > diff, 'the mono sum carries more energy than the side signal')
})

// ── Envelope: hold, release, settings ─────────────────────────────────────────

const ENVELOPE = { enabled: true, attack: 0.005, decay: 0.1, sustain: 1, release: 0.02, bow: 0.8, strike: false }

// Seconds at which the signal (in `win`-sample RMS windows) last exceeds `floor`.
function lastAudible(sig, sampleRate, floor = 1e-3, win = 240) {
  let last = -1
  for (let i = 0; i + win <= sig.length; i += win) {
    let acc = 0
    for (let j = i; j < i + win; j++) acc += sig[j] * sig[j]
    if (Math.sqrt(acc / win) > floor) last = i + win
  }
  return last / sampleRate
}

test('envelope settings from processorOptions reach the DSP', () => {
  const quiet = makeHost(48000, { envelope: { ...ENVELOPE, bow: 0, strike: false } })
  quiet.note({ time: 0.01, midi: 60, velocity: 1, gen: 0 })
  assert.ok(run(quiet, 48000, 0.3).L.every(v => v === 0), 'no strike, no bow: silent')
  const loud = makeHost(48000)
  loud.setEnvelope({ ...ENVELOPE })
  loud.note({ time: 0.01, midi: 60, velocity: 1, gen: 0 })
  assert.ok(run(loud, 48000, 0.3).L.some(v => Math.abs(v) > 0.01))
})

test('`hold` ends a note on time, at any host rate', () => {
  for (const sr of [44100, 48000]) {
    const host = makeHost(sr, { envelope: ENVELOPE, voices: 1 })
    host.note({ time: 0.05, midi: 60, velocity: 1, gen: 0, hold: 0.3 })
    const end = lastAudible(run(host, sr, 0.8).L, sr)
    // Released at 0.35 s; a 20 ms release falls below -60 dB well within 30 ms.
    assert.ok(end > 0.34 && end < 0.4, `${sr} Hz: last audible at ${end.toFixed(3)} s`)
  }
})

test('a release event is ordered with the notes and hits only its pitch', () => {
  const sr = 48000
  const host = makeHost(sr, { envelope: ENVELOPE, voices: 2 })
  host.release({ time: 0.3, midi: 64, gen: 0 })          // arrives first, scheduled later
  host.note({ time: 0.05, midi: 60, velocity: 1, gen: 0 })
  host.note({ time: 0.05, midi: 64, velocity: 1, gen: 0 })
  assert.deepEqual(host.queue.map(e => e.kind), ['note', 'note', 'release'])
  run(host, sr, 0.5)
  assert.equal(host.x.rs_active_voices(), 1)
  assert.equal(host.x.rs_voice_note(0), 60)
  host.release({ time: 0.5, gen: 0 }, 0.5 * sr)          // no midi: everything
  run(host, sr, 0.3, { startFrame: 0.5 * sr })
  assert.equal(host.x.rs_active_voices(), 0)
})

test('releases obey generation cancel, but a late release is never dropped', () => {
  const sr = 48000
  const host = makeHost(sr, { envelope: ENVELOPE, voices: 1 })
  host.release({ time: 0.2, midi: 60, gen: 0 })
  host.cancel(1)
  assert.equal(host.queue.length, 0, 'cancelled with its generation')
  host.note({ time: 0.01, midi: 60, velocity: 1, gen: 1 })
  run(host, sr, 0.5)
  host.release({ time: 0.1, midi: 60, gen: 1 }, 0.5 * sr)   // 400 ms late
  run(host, sr, 0.3, { startFrame: 0.5 * sr })
  assert.equal(host.stats.dropped, 0)
  assert.equal(host.x.rs_active_voices(), 0, 'the late release still ended the note')
})
