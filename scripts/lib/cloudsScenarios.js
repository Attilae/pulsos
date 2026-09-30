// Deterministic render scenarios for the Clouds granular bridge, shared by the
// native-vs-wasm comparison (scripts/clouds_compare.js) and the wasm tests
// (test/clouds-granular-dsp.test.js). Pure: no fs, no Tone.

export const DSP_RATE = 32000
export const BLOCK = 32

// A two-second "rendered instrument" at C4: band-limited saw, 50 ms attack,
// held, then a 0.25 s release — the shape of engine._renderGranularSource output.
export function testSource(seconds = 2, hz = 261.63) {
  const n = Math.round(seconds * DSP_RATE)
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_RATE
    let env = Math.min(t / 0.05, 1)
    if (t > 1.25) env *= Math.exp(-(t - 1.25) / 0.25)
    let v = 0
    for (let k = 1; k < 12; k++) v += Math.sin(2 * Math.PI * hz * k * t) / k
    s[i] = 0.3 * v * env
  }
  return s
}

// params: [size, density, scanRate, winStart, winEnd, jitter, windowShape, spread, reverse]
const BASE = [2880, 3.1, 1, 0, 1, 0, 0.75, 0.5, 0]

export const CLOUDS_SCENARIOS = [
  { name: 'defaults', seed: 1, params: BASE, events: [[0, 'note', 0]], blocks: 2000 },
  { name: 'pitched-notes', seed: 2, params: BASE,
    events: [[0, 'note', 0], [500, 'note', 7], [1000, 'note', -12], [1500, 'note', 12]], blocks: 2000 },
  { name: 'dense-jittered', seed: 3, params: [960, 12, 1, 0.1, 0.6, 0.6, 0.75, 1, 0],
    events: [[0, 'note', 3]], blocks: 2000 },
  { name: 'reverse-slow-scan', seed: 4, params: [6400, 4, 0.25, 0.2, 0.9, 0, 1, 0.3, 1],
    events: [[0, 'note', -5]], blocks: 2000 },
  { name: 'reload-panic-params', seed: 5, params: BASE,
    events: [[0, 'note', 0], [400, 'reload'], [900, 'params', 512, 20, 2, 0, 0.3, 0.2, 0.2, 0.8, 0],
             [1300, 'panic'], [1400, 'note', 2]], blocks: 2000 },
  { name: 'extremes', seed: 6, params: [64, 32, 16, 0, 0, 1, 0, 1, 0],
    events: [[0, 'note', 48], [700, 'note', -48], [1200, 'params', 16384, 1, 0, 1, 1, 0, 1, 0, 1]], blocks: 2000 },
]

export function scenarioText(sc) {
  const lines = [`seed ${sc.seed}`, `params ${sc.params.join(' ')}`]
  for (const [block, kind, ...args] of sc.events) lines.push(`at ${block} ${kind} ${args.join(' ')}`.trim())
  lines.push(`blocks ${sc.blocks}`)
  return lines.join('\n') + '\n'
}

function applyParams(x, v) {
  x.cg_set_params(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8] ? 1 : 0)
}

// Same call sequence as dsp/clouds/reference.cc. Returns interleaved L/R.
export function renderScenarioWasm(module, sc, source) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.cg_init(sc.seed)
  applyParams(x, sc.params)
  const staging = new Float32Array(x.memory.buffer, x.cg_staging(), x.cg_max_source())
  staging.set(source)
  x.cg_load(source.length, 1)
  const outL = new Float32Array(x.memory.buffer, x.cg_out_l(), BLOCK)
  const outR = new Float32Array(x.memory.buffer, x.cg_out_r(), BLOCK)
  const out = new Float32Array(sc.blocks * BLOCK * 2)
  const events = [...sc.events].sort((a, b) => a[0] - b[0])
  let next = 0
  for (let b = 0; b < sc.blocks; b++) {
    while (next < events.length && events[next][0] === b) {
      const [, kind, ...a] = events[next++]
      if (kind === 'note') { x.cg_set_pitch(a[0]); x.cg_trigger() }
      else if (kind === 'pitch') x.cg_set_pitch(a[0])
      else if (kind === 'params') applyParams(x, a)
      else if (kind === 'reload') { staging.set(source); x.cg_load(source.length, 0) }
      else if (kind === 'panic') x.cg_panic()
    }
    x.cg_render()
    for (let i = 0; i < BLOCK; i++) {
      out[(b * BLOCK + i) * 2] = outL[i]
      out[(b * BLOCK + i) * 2 + 1] = outR[i]
    }
  }
  return { out, exports: x }
}
