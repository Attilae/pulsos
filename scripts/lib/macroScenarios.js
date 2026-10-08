// Shared Macro DSP test scenarios: consumed by scripts/macro_compare.js
// (native vs wasm) and test/macro-dsp.test.js (wasm-only properties). Each
// scenario is a deterministic note schedule in 12-sample blocks at 48 kHz.
// Output is mono float32, one value per sample.

export const BLOCK = 12
export const DSP_RATE = 48000
export const NUM_ENGINES = 24
export const sec = (s) => Math.round((s * DSP_RATE) / BLOCK)
export const samples = (s) => Math.round(s * DSP_RATE)

// [harmonics, timbre, morph, fmAmt, timbreAmt, morphAmt, decay, colour, transpose]
export const DEFAULT_PATCH = [0.5, 0.5, 0.5, 0, 0, 0, 0.5, 0.5, 0]

const held = (atSec, note, velocity, holdSec) =>
  ({ at: sec(atSec), kind: 'held', note, velocity, hold: samples(holdSec) })

// Walk one bank: each engine gets 0.6 s with a two-note phrase.
function bankTour(bank) {
  const events = []
  for (let k = 0; k < 8; k++) {
    const t = k * 0.6
    if (k > 0) events.push({ at: sec(t), kind: 'engine', engine: bank * 8 + k })
    events.push(held(t + 0.02, 48 + 5 * k, 0.9, 0.2))
    events.push(held(t + 0.3, 55 + 5 * k, 0.7, 0.15))
  }
  return { engine: bank * 8, events, blocks: sec(8 * 0.6 + 0.4) }
}

export const MACRO_SCENARIOS = [
  ...[0, 1, 2].map(bank => ({
    name: `bank-${bank + 1}-tour`, seed: 1 + bank, voices: 2, patch: DEFAULT_PATCH, aux: 0,
    ...bankTour(bank),
  })),
  {
    name: 'va-4v-chord-aux', seed: 4, voices: 4, engine: 8, aux: 1,
    patch: [0.3, 0.6, 0.4, 0, 0.4, -0.3, 0.6, 0.3, 0], blocks: sec(2),
    events: [48, 52, 55, 59].map(note => held(0.05, note, 0.8, 0.8)),
  },
  {
    name: 'six-op-gate-and-steal', seed: 5, voices: 2, engine: 2,
    patch: [0.5, 0.4, 0.5, 0, 0, 0, 0.7, 0.5, 0], aux: 0, blocks: sec(3),
    events: [
      held(0, 60, 1, 1.2),
      held(0.2, 64, 0.8, 1.2),
      held(0.4, 67, 0.6, 0.3),          // steals the oldest voice while it's held
      { at: sec(1.6), kind: 'trigger', note: 72, velocity: 1 },
      { at: sec(2.2), kind: 'release', note: 72 },
    ],
  },
  {
    name: 'drums-modulated', seed: 6, voices: 3, engine: 21,
    patch: [0.4, 0.6, 0.5, 0.5, 0.5, 0.5, 0.4, 0.8, 0], aux: 0.5, blocks: sec(2.5),
    events: [
      ...[0, 0.25, 0.5, 0.75].map(t => held(t, 36, 1, 0.05)),
      { at: sec(1), kind: 'engine', engine: 22 },
      ...[1.05, 1.3].map(t => held(t, 50, 0.8, 0.05)),
      { at: sec(1.5), kind: 'engine', engine: 23 },
      ...[1.55, 1.7, 1.85, 2.0].map(t => held(t, 60, 0.6, 0.02)),
    ],
  },
  {
    name: 'extremes-and-transpose', seed: 7, voices: 4, engine: 13,
    patch: [1, 1, 1, 1, 1, 1, 1, 1, 24], aux: 0, blocks: sec(2.5),
    events: [
      held(0, 0, 1, 0.2),
      held(0.1, 120, 1, 0.2),
      { at: sec(0.5), kind: 'patch', patch: [0, 0, 0, -1, -1, -1, 0, 0, -24] },
      held(0.6, 24, 1, 0.3),
      held(0.7, 96, 1, 0.3),
      { at: sec(1.2), kind: 'engine', engine: 15 },
      held(1.3, 60, 1, 0.5),
      { at: sec(1.6), kind: 'voices', voices: 1 },
      held(1.7, 62, 1, 0.3),
    ],
  },
  {
    name: 'engine-switch-and-panic', seed: 8, voices: 2, engine: 8,
    patch: DEFAULT_PATCH, aux: 0, blocks: sec(2.5),
    events: [
      { at: sec(0), kind: 'trigger', note: 57, velocity: 1 },
      { at: sec(0.5), kind: 'engine', engine: 12 },
      held(0.505, 59, 1, 0.4),          // deferred behind the fade
      { at: sec(1.0), kind: 'aux', aux: 1 },
      { at: sec(1.2), kind: 'engine', engine: 19 },
      held(1.3, 62, 1, 0.3),
      { at: sec(1.8), kind: 'panic' },
      held(1.81, 64, 1, 0.3),           // dropped: a panic cancels
    ],
  },
]

