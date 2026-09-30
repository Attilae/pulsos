import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { RESONATOR_SCENARIOS, renderScenarioWasm, BLOCK, DSP_RATE } from '../scripts/lib/resonatorScenarios.js'

// Runs the committed Resonator wasm module (public/wasm) directly — no worklet,
// no Tone. The native-vs-wasm comparison needs a host compiler and lives in
// scripts/resonator_compare.js; these are the properties that must hold for the
// shipped artifact on every machine.

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/resonator.manifest.json', import.meta.url), 'utf8'))
const bytes = readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url))
const module = new WebAssembly.Module(bytes)

const instance = () => new WebAssembly.Instance(module, {}).exports

function render(x, blocks) {
  const out = new Float32Array(blocks * BLOCK)
  const l = new Float32Array(x.memory.buffer, x.rs_out_l(), BLOCK)
  for (let b = 0; b < blocks; b++) {
    x.rs_render()
    out.set(l, b * BLOCK)
  }
  return out
}

// Fundamental by normalized autocorrelation over a plausible lag window.
function pitchHz(signal, sampleRate, minHz = 50, maxHz = 2000) {
  let best = 0, bestLag = 0
  const minLag = Math.floor(sampleRate / maxHz), maxLag = Math.ceil(sampleRate / minHz)
  const n = signal.length - maxLag
  const corr = new Float64Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let acc = 0, e1 = 0, e2 = 0
    for (let i = 0; i < n; i++) { acc += signal[i] * signal[i + lag]; e1 += signal[i] ** 2; e2 += signal[i + lag] ** 2 }
    corr[lag] = acc / Math.sqrt(e1 * e2 || 1)
  }
  // First strong peak, not the global max (which can land on 2× the period).
  const globalMax = Math.max(...corr.slice(minLag, maxLag + 1))
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > 0.9 * globalMax) { bestLag = lag; best = corr[lag]; break }
  }
  assert.ok(best > 0.5, `no clear period (corr ${best})`)
  // Parabolic refinement.
  const a = corr[bestLag - 1], b = corr[bestLag], c = corr[bestLag + 1]
  const shift = (a - c) / (2 * (a - 2 * b + c))
  return sampleRate / (bestLag + shift)
}

const cents = (hz, ref) => 1200 * Math.log2(hz / ref)

test('the committed wasm matches its manifest and imports nothing', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  for (const name of ['rs_init', 'rs_trigger', 'rs_trigger_held', 'rs_release', 'rs_set_envelope', 'rs_render', 'rs_panic', 'rs_set_model', 'rs_set_patch', 'rs_set_voices']) {
    assert.ok(manifest.exports.includes(name), name)
  }
})

test('the DSP runs at 48 kHz in 24-sample blocks', () => {
  const x = instance()
  x.rs_init(1)
  assert.equal(x.rs_sample_rate(), DSP_RATE)
  assert.equal(x.rs_block_size(), BLOCK)
  assert.equal(x.rs_max_voices(), 4)
})

test('every model is tuned to the requested MIDI note', () => {
  for (const [model, patch] of [[0, [0.25, 0.5, 0.7, 0.3]], [2, [0.25, 0.5, 0.7, 0.3]]]) {
    for (const midi of [45, 57, 69]) {
      const x = instance()
      x.rs_init(3)
      x.rs_set_voices(1)
      x.rs_set_model(model, 1)
      x.rs_set_patch(...patch, 1)
      x.rs_trigger(midi, 1)
      const sig = render(x, 2000).subarray(4800, 4800 + 9600)   // skip the strike
      const hz = pitchHz(sig, DSP_RATE)
      const want = 440 * 2 ** ((midi - 69) / 12)
      assert.ok(Math.abs(cents(hz, want)) < 10, `model ${model} midi ${midi}: ${hz.toFixed(2)} Hz vs ${want.toFixed(2)}`)
    }
  }
})

