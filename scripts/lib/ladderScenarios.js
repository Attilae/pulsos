// Deterministic render scenarios for the Analog filter bridge (dsp/ladder),
// shared by the native-vs-wasm comparison (scripts/ladder_compare.js) and the
// wasm tests (test/ladder-dsp.test.js). Pure: no fs, no Tone.
//
// Every per-sample value (input and parameters) is generated here once into a
// Float32Array and fed byte-for-byte to both renderers, so a mismatch can only
// come from the DSP itself.

export const BLOCK = 128
export const FLAGS = { stereo: 1, freq: 2, res: 4, drive: 8 }
export const ALL_PER_SAMPLE = FLAGS.stereo | FLAGS.freq | FLAGS.res | FLAGS.drive
export const MODES = ['LP24', 'LP12', 'BP24', 'BP12', 'HP24', 'HP12']
export const RATES = [44100, 48000, 96000]

// A band-limited saw melody on the left, a detuned pulse on the right, so
// channel crosstalk would show up in the comparison.
function source(rate, seconds, { mono = false, silenceAfter = Infinity } = {}) {
  const n = Math.round(seconds * rate)
  const l = new Float32Array(n), r = new Float32Array(n)
  const notes = [55, 82.41, 110, 65.41]
  for (let i = 0; i < n; i++) {
    const t = i / rate
    if (t >= silenceAfter) continue
    const k = Math.floor(t / 0.25)
    const hz = notes[k % notes.length]
    const tn = t - k * 0.25
    const env = Math.min(tn / 0.004, 1) * Math.exp(-tn / 0.4)
    let saw = 0, pulse = 0
    for (let h = 1; h * hz < rate * 0.45 && h < 40; h++) {
      saw += Math.sin(2 * Math.PI * hz * h * t) / h
      if (h % 2) pulse += Math.sin(2 * Math.PI * hz * 1.01 * h * t) / h
    }
    l[i] = 0.4 * saw * env
    r[i] = mono ? l[i] : 0.4 * pulse * env
  }
  return { l, r }
}

// Interleaved inL, inR, cutoff, resonance, drive per sample.
function frames(rate, seconds, { cutoff, res, drive, mono, silenceAfter }) {
  const { l, r } = source(rate, seconds, { mono, silenceAfter })
  const n = l.length
  const out = new Float32Array(n * 5)
  for (let i = 0; i < n; i++) {
    const u = i / n
    out[i * 5] = l[i]
    out[i * 5 + 1] = r[i]
    out[i * 5 + 2] = cutoff(u)
    out[i * 5 + 3] = res(u)
    out[i * 5 + 4] = drive(u)
  }
  return out
}

const sweep = (lo, hi) => (u) => lo * Math.pow(hi / lo, 0.5 - 0.5 * Math.cos(2 * Math.PI * u))
const constant = (v) => () => v
const lerp = (a, b) => (u) => a + (b - a) * u

const blocksFor = (rate, seconds) => Math.ceil(Math.round(rate * seconds) / BLOCK)

export function ladderScenarios() {
  const list = []
  for (const rate of RATES) {
    MODES.forEach((m, mode) => {
      const seconds = 1
      list.push({
        name: `${m}-${rate}-sweep`, rate, mode, flags: ALL_PER_SAMPLE, events: [],
        blocks: blocksFor(rate, seconds),
        frames: frames(rate, seconds, { cutoff: sweep(60, 18000), res: lerp(0, 1.6), drive: lerp(0.5, 4) }),
      })
    })
    // Self-oscillation: high resonance, input stops, then a reset silences it.
    list.push({
      name: `selfosc-reset-${rate}`, rate, mode: 0, flags: ALL_PER_SAMPLE,
      events: [[blocksFor(rate, 0.8), 'reset']],
      blocks: blocksFor(rate, 1),
      frames: frames(rate, 1, { cutoff: constant(880), res: constant(1.8), drive: constant(1), silenceAfter: 0.3 }),
    })
  }
  // Mono input duplicated by the bridge (stereo flag off), constant params.
  list.push({
    name: 'mono-constant-48000', rate: 48000, mode: 1, flags: 0, events: [],
    blocks: blocksFor(48000, 0.5),
    frames: frames(48000, 0.5, { cutoff: constant(1200), res: constant(0.9), drive: constant(2), mono: true }),
  })
  // Response crossfades (20 ms) mid-note, including a change during a fade.
  list.push({
    name: 'mode-crossfades-48000', rate: 48000, mode: 0, flags: ALL_PER_SAMPLE,
    events: [[100, 'mode', 4, 960], [104, 'mode', 2, 960], [250, 'mode', 1, 960], [300, 'mode', 5, 0]],
    blocks: blocksFor(48000, 1),
    frames: frames(48000, 1, { cutoff: constant(1500), res: constant(1.1), drive: constant(1.5) }),
  })
  // Out-of-range and nonfinite parameters are clamped / ignored.
  const wild = frames(48000, 0.25, { cutoff: constant(30000), res: constant(5), drive: constant(9) })
  for (let i = 1000; i < 2000; i++) { wild[i * 5 + 2] = NaN; wild[i * 5 + 3] = Infinity; wild[i * 5 + 4] = -Infinity }
  for (let i = 5000; i < 6000; i++) wild[i * 5 + 2] = 1
  list.push({ name: 'bounds-48000', rate: 48000, mode: 0, flags: ALL_PER_SAMPLE, events: [], blocks: blocksFor(48000, 0.25), frames: wild })
  return list
}

export function scenarioText(sc) {
  const lines = [`rate ${sc.rate}`, `flags ${sc.flags}`, `mode ${sc.mode}`]
  for (const [block, kind, ...args] of sc.events) lines.push(`at ${block} ${kind} ${args.join(' ')}`.trim())
  lines.push(`blocks ${sc.blocks}`)
  return lines.join('\n') + '\n'
}

// Same call sequence as dsp/ladder/reference.cc. Returns interleaved outL, outR.
export function renderScenarioWasm(module, sc) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.ld_init(sc.rate)
  x.ld_set_mode(sc.mode, 0)
  const mem = x.memory.buffer
  const view = (ptr) => new Float32Array(mem, ptr, BLOCK)
  const inL = view(x.ld_in_l()), inR = view(x.ld_in_r())
  const outL = view(x.ld_out_l()), outR = view(x.ld_out_r())
  const freq = view(x.ld_freq()), res = view(x.ld_res()), drive = view(x.ld_drive())
  const f = sc.frames
  const out = new Float32Array(sc.blocks * BLOCK * 2)
  const events = [...sc.events].sort((a, b) => a[0] - b[0])
  let next = 0
  for (let b = 0; b < sc.blocks; b++) {
    while (next < events.length && events[next][0] === b) {
      const [, kind, ...a] = events[next++]
      if (kind === 'mode') x.ld_set_mode(a[0], a[1])
      else if (kind === 'reset') x.ld_reset()
    }
    for (let i = 0; i < BLOCK; i++) {
      const k = (b * BLOCK + i) * 5
      const ok = k + 4 < f.length
      inL[i] = ok ? f[k] : 0
      inR[i] = ok ? f[k + 1] : 0
      freq[i] = ok ? f[k + 2] : 20000
      res[i] = ok ? f[k + 3] : 0
      drive[i] = ok ? f[k + 4] : 1
    }
    x.ld_process(BLOCK, sc.flags)
    for (let i = 0; i < BLOCK; i++) {
      out[(b * BLOCK + i) * 2] = outL[i]
      out[(b * BLOCK + i) * 2 + 1] = outR[i]
    }
  }
  return { out, exports: x }
}