export function scenarioToText(sc) {
  const lines = [
    `seed ${sc.seed}`, `voices ${sc.voices}`, `engine ${sc.engine}`,
    `patch ${sc.patch.join(' ')}`, `aux ${sc.aux ?? 0}`,
  ]
  for (const e of sortEvents(sc.events)) {
    if (e.kind === 'trigger') lines.push(`at ${e.at} trigger ${e.note} ${e.velocity}`)
    else if (e.kind === 'held') lines.push(`at ${e.at} held ${e.note} ${e.velocity} ${e.hold}`)
    else if (e.kind === 'release') lines.push(`at ${e.at} release ${e.note}`)
    else if (e.kind === 'engine') lines.push(`at ${e.at} engine ${e.engine}`)
    else if (e.kind === 'patch') lines.push(`at ${e.at} patch ${e.patch.join(' ')}`)
    else if (e.kind === 'aux') lines.push(`at ${e.at} aux ${e.aux}`)
    else if (e.kind === 'voices') lines.push(`at ${e.at} voices ${e.voices}`)
    else if (e.kind === 'panic') lines.push(`at ${e.at} panic`)
  }
  lines.push(`blocks ${sc.blocks}`)
  return lines.join('\n') + '\n'
}

// Stable sort by block, so same-block events keep their authored order in both
// the text file and the wasm loop.
const sortEvents = (events) => events.map((e, i) => [e, i]).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]).map(p => p[0])

// Render a scenario through the wasm module; returns mono float32. Mirrors
// dsp/macro/reference.cc's event loop exactly (events apply before the block
// they're scheduled on is rendered).
export function renderScenarioWasm(module, sc) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.mc_init(sc.seed)
  x.mc_set_voices(sc.voices)
  x.mc_set_engine(sc.engine, 1)
  x.mc_set_patch(...sc.patch, 1)
  x.mc_set_aux(sc.aux ?? 0)
  const events = sortEvents(sc.events)
  const out = new Float32Array(sc.blocks * BLOCK)
  const buf = new Float32Array(x.memory.buffer, x.mc_out(), BLOCK)
  let next = 0
  for (let b = 0; b < sc.blocks; b++) {
    while (next < events.length && events[next].at === b) {
      const e = events[next++]
      if (e.kind === 'trigger') x.mc_trigger(e.note, e.velocity)
      else if (e.kind === 'held') x.mc_trigger_held(e.note, e.velocity, e.hold)
      else if (e.kind === 'release') x.mc_release(e.note)
      else if (e.kind === 'engine') x.mc_set_engine(e.engine, 0)
      else if (e.kind === 'patch') x.mc_set_patch(...e.patch, 0)
      else if (e.kind === 'aux') x.mc_set_aux(e.aux)
      else if (e.kind === 'voices') x.mc_set_voices(e.voices)
      else if (e.kind === 'panic') x.mc_panic()
    }
    x.mc_render()
    out.set(buf, b * BLOCK)
  }
  return { out, exports: x }
}