test('output stays finite and bounded at parameter extremes', () => {
  for (const sc of RESONATOR_SCENARIOS) {
    const out = renderScenarioWasm(module, sc)
    let peak = 0
    for (const v of out) {
      assert.ok(Number.isFinite(v), `${sc.name}: non-finite sample`)
      peak = Math.max(peak, Math.abs(v))
    }
    // Each voice is soft-limited to ~0.8 by upstream; four summed stay well under 4.
    assert.ok(peak < 2, `${sc.name}: peak ${peak}`)
  }
  for (const model of [0, 1, 2]) {
    for (const p of [[0, 0, 0, 0], [1, 1, 1, 1], [1, 0, 1, 0], [0, 1, 0, 1]]) {
      const x = instance()
      x.rs_init(9)
      x.rs_set_voices(4)
      x.rs_set_model(model, 1)
      x.rs_set_patch(...p, 1)
      for (const n of [12, 24, 60, 96, 120]) x.rs_trigger(n, 1)
      const out = render(x, 4000)
      assert.ok(out.every(Number.isFinite), `model ${model} patch ${p}`)
      assert.equal(x.rs_fault_count(), 0)
    }
  }
})

test('renders are deterministic for a seed', () => {
  const [a, b] = [renderScenarioWasm(module, RESONATOR_SCENARIOS[2]), renderScenarioWasm(module, RESONATOR_SCENARIOS[2])]
  assert.deepEqual(a, b)
})

test('invalid inputs are clamped or rejected, never propagated', () => {
  const x = instance()
  x.rs_init(1)
  x.rs_set_patch(NaN, Infinity, -5, 7, 1)
  assert.equal(x.rs_trigger(NaN, 1), -2)
  assert.ok(x.rs_trigger(60, NaN) >= 0)
  x.rs_set_model(99, 0)   // ignored
  x.rs_set_voices(0)      // clamps to 1
  const out = render(x, 200)
  assert.ok(out.every(Number.isFinite))
})

test('voices: idle first, then the oldest strike is stolen', () => {
  const x = instance()
  x.rs_init(1)
  x.rs_set_voices(2)
  assert.equal(x.rs_trigger(60, 1), 0)
  assert.equal(x.rs_trigger(64, 1), 1)
  assert.equal(x.rs_trigger(67, 1), 0)   // oldest (60) stolen
  assert.equal(x.rs_voice_note(0), 67)
  assert.equal(x.rs_trigger(72, 1), 1)   // now 64 is oldest
  // A four-note chord on a 4-voice pool keeps every member.
  const y = instance()
  y.rs_init(1)
  y.rs_set_voices(4)
  const got = [48, 52, 55, 59].map(n => y.rs_trigger(n, 0.8))
  assert.deepEqual(got, [0, 1, 2, 3])
  render(y, 1)
  assert.equal(y.rs_active_voices(), 4)
})

test('a new strike never rescales another voice', () => {
  // Voice 0 rings at full velocity; striking voice 1 softly must leave voice 0's
  // contribution untouched. Compare against the same render without the 2nd strike.
  const run = (second) => {
    const x = instance()
    x.rs_init(4)
    x.rs_set_voices(2)
    x.rs_set_model(0, 1)
    x.rs_set_patch(0.4, 0.5, 0.8, 0.4, 1)
    x.rs_trigger(48, 1)
    render(x, 100)
    if (second) x.rs_trigger(72, 0)   // velocity 0: excites a silent voice
    return render(x, 200)
  }
  assert.deepEqual(run(false), run(true))
})

test('ringing voices go idle once inaudible, and a panic silences everything', () => {
  const x = instance()
  x.rs_init(1)
  x.rs_set_voices(2)
  x.rs_set_patch(0.4, 0.5, 0.1, 0.4, 1)   // short decay
  x.rs_trigger(60, 1)
  render(x, 10)
  assert.equal(x.rs_active_voices(), 1)
  render(x, (DSP_RATE * 4) / BLOCK)
  assert.equal(x.rs_active_voices(), 0)

  x.rs_set_patch(0.4, 0.5, 1, 0.4, 1)     // long decay
  x.rs_trigger(60, 1)
  render(x, 100)
  x.rs_panic()
  assert.equal(x.rs_trigger(64, 1), -2, 'a strike during a panic fade is cancelled')
  const tail = render(x, 20)              // fade (240 samples = 10 blocks) then reset
  assert.equal(x.rs_active_voices(), 0)
  assert.ok(tail.subarray(12 * BLOCK).every(v => v === 0))
})

