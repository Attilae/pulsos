import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  BLOCK, DEFAULT_PATCH, DSP_RATE, MACRO_SCENARIOS, NUM_ENGINES, renderScenarioWasm,
} from '../scripts/lib/macroScenarios.js'

// Runs the committed Macro wasm module (public/wasm) directly: no worklet, no
// Tone. The native-vs-wasm comparison needs a host compiler and lives in
// scripts/macro_compare.js; these are the properties that must hold for the
// shipped artifact on every machine.

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/macro.manifest.json', import.meta.url), 'utf8'))
const bytes = readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url))
const module = new WebAssembly.Module(bytes)

// patch: [harmonics, timbre, morph, fmAmt, timbreAmt, morphAmt, decay, colour, transpose]
function instance({ engine = 8, voices = 1, patch = DEFAULT_PATCH, aux = 0, seed = 1 } = {}) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.mc_init(seed)
  x.mc_set_voices(voices)
  x.mc_set_engine(engine, 1)
  x.mc_set_patch(...patch, 1)
  x.mc_set_aux(aux)
  return x
}

// Render `seconds`, calling `at(block)` before each block.
function render(x, seconds, at) {
  const blocks = Math.round((seconds * DSP_RATE) / BLOCK)
  const out = new Float32Array(blocks * BLOCK)
  const buf = new Float32Array(x.memory.buffer, x.mc_out(), BLOCK)
  for (let b = 0; b < blocks; b++) {
    at?.(b)
    x.mc_render()
    out.set(buf, b * BLOCK)
  }
  return out
}

const sec = (s) => Math.round(s * DSP_RATE)
const rms = (a, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / Math.max(1, to - from))
}
// Rising zero crossings over a steady stretch: robust on these single-period
// waveforms, and precise to well under a cent over a second and a half.
function zeroCrossHz(sig, from, to) {
  let first = -1, last = -1, n = 0
  for (let i = from + 1; i < to; i++) {
    if (sig[i - 1] < 0 && sig[i] >= 0) { if (first < 0) first = i; last = i; n++ }
  }
  return (n - 1) / ((last - first) / DSP_RATE)
}
const cents = (hz, ref) => 1200 * Math.log2(hz / ref)
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12)
// A sustained note: decay and colour at 1 keep the low-pass gate open.
const OPEN = [0.5, 0, 0.5, 0, 0, 0, 1, 1, 0]

test('the committed wasm matches its manifest and imports nothing', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  for (const name of ['mc_init', 'mc_trigger', 'mc_trigger_held', 'mc_release', 'mc_render', 'mc_panic',
    'mc_set_engine', 'mc_set_patch', 'mc_set_aux', 'mc_set_voices', 'mc_trigger_latency', 'mc_out']) {
    assert.ok(manifest.exports.includes(name), name)
  }
  const x = instance()
  assert.equal(x.mc_block_size(), BLOCK)
  assert.equal(x.mc_sample_rate(), DSP_RATE)
  assert.equal(x.mc_num_engines(), NUM_ENGINES)
  assert.equal(x.mc_max_voices(), 4)
  assert.equal(x.mc_trigger_latency(), 48)
})

test('every scenario renders finite, bounded audio without faults', () => {
  for (const sc of MACRO_SCENARIOS) {
    const { out, exports } = renderScenarioWasm(module, sc)
    let peak = 0
    for (const v of out) {
      assert.ok(Number.isFinite(v), `${sc.name}: non-finite sample`)
      peak = Math.max(peak, Math.abs(v))
    }
    assert.ok(peak > 0.05, `${sc.name}: silent`)
    assert.ok(peak < 2.5, `${sc.name}: runaway level (peak ${peak})`)
    assert.equal(exports.mc_fault_count(), 0, `${sc.name}: DSP faults`)
  }
})

test('renders are deterministic for a given seed', () => {
  for (const name of ['bank-3-tour', 'drums-modulated']) {
    const sc = MACRO_SCENARIOS.find(s => s.name === name)
    assert.deepEqual(renderScenarioWasm(module, sc).out, renderScenarioWasm(module, sc).out, name)
  }
})

test('every one of the 24 engines sounds on a note', () => {
  for (let engine = 0; engine < NUM_ENGINES; engine++) {
    const x = instance({ engine })
    const sig = render(x, 0.5, b => { if (b === 0) x.mc_trigger_held(48, 1, sec(0.2)) })
    assert.ok(rms(sig) > 0.005, `engine ${engine}: rms ${rms(sig)}`)
  }
})

test('tuning is within a cent of equal temperament (the 47872 Hz clock is corrected)', () => {
  // VA, waveshaping, 2-op FM and wavetable: plain single-period waveforms.
  for (const [engine, patch] of [[8, OPEN], [9, OPEN], [10, OPEN], [13, [0, 0, 0, 0, 0, 0, 1, 1, 0]]]) {
    for (const midi of [57, 69, 81]) {
      const x = instance({ engine, patch })
      const sig = render(x, 2, b => { if (b === 0) x.mc_trigger(midi, 1) })
      const c = cents(zeroCrossHz(sig, sec(0.5), sec(2)), midiHz(midi))
      assert.ok(Math.abs(c) < 1, `engine ${engine}, midi ${midi}: ${c.toFixed(2)} cents`)
    }
  }
})

test('the transpose (FREQUENCY) moves the pitch in semitones', () => {
  for (const st of [-7, 7, 12]) {
    const patch = [...OPEN]; patch[8] = st
    const x = instance({ engine: 8, patch })
    const sig = render(x, 2, b => { if (b === 0) x.mc_trigger(60, 1) })
    const c = cents(zeroCrossHz(sig, sec(0.5), sec(2)), midiHz(60 + st))
    assert.ok(Math.abs(c) < 1, `${st} st: ${c.toFixed(2)} cents`)
  }
})

