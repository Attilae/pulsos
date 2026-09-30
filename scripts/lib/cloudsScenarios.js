// Deterministic render scenarios for the Texture (Clouds granular) bridge,
// shared by the native-vs-wasm comparison (scripts/clouds_compare.js) and the
// wasm tests (test/clouds-granular-dsp.test.js). Pure: no fs, no Tone.

export const DSP_RATE = 32000
export const BLOCK = 32

// Lane-like input: plucked, band-limited saw notes (a short melody), mono.
export function testInput(seconds = 4, notes = [220, 277.18, 329.63, 440], noteSec = 0.5) {
  const n = Math.round(seconds * DSP_RATE)
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_RATE
    const k = Math.floor(t / noteSec)
    const hz = notes[k % notes.length]
    const tn = t - k * noteSec
    const env = Math.min(tn / 0.005, 1) * Math.exp(-tn / 0.25)
    let v = 0
    for (let h = 1; h < 10; h++) v += Math.sin(2 * Math.PI * hz * h * t) / h
    s[i] = 0.3 * v * env
  }
  return s
}

// params: [position, size, pitchKnob, density, texture, dryWet, spread, feedback, reverb, inGain, freeze]
export const NEUTRAL = [0.2, 0.5, 0.5, 0.7, 0.5, 1, 0.3, 0, 0, 1, 0]

export const CLOUDS_SCENARIOS = [
  { name: 'random-cloud', seed: 1, params: NEUTRAL, events: [], blocks: 3000 },
  { name: 'deterministic-trig', seed: 2, params: [0.1, 0.4, 0.5, 0.3, 0.3, 0.8, 0, 0, 0, 1, 0],
    events: [[100, 'trig'], [600, 'trig'], [1100, 'trig']], blocks: 3000 },
  { name: 'pitched-diffused', seed: 3, params: [0.5, 0.7, 0.8, 0.8, 0.9, 1, 1, 0, 0, 1, 0], events: [], blocks: 3000 },
  { name: 'feedback-reverb', seed: 4, params: [0.3, 0.6, 0.3, 0.75, 0.6, 0.7, 0.5, 0.6, 0.7, 1, 0], events: [], blocks: 3000 },
  { name: 'freeze-release', seed: 5, params: NEUTRAL,
    events: [[1000, 'params', 0.2, 0.5, 0.5, 0.7, 0.5, 1, 0.3, 0.5, 0.3, 1, 1],
             [2200, 'params', 0.2, 0.5, 0.5, 0.7, 0.5, 1, 0.3, 0, 0, 1, 0]], blocks: 3000 },
  { name: 'extremes-reset', seed: 6, params: [1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 0],
    events: [[800, 'params', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.125, 0], [1500, 'reset'], [1600, 'trig']], blocks: 3000 },
]

export function scenarioText(sc) {
  const lines = [`seed ${sc.seed}`, `params ${sc.params.join(' ')}`]
  for (const [block, kind, ...args] of sc.events) lines.push(`at ${block} ${kind} ${args.join(' ')}`.trim())
  lines.push(`blocks ${sc.blocks}`)
  return lines.join('\n') + '\n'
}

function applyParams(x, v) {
  x.cg_set_params(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10] ? 1 : 0)
}

// Same call sequence as dsp/clouds/reference.cc. Returns interleaved wetL, wetR, dryGain.
export function renderScenarioWasm(module, sc, input) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.cg_init(sc.seed)
  applyParams(x, sc.params)
  const mem = x.memory.buffer
  const inL = new Float32Array(mem, x.cg_in_l(), BLOCK)
  const inR = new Float32Array(mem, x.cg_in_r(), BLOCK)
  const outL = new Float32Array(mem, x.cg_out_l(), BLOCK)
  const outR = new Float32Array(mem, x.cg_out_r(), BLOCK)
  const out = new Float32Array(sc.blocks * BLOCK * 3)
  const events = [...sc.events].sort((a, b) => a[0] - b[0])
  let next = 0
  for (let b = 0; b < sc.blocks; b++) {
    while (next < events.length && events[next][0] === b) {
      const [, kind, ...a] = events[next++]
      if (kind === 'params') applyParams(x, a)
      else if (kind === 'trig') x.cg_trigger()
      else if (kind === 'reset') x.cg_reset()
    }
    for (let i = 0; i < BLOCK; i++) {
      const k = b * BLOCK + i
      inL[i] = inR[i] = k < input.length ? input[k] : 0
    }
    x.cg_render()
    const dry = x.cg_dry_gain()
    for (let i = 0; i < BLOCK; i++) {
      const o = (b * BLOCK + i) * 3
      out[o] = outL[i]; out[o + 1] = outR[i]; out[o + 2] = dry
    }
  }
  return { out, exports: x }
}