test('a model switch fades out, resets, and plays the next strike on the new model', () => {
  const x = instance()
  x.rs_init(1)
  x.rs_set_voices(2)
  x.rs_set_patch(0.4, 0.5, 0.9, 0.4, 1)
  x.rs_trigger(60, 1)
  const before = render(x, 100)
  x.rs_set_model(2, 0)
  assert.equal(x.rs_trigger(62, 1), -1, 'deferred behind the fade')
  const rendered = render(x, 30)
  // Declicked: across the fade-out (240 samples) and into the reset, no sample
  // jumps by more than the ringing signal itself does. (The new strike's own
  // attack, after the fade, is allowed to be sharp.)
  const fade = Float32Array.of(before[before.length - 1], ...rendered.subarray(0, 10 * BLOCK + 1))
  let maxStep = 0
  for (let i = 1; i < fade.length; i++) maxStep = Math.max(maxStep, Math.abs(fade[i] - fade[i - 1]))
  let ringStep = 0
  for (let i = 1; i < before.length; i++) ringStep = Math.max(ringStep, Math.abs(before[i] - before[i - 1]))
  assert.ok(maxStep <= ringStep + 1e-3, `step ${maxStep} vs ${ringStep}`)
  assert.ok(Math.abs(fade[fade.length - 1]) < 1e-6, 'silent at the reset point')
  assert.equal(x.rs_active_voices(), 1)
  assert.equal(x.rs_voice_note(0), 62)
})

// ── Envelope + bow ────────────────────────────────────────────────────────────

const ENV = (over = {}) => {
  const e = { on: 1, a: 0.005, d: 0.2, s: 0.7, r: 0.3, bow: 0, strike: 1, ...over }
  return [e.on, e.a, e.d, e.s, e.r, e.bow, e.strike]
}

function enveloped(env, { seed = 5, voices = 2, model = 0, patch = [0.4, 0.5, 0.9, 0.4] } = {}) {
  const x = instance()
  x.rs_init(seed)
  x.rs_set_voices(voices)
  x.rs_set_model(model, 1)
  x.rs_set_patch(...patch, 1)
  if (env) x.rs_set_envelope(...env)
  return x
}

// RMS of consecutive windows of `win` samples.
function rmsWindows(sig, win) {
  const out = []
  for (let i = 0; i + win <= sig.length; i += win) {
    let acc = 0
    for (let j = i; j < i + win; j++) acc += sig[j] * sig[j]
    out.push(Math.sqrt(acc / win))
  }
  return out
}

test('with the envelope off, output is identical to never setting it', () => {
  // The envelope-less scenarios have no `envelope` field; setting it off with
  // arbitrary other values must not change a sample.
  for (const sc of RESONATOR_SCENARIOS.filter(s => !s.envelope)) {
    const plain = renderScenarioWasm(module, sc)
    const off = renderScenarioWasm(module, { ...sc, envelope: [0, 2, 1, 0.1, 5, 1, 0] })
    assert.deepEqual(off, plain, sc.name)
  }
})

test('the attack ramps a bowed note up instead of striking it', () => {
  const x = enveloped(ENV({ a: 0.5, s: 1, bow: 0.8, strike: 0 }), { model: 2 })
  x.rs_trigger(57, 1)
  const out = render(x, (DSP_RATE * 1) / BLOCK)
  const rms = rmsWindows(out, 2400)   // 50 ms windows
  assert.ok(rms[0] < rms[4] && rms[4] < rms[9], `rises over the 0.5 s attack: ${rms.slice(0, 10).map(v => v.toFixed(4))}`)
  assert.ok(rms[15] > 0.01, 'sustains while held')
  // Still in tune while bowed.
  const hz = pitchHz(out.subarray(DSP_RATE * 0.6), DSP_RATE)
  assert.ok(Math.abs(cents(hz, 220)) < 15, `${hz} Hz`)
})

