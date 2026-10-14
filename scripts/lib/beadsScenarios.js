// Deterministic render scenarios for the Texture Mk II (Beads) bridge, shared by
// the native-vs-wasm comparison (scripts/beads_compare.js) and the wasm tests
// (test/beads-dsp.test.js). Pure: no fs, no Tone.

export const BLOCK_RATE = 4000                    // blocks per second at every quality
export const MAX_BLOCK = 12
// bd_set_quality / beads::Processor::Media order.
export const QUALITY = { dirtyTape: 0, cleanTape: 1, vintage: 2, hifi: 3 }
export const QUALITY_RATE = [24000, 48000, 32000, 48000]

// Lane-like input: plucked, band-limited saw notes (a short melody), mono.
export function testInput(rate, seconds = 4, notes = [220, 277.18, 329.63, 440], noteSec = 0.5) {
  const n = Math.round(seconds * rate)
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const k = Math.floor(t / noteSec)
    const hz = notes[k % notes.length]
    const tn = t - k * noteSec
    const env = Math.min(tn / 0.005, 1) * Math.exp(-tn / 0.25)
    let v = 0
    for (let h = 1; h < 10 && hz * h < rate / 2; h++) v += Math.sin(2 * Math.PI * hz * h * t) / h
    s[i] = 0.3 * v * env
  }
  return s
}

// Lane notes on SEED: high at the note's block (and `offset` samples in), low
// `hold` blocks later. Matches testInput's note grid at noteSec = 0.5.
export function noteGates({ start = 0, every = 2000, hold = 400, count = 8, offset = 3 } = {}) {
  const ev = []
  for (let i = 0; i < count; i++) {
    const b = start + i * every
    ev.push([b, 'gate', offset, 1], [b + hold, 'gate', offset, 0])
  }
  return ev
}

// params: [time, size, shape, pitch, timeAmt, sizeAmt, shapeAmt, pitchAmt,
//          density, feedback, dryWet, reverb, inGain, freeze]
// Knob positions 0..1; attenuverters and PITCH are centred at 0.5.
export const NEUTRAL = [0.3, 0.6, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7, 0, 0.8, 0, 1, 0]
const p = (over) => NEUTRAL.map((v, i) => (i in over ? over[i] : v))

const SECONDS = 4
const BLOCKS = SECONDS * BLOCK_RATE

export const BEADS_SCENARIOS = [
  { name: 'hifi-free-running', seed: 1, quality: QUALITY.hifi, seedmode: [2, 0], params: NEUTRAL,
    events: [], blocks: BLOCKS },
  { name: 'clean-tape-note-gates', seed: 2, quality: QUALITY.cleanTape, seedmode: [0, 1],
    params: p({ 0: 0.15, 1: 0.4, 8: 0.25 }), events: noteGates(), blocks: BLOCKS },
  { name: 'vintage-note-clock', seed: 3, quality: QUALITY.vintage, seedmode: [2, 1],
    params: p({ 1: 0.35, 2: 0.2, 8: 0.3 }), events: noteGates({ every: 500, hold: 100, count: 32 }), blocks: BLOCKS },
  { name: 'dirty-tape-randomized', seed: 4, quality: QUALITY.dirtyTape, seedmode: [2, 0],
    params: p({ 3: 0.8, 4: 0.9, 5: 0.1, 6: 0.8, 7: 0.2, 8: 0.85, 11: 0.4 }), events: [], blocks: BLOCKS },
  { name: 'hifi-delay-mode', seed: 5, quality: QUALITY.hifi, seedmode: [2, 1],
    params: p({ 0: 0.4, 1: 1, 2: 0.3, 8: 0.5, 9: 0.6, 10: 0.6 }), events: noteGates({ every: 1000, hold: 200, count: 16 }),
    blocks: BLOCKS },
  { name: 'freeze-feedback-reverb', seed: 6, quality: QUALITY.hifi, seedmode: [2, 0],
    params: p({ 9: 0.5, 11: 0.6 }),
    events: [[5000, 'params', ...p({ 9: 0.5, 11: 0.6, 13: 1 })], [11000, 'params', ...p({})]], blocks: BLOCKS },
  { name: 'quality-switch-reset', seed: 7, quality: QUALITY.hifi, seedmode: [2, 0],
    params: [1, 0.9, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 4, 0],
    events: [[3000, 'quality', QUALITY.dirtyTape], [6000, 'quality', QUALITY.vintage],
             [8000, 'params', 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0.125, 0], [9000, 'quality', QUALITY.cleanTape],
             [11000, 'reset'], [12000, 'seedmode', 0, 1], [12001, 'gate', 0, 1], [13000, 'gate', 5, 0]],
    blocks: BLOCKS },
]

export function scenarioText(sc) {
  const lines = [`seed ${sc.seed}`, `quality ${sc.quality}`, `seedmode ${sc.seedmode.join(' ')}`, `params ${sc.params.join(' ')}`]
  for (const [block, kind, ...args] of [...sc.events].sort((a, b) => a[0] - b[0])) {
    lines.push(`at ${block} ${kind} ${args.join(' ')}`.trim())
  }
  lines.push(`blocks ${sc.blocks}`)
  return lines.join('\n') + '\n'
}

export function applyParams(x, v) {
  x.bd_set_params(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13] ? 1 : 0)
}

// Same call sequence as dsp/beads/reference.cc. Returns interleaved L, R and the
// block sizes used (they follow the quality).
export function renderScenarioWasm(module, sc, input) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.bd_init(sc.seed)
  x.bd_set_quality(sc.quality)
  x.bd_set_seed(sc.seedmode[0], sc.seedmode[1])
  applyParams(x, sc.params)
  const mem = x.memory.buffer
  const inL = new Float32Array(mem, x.bd_in_l(), MAX_BLOCK)
  const inR = new Float32Array(mem, x.bd_in_r(), MAX_BLOCK)
  const outL = new Float32Array(mem, x.bd_out_l(), MAX_BLOCK)
  const outR = new Float32Array(mem, x.bd_out_r(), MAX_BLOCK)
  const out = []
  const events = [...sc.events].sort((a, b) => a[0] - b[0])
  let next = 0, k = 0
  for (let b = 0; b < sc.blocks; b++) {
    while (next < events.length && events[next][0] === b) {
      const [, kind, ...a] = events[next++]
      if (kind === 'params') applyParams(x, a)
      else if (kind === 'quality') x.bd_set_quality(a[0])
      else if (kind === 'seedmode') x.bd_set_seed(a[0], a[1])
      else if (kind === 'gate') x.bd_gate(a[0], a[1])
      else if (kind === 'reset') x.bd_reset()
    }
    const n = x.bd_block_size()
    for (let i = 0; i < n; i++, k++) inL[i] = inR[i] = k < input.length ? input[k] : 0
    x.bd_render()
    for (let i = 0; i < n; i++) out.push(outL[i], outR[i])
  }
  return { out: Float32Array.from(out), exports: x }
}
