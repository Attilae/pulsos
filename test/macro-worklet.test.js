import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { macroPatch } from '../lib/macroSpecs.js'

// The worklet file has no exports (see its header), so evaluate it the way
// standardized-audio-context does — as a function body — and pull the host class
// out. The real wasm module drives it, so these check the shipped pipeline:
// timestamp → DSP block (minus the trigger latency) → resampled output.

const source = readFileSync(new URL('../public/worklets/macro-processor.js', import.meta.url), 'utf8')
const { MacroHost } = new Function(`${source}\nreturn { MacroHost }`)()

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/macro.manifest.json', import.meta.url), 'utf8'))
const module = new WebAssembly.Module(readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url)))

const QUANTUM = 128
// Decay and colour at 1: the low-pass gate stays open, so notes sustain.
const OPEN = macroPatch({ macroHarmonics: 0.5, macroTimbre: 0, macroDecay: 1, macroColour: 1 })

function makeHost(sampleRate, opts = {}) {
  const x = new WebAssembly.Instance(module, {}).exports
  return new MacroHost(x, sampleRate, { seed: 3, voices: 2, engine: 8, patch: OPEN, ...opts })
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

function zeroCrossHz(sig, sampleRate) {
  let first = -1, last = -1, n = 0
  for (let i = 1; i < sig.length; i++) {
    if (sig[i - 1] < 0 && sig[i] >= 0) { if (first < 0) first = i; last = i; n++ }
  }
  return (n - 1) / ((last - first) / sampleRate)
}

const rms = (a, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / Math.max(1, to - from))
}
const firstOnset = (sig, threshold = 1e-3) => sig.findIndex(v => Math.abs(v) > threshold)

test('tuning holds at 44.1, 48 and 96 kHz host rates', () => {
  for (const sr of [44100, 48000, 96000]) {
    const host = makeHost(sr, { voices: 1 })
    host.note({ time: 0.01, midi: 57, velocity: 1, gen: 0 })
    const { L } = run(host, sr, 1.5)
    const hz = zeroCrossHz(L.subarray(Math.round(0.3 * sr), Math.round(1.5 * sr)), sr)
    const cents = 1200 * Math.log2(hz / 220)
    assert.ok(Math.abs(cents) < 2, `${sr} Hz host: ${hz.toFixed(3)} Hz (${cents.toFixed(2)} cents)`)
  }
})