test('a held note releases after its hold time, not before', () => {
  const holdSec = 0.4
  const x = enveloped(ENV({ s: 1, r: 0.05, bow: 0.8, strike: 0 }), { voices: 1, model: 0 })
  x.rs_trigger_held(60, 1, Math.round(holdSec * DSP_RATE))
  const out = render(x, (DSP_RATE * 1) / BLOCK)
  const rms = rmsWindows(out, 480)    // 10 ms windows
  const at = (sec) => rms[Math.round(sec * 100)]
  assert.ok(at(0.35) > 0.01, 'still sounding just before the hold ends')
  assert.ok(at(0.55) < at(0.35) * 0.01, `released by 0.15 s after it (${at(0.55)} vs ${at(0.35)})`)
  assert.equal(x.rs_active_voices(), 0, 'the voice frees itself once the release has run out')
})

test('rs_release ends only the matching note; a negative note releases all', () => {
  const x = enveloped(ENV({ s: 1, r: 0.02, bow: 0.8, strike: 0 }), { voices: 2 })
  x.rs_trigger(48, 1)
  x.rs_trigger(67, 1)
  render(x, 200)
  x.rs_release(67)
  render(x, 200)
  assert.equal(x.rs_active_voices(), 1)
  assert.equal(x.rs_voice_note(0), 48)
  x.rs_release(-1)
  render(x, 200)
  assert.equal(x.rs_active_voices(), 0)
})

test('a release never cuts a voice struck without the envelope', () => {
  const run = (release) => {
    const x = enveloped(null)
    x.rs_trigger(60, 1)
    render(x, 50)
    if (release) x.rs_release(-1)
    return render(x, 400)
  }
  assert.deepEqual(run(true), run(false))
})

test('strike off with no bow is silent; the bow alone sounds', () => {
  const silent = enveloped(ENV({ bow: 0, strike: 0 }))
  silent.rs_trigger(60, 1)
  assert.ok(render(silent, 400).every(v => v === 0))
  const bowed = enveloped(ENV({ bow: 0.6, strike: 0 }))
  bowed.rs_trigger(60, 1)
  const out = render(bowed, 400)
  assert.ok(Math.max(...out.map(Math.abs)) > 0.01)
  assert.ok(out.every(Number.isFinite))
})

test('stealing a sustaining voice ramps rather than clicks', () => {
  const x = enveloped(ENV({ a: 0.01, s: 1, bow: 0.8, strike: 0 }), { voices: 1, model: 0 })
  x.rs_trigger(60, 1)
  const before = render(x, 400)
  x.rs_trigger(64, 1)
  const after = render(x, 20)
  let ring = 0
  for (let i = 1; i < before.length; i++) ring = Math.max(ring, Math.abs(before[i] - before[i - 1]))
  let step = Math.abs(after[0] - before[before.length - 1])
  for (let i = 1; i < after.length; i++) step = Math.max(step, Math.abs(after[i] - after[i - 1]))
  assert.ok(step <= ring * 1.5 + 1e-3, `step ${step} vs ring ${ring}`)
})

test('enveloped renders are deterministic and bounded at extremes', () => {
  for (const sc of RESONATOR_SCENARIOS.filter(s => s.envelope)) {
    assert.deepEqual(renderScenarioWasm(module, sc), renderScenarioWasm(module, sc), sc.name)
  }
  for (const model of [0, 1, 2]) {
    const x = enveloped(ENV({ a: 0.001, d: 0.001, s: 1, r: 8, bow: 1, strike: 1 }), { voices: 4, model, patch: [1, 1, 1, 1] })
    for (const n of [12, 24, 60, 120]) x.rs_trigger(n, 1)
    const out = render(x, 4000)
    assert.ok(out.every(Number.isFinite), `model ${model}`)
    assert.ok(Math.max(...out.map(Math.abs)) < 2, `model ${model} bounded`)
    assert.equal(x.rs_fault_count(), 0)
  }
  // Junk settings are clamped, never propagated.
  const y = enveloped([1, NaN, -1, 7, Infinity, NaN, 1])
  y.rs_trigger(60, 1)
  assert.ok(render(y, 400).every(Number.isFinite))
})
