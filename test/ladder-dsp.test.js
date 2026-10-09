import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { BLOCK, FLAGS, MODES, ladderScenarios, renderScenarioWasm } from '../scripts/lib/ladderScenarios.js'

// Runs the committed Analog filter wasm directly: no worklet, no Tone.
// Native-vs-wasm lives in scripts/ladder_compare.js (needs a host compiler);
// these are properties the shipped artifact must have everywhere.

const manifest = JSON.parse(readFileSync(new URL('../public/wasm/ladder.manifest.json', import.meta.url), 'utf8'))
const bytes = readFileSync(new URL(`../public/wasm/${manifest.asset}`, import.meta.url))
const module = new WebAssembly.Module(bytes)

function instance(rate = 48000, mode = 0) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.ld_init(rate)
  x.ld_set_mode(mode, 0)
  const mem = x.memory.buffer
  const v = (p) => new Float32Array(mem, p, BLOCK)
  return { x, inL: v(x.ld_in_l()), inR: v(x.ld_in_r()), outL: v(x.ld_out_l()), outR: v(x.ld_out_r()),
    freq: v(x.ld_freq()), res: v(x.ld_res()), drive: v(x.ld_drive()) }
}

// Render `seconds` with constant params; input(frame) → [l, r] or a number (mono).
function render(d, rate, seconds, input, { cutoff = 1000, res = 0.2, drive = 1, stereo = true } = {}) {
  const n = Math.ceil(rate * seconds / BLOCK) * BLOCK
  const L = new Float32Array(n), R = new Float32Array(n)
  for (let off = 0; off < n; off += BLOCK) {
    d.freq[0] = cutoff; d.res[0] = res; d.drive[0] = drive
    for (let i = 0; i < BLOCK; i++) {
      const v = input ? input(off + i) : 0
      d.inL[i] = Array.isArray(v) ? v[0] : v
      d.inR[i] = Array.isArray(v) ? v[1] : v
    }
    d.x.ld_process(BLOCK, stereo ? FLAGS.stereo : 0)
    L.set(d.outL, off); R.set(d.outR, off)
  }
  return { L, R }
}
const rms = (a, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / Math.max(1, to - from))
}
const sine = (hz, rate, amp = 0.3) => (f) => amp * Math.sin(2 * Math.PI * hz * f / rate)

test('the artifact matches its manifest, has no imports and speaks ABI 1', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
  assert.equal(WebAssembly.Module.imports(module).length, 0)
  assert.equal(manifest.abiVersion, 1)
  assert.equal(new WebAssembly.Instance(module, {}).exports.ld_abi_version(), 1)
})

test('every scenario renders finite output', () => {
  for (const sc of ladderScenarios()) {
    const { out } = renderScenarioWasm(module, sc)
    for (let i = 0; i < out.length; i++) assert.ok(Number.isFinite(out[i]), `${sc.name}[${i}]`)
  }
})

test('the cutoff ceiling is min(20 kHz, 0.425 × rate)', () => {
  assert.equal(instance(44100).x.ld_max_cutoff(), Math.fround(0.425 * 44100))
  assert.equal(instance(48000).x.ld_max_cutoff(), 20000)
  assert.equal(instance(96000).x.ld_max_cutoff(), 20000)
})

test('left and right are independent: one silent channel stays exactly silent', () => {
  const rate = 48000
  const d = instance(rate)
  const s = sine(220, rate)
  const { L, R } = render(d, rate, 0.3, (f) => [s(f), 0], { res: 1.2, drive: 2 })
  assert.ok(rms(L) > 0.01)
  assert.ok(R.every(v => v === 0))
})

test('a mono input is duplicated into both channels', () => {
  const rate = 48000
  const d = instance(rate, 1)
  const { L, R } = render(d, rate, 0.3, sine(330, rate), { stereo: false, res: 0.9 })
  assert.ok(rms(L) > 0.01)
  assert.deepEqual(L, R)
})

test('responses: lowpass passes lows, highpass passes highs, bandpass the cutoff', () => {
  const rate = 48000
  const level = (mode, hz) => rms(render(instance(rate, mode), rate, 0.4, sine(hz, rate), { cutoff: 1000, res: 0 }).L, 4800)
  for (const [lp, hp] of [[0, 4], [1, 5]]) {
    assert.ok(level(lp, 100) > 4 * level(lp, 10000), `${MODES[lp]}`)
    assert.ok(level(hp, 10000) > 4 * level(hp, 100), `${MODES[hp]}`)
  }
  for (const bp of [2, 3]) {
    assert.ok(level(bp, 1000) > 2 * level(bp, 100), `${MODES[bp]} vs low`)
    assert.ok(level(bp, 1000) > 2 * level(bp, 10000), `${MODES[bp]} vs high`)
  }
  // 24 dB/oct rolls off harder than 12 dB/oct.
  assert.ok(level(0, 8000) < level(1, 8000))
})

test('high resonance self-oscillates after the input stops, and reset silences it', () => {
  const rate = 48000
  const d = instance(rate)
  const s = sine(110, rate)
  const before = render(d, rate, 0.2, s, { cutoff: 880, res: 1.8 })
  const ringing = render(d, rate, 0.5, null, { cutoff: 880, res: 1.8 })
  assert.ok(rms(before.L) > 0.01)
  assert.ok(rms(ringing.L, ringing.L.length - 4800) > 0.05, 'still oscillating 0.5 s after the input stopped')
  d.x.ld_reset()
  const after = render(d, rate, 0.2, null, { cutoff: 880, res: 1.8 })
  assert.ok(after.L.every(v => v === 0) && after.R.every(v => v === 0))
})

test('drive saturates: output grows less than the input does', () => {
  const rate = 48000
  const out = (amp, drive) => rms(render(instance(rate), rate, 0.3, sine(200, rate, amp), { cutoff: 5000, res: 0, drive }).L, 4800)
  const ratio = out(0.8, 4) / out(0.1, 4)
  assert.ok(ratio < 6, `8× input gave ${ratio.toFixed(2)}× output`)
})

test('nonfinite input resets the filter, counts a fault and outputs silence', () => {
  const rate = 48000
  const d = instance(rate)
  render(d, rate, 0.1, sine(220, rate), { res: 1.5 })
  const { L } = render(d, rate, 0.01, (f) => (f === 10 ? NaN : 0), { res: 1.5 })
  assert.ok(L.every(Number.isFinite))
  assert.ok(d.x.ld_fault_count() >= 1)
})

test('nonfinite and out-of-range parameters keep the filter finite', () => {
  const sc = ladderScenarios().find(s => s.name === 'bounds-48000')
  const { out, exports } = renderScenarioWasm(module, sc)
  assert.ok(out.every(Number.isFinite))
  assert.equal(exports.ld_fault_count(), 0)
})

test('a response crossfade ends on exactly the new response', () => {
  const rate = 48000
  const s = sine(150, rate)
  const fade = 960
  // Same input history → same ladder state; the response is only a weighting.
  const a = instance(rate, 0), b = instance(rate, 4)
  const opts = { cutoff: 1200, res: 0.6, drive: 1.5 }
  render(a, rate, 0.2, s, opts); render(b, rate, 0.2, s, opts)
  a.x.ld_set_mode(4, fade)
  const ya = render(a, rate, 0.1, s, opts).L
  const yb = render(b, rate, 0.1, s, opts).L
  for (let i = fade; i < ya.length; i++) assert.equal(ya[i], yb[i], `frame ${i}`)
  assert.equal(a.x.ld_mode(), 4)
})