test('the trigger latency is compensated: a note sounds on its timestamp', () => {
  for (const sr of [44100, 48000, 96000]) {
    for (const engine of [8, 21]) {
      for (const t of [0.05, 0.1234, 0.2001]) {
        for (const startFrame of [0, 12345]) {
          const host = makeHost(sr, { voices: 1, engine })
          const scheduled = t + startFrame / sr
          host.note({ time: scheduled, midi: 60, velocity: 1, gen: 0 }, startFrame)
          const { L } = run(host, sr, 0.3, { startFrame })
          const err = (startFrame + firstOnset(L)) / sr - scheduled
          // ±0.125 ms block rounding, plus a sample of interpolation either way.
          assert.ok(Math.abs(err) <= 0.000125 + 1.5 / sr, `${sr} Hz, engine ${engine}, t=${t}, origin=${startFrame}: ${(err * 1000).toFixed(3)} ms`)
        }
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

test('`hold` gates a sustaining engine for its length, at any host rate', () => {
  // 6-op FM sustains while the trigger is high.
  const patch = macroPatch({ macroDecay: 0.8 })
  for (const sr of [44100, 48000]) {
    const level = (hold) => {
      const host = makeHost(sr, { voices: 1, engine: 2, patch })
      host.note({ time: 0.05, midi: 60, velocity: 1, gen: 0, hold })
      const { L } = run(host, sr, 1.5)
      return rms(L, Math.round(1.0 * sr), Math.round(1.4 * sr))
    }
    assert.ok(level(1.4) > 8 * level(0.05), `${sr} Hz`)
  }
})

test('a release event is ordered with the notes and hits only its pitch', () => {
  const sr = 48000
  const host = makeHost(sr, { voices: 2, engine: 2 })
  host.release({ time: 0.3, midi: 64, gen: 0 })          // arrives first, scheduled later
  host.note({ time: 0.05, midi: 60, velocity: 1, gen: 0 })
  host.note({ time: 0.05, midi: 64, velocity: 1, gen: 0 })
  assert.deepEqual(host.queue.map(e => e.kind), ['note', 'note', 'release'])
  run(host, sr, 0.5)
  // The released voice's trigger is low; the other is still held.
  const held = [0, 1].filter(i => host.x.mc_voice_active(i) && host.x.mc_voice_note(i) === 60)
  assert.equal(held.length, 1)
  host.release({ time: 0.5, gen: 0 }, 0.5 * sr)          // no midi: everything
  run(host, sr, 0.05, { startFrame: 0.5 * sr })
  assert.equal(host.queue.length, 0)
})

test('releases obey generation cancel, but a late release is never dropped', () => {
  const sr = 48000
  const level = (lateRelease) => {
    const host = makeHost(sr, { voices: 1, engine: 2 })
    host.release({ time: 0.2, midi: 60, gen: 0 })
    host.cancel(1)
    assert.equal(host.queue.length, 0, 'cancelled with its generation')
    host.note({ time: 0.01, midi: 60, velocity: 1, gen: 1 })   // held: no `hold`
    run(host, sr, 0.5)
    if (lateRelease) host.release({ time: 0.1, midi: 60, gen: 1 }, 0.5 * sr)   // 400 ms late
    const { L } = run(host, sr, 2, { startFrame: 0.5 * sr })
    assert.equal(host.stats.dropped, 0)
    // This 6-op preset releases slowly (about -6 dB a second), so look late.
    return rms(L, Math.round(1.5 * sr), 2 * sr)
  }
  assert.ok(level(true) < level(false) / 3, 'the late release still lowered the gate')
})

test('both channels carry the same finite mono signal', () => {
  const sr = 44100
  const host = makeHost(sr, { voices: 4, engine: 14 })
  for (const [i, midi] of [48, 52, 55, 59].entries()) host.note({ time: 0.01 + i * 0.05, midi, velocity: 0.8, gen: 0 })
  const { L, R } = run(host, sr, 1)
  for (let i = 0; i < L.length; i++) {
    assert.ok(Number.isFinite(L[i]))
    assert.equal(L[i], R[i])
  }
  assert.ok(rms(L) > 0.01)
})

test('engine, patch and aux messages reach the DSP', () => {
  const sr = 48000
  const host = makeHost(sr, { voices: 1 })
  host.setEngine(13)
  run(host, sr, 0.02)
  assert.equal(host.x.mc_engine(), 13)
  const play = (setup) => {
    const h = makeHost(sr, { voices: 1, engine: 10 })
    setup(h)
    h.note({ time: 0.01, midi: 48, velocity: 1, gen: 0 })
    return run(h, sr, 0.3).L
  }
  const base = play(() => {})
  const differs = (a, b) => rms(a.map((v, i) => v - b[i])) > 0.005
  assert.ok(differs(base, play(h => h.setAux(1))), 'aux')
  assert.ok(differs(base, play(h => h.setPatch({ ...OPEN, timbre: 1 }, true))), 'patch')
})

test('panic and dispose silence the lane', () => {
  const sr = 48000
  const host = makeHost(sr)
  host.note({ time: 0.01, midi: 60, velocity: 1, gen: 0 })
  host.note({ time: 0.4, midi: 62, velocity: 1, gen: 0 })
  run(host, sr, 0.2)
  host.panic()
  assert.equal(host.queue.length, 0)
  const { L } = run(host, sr, 0.3, { startFrame: 0.2 * sr })
  assert.ok(rms(L, Math.round(0.02 * sr)) < 1e-4)
})