test('a note sounds exactly mc_trigger_latency() samples after its block', () => {
  for (const engine of [8, 21]) {
    const x = instance({ engine })
    const sig = render(x, 0.1, b => { if (b === 10) x.mc_trigger(60, 1) })
    const onset = sig.findIndex(v => Math.abs(v) > 1e-3)
    assert.equal(onset, 10 * BLOCK + x.mc_trigger_latency(), `engine ${engine}`)
  }
})

test('the trigger is a gate: held 6-op notes sustain, released ones decay', () => {
  const sustained = (hold) => {
    const x = instance({ engine: 2, patch: [0.5, 0.5, 0.5, 0, 0, 0, 0.8, 0.5, 0] })
    const sig = render(x, 1.5, b => { if (b === 0) x.mc_trigger_held(60, 1, sec(hold)) })
    return rms(sig, sec(1), sec(1.4))
  }
  assert.ok(sustained(1.5) > 8 * sustained(0.05))

  const x = instance({ engine: 2, patch: [0.5, 0.5, 0.5, 0, 0, 0, 0.8, 0.5, 0] })
  const sig = render(x, 1.5, b => {
    if (b === 0) x.mc_trigger(60, 1)                       // held until released
    if (b === sec(0.05) / BLOCK) x.mc_release(60)
  })
  assert.ok(rms(sig, sec(1), sec(1.4)) < sustained(1.5) / 8, 'mc_release lowers the gate')
})

test('a note on a voice whose trigger is still high gets a new rising edge', () => {
  // One voice, a held bass drum: the second hit must re-strike it.
  const x = instance({ engine: 21, voices: 1, patch: [0.5, 0.5, 0.2, 0, 0, 0, 0.5, 0.5, 0] })
  const sig = render(x, 1.2, b => {
    if (b === 0) x.mc_trigger(36, 1)
    if (b === sec(0.6) / BLOCK) x.mc_trigger(36, 1)
  })
  assert.ok(rms(sig, sec(0.6), sec(0.7)) > 4 * rms(sig, sec(0.5), sec(0.6)), 'the drum was struck again')
})

test('voices are allocated idle-first and stolen oldest-first', () => {
  const x = instance({ voices: 2 })
  assert.equal(x.mc_trigger_held(60, 1, sec(1)), 0)
  assert.equal(x.mc_trigger_held(64, 1, sec(1)), 1)
  assert.equal(x.mc_trigger_held(67, 1, sec(1)), 0, 'steals the oldest')
  assert.equal(x.mc_voice_note(0), 67)
  x.mc_set_voices(1)
  assert.equal(x.mc_trigger(72, 1), 0, 'a shrunk pool still takes notes')
})

test('voices go idle once a note has rung out', () => {
  // Decay 0.3: the low-pass gate rings out in well under a second.
  const x = instance({ engine: 8, voices: 2, patch: [0.5, 0.5, 0.5, 0, 0, 0, 0.3, 0.5, 0] })
  render(x, 0.1, b => { if (b === 0) { x.mc_trigger_held(60, 1, sec(0.05)); x.mc_trigger_held(64, 1, sec(0.05)) } })
  assert.equal(x.mc_active_voices(), 2)
  render(x, 2)
  assert.equal(x.mc_active_voices(), 0)
})

test('an engine switch fades, defers notes behind the fade, and a panic drops them', () => {
  const x = instance({ engine: 8, voices: 2 })
  render(x, 0.2, b => { if (b === 0) x.mc_trigger(60, 1) })
  x.mc_set_engine(13, 0)
  assert.equal(x.mc_engine(), 8, 'switches after the fade-out')
  assert.equal(x.mc_trigger_held(62, 1, sec(0.2)), -1, 'deferred')
  render(x, 0.02)
  assert.equal(x.mc_engine(), 13)
  assert.equal(x.mc_active_voices(), 1, 'the deferred note started on the new engine')
  x.mc_panic()
  assert.equal(x.mc_trigger(64, 1), -2, 'a panic cancels notes during its fade')
  const tail = render(x, 0.5)
  assert.equal(x.mc_active_voices(), 0)
  assert.ok(rms(tail, sec(0.1)) < 1e-4)
})

test('AUX is a different signal from OUT', () => {
  const play = (aux) => {
    const x = instance({ engine: 10, aux })
    return render(x, 0.5, b => { if (b === 0) x.mc_trigger(48, 1) })
  }
  const out = play(0), aux = play(1)
  let diff = 0
  for (let i = 0; i < out.length; i++) diff += (out[i] - aux[i]) ** 2
  assert.ok(Math.sqrt(diff / out.length) > 0.01)
})

test('velocity scales the voice', () => {
  const play = (velocity) => {
    const x = instance({ engine: 8 })
    return rms(render(x, 0.3, b => { if (b === 0) x.mc_trigger(60, velocity) }))
  }
  const ratio = play(0.5) / play(1)
  assert.ok(Math.abs(ratio - 0.5) < 0.01, `ratio ${ratio}`)
})

test('bad input is clamped or rejected, never fatal', () => {
  const x = instance()
  assert.equal(x.mc_trigger(NaN, 1), -2)
  x.mc_set_patch(NaN, Infinity, -5, 9, -9, NaN, 2, -1, 1000, 1)
  x.mc_set_engine(99, 1)
  x.mc_set_engine(-1, 1)
  assert.equal(x.mc_engine(), 8)
  x.mc_set_aux(NaN)
  x.mc_trigger(-40, 9)
  x.mc_trigger(500, -1)
  const sig = render(x, 0.5)
  assert.ok(sig.every(Number.isFinite))
  assert.equal(x.mc_fault_count(), 0)
})
