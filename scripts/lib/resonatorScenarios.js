// Shared Resonator DSP test scenarios: consumed by scripts/resonator_compare.js
// (native vs wasm) and test/resonator-dsp.test.js (wasm-only properties).
// Each scenario is a deterministic strike schedule in 24-sample blocks at 48 kHz.

export const BLOCK = 24
export const DSP_RATE = 48000
const sec = (s) => Math.round((s * DSP_RATE) / BLOCK)

const samples = (s) => Math.round(s * DSP_RATE)

const arpeggio = (start, notes, stepSec, velocity = 0.9) =>
  notes.map((note, i) => ({ at: sec(start + i * stepSec), kind: 'trigger', note, velocity }))

export const RESONATOR_SCENARIOS = [
  {
    name: 'modal-2v-melody', seed: 1, voices: 2, model: 0,
    patch: [0.4, 0.5, 0.6, 0.4], blocks: sec(3),
    events: arpeggio(0, [48, 55, 60, 64, 67, 72], 0.25),
  },
  {
    name: 'sympathetic-4v-chord', seed: 7, voices: 4, model: 1,
    patch: [0.6, 0.6, 0.7, 0.3], blocks: sec(3),
    events: [48, 52, 55, 59].map(note => ({ at: sec(0.1), kind: 'trigger', note, velocity: 0.8 })),
  },
  {
    name: 'string-2v-velocities', seed: 3, voices: 2, model: 2,
    patch: [0.25, 0.7, 0.5, 0.5], blocks: sec(3),
    events: [
      { at: sec(0), kind: 'trigger', note: 45, velocity: 1 },
      { at: sec(0.4), kind: 'trigger', note: 57, velocity: 0.3 },
      { at: sec(0.8), kind: 'trigger', note: 52, velocity: 0.6 },
    ],
  },
  {
    name: 'extremes-4v', seed: 11, voices: 4, model: 0,
    patch: [1, 1, 1, 1], blocks: sec(2),
    events: [
      ...arpeggio(0, [24, 36, 96, 108], 0.05, 1),
      { at: sec(0.5), kind: 'patch', patch: [0, 0, 0, 0] },
      ...arpeggio(0.6, [24, 108], 0.05, 1),
    ],
  },
  {
    name: 'model-switch-and-panic', seed: 5, voices: 2, model: 0,
    patch: [0.4, 0.5, 0.8, 0.4], blocks: sec(2.5),
    events: [
      { at: sec(0), kind: 'trigger', note: 60, velocity: 1 },
      { at: sec(0.5), kind: 'model', model: 2 },
      { at: sec(0.51), kind: 'trigger', note: 62, velocity: 1 },
      { at: sec(1.2), kind: 'model', model: 1 },
      { at: sec(1.3), kind: 'trigger', note: 64, velocity: 1 },
      { at: sec(1.8), kind: 'panic' },
    ],
  },
  // Envelope scenarios. `envelope` is [on, attack, decay, sustain, release, bow, strike].
  {
    name: 'env-modal-strike-held', seed: 2, voices: 2, model: 0,
    patch: [0.4, 0.5, 0.9, 0.4], blocks: sec(3),
    envelope: [1, 0.005, 0.2, 0.6, 0.3, 0, 1],
    events: [
      { at: sec(0), kind: 'held', note: 60, velocity: 1, hold: samples(0.5) },
      { at: sec(0.8), kind: 'held', note: 67, velocity: 0.7, hold: samples(1) },
    ],
  },
  {
    name: 'env-string-bowed', seed: 6, voices: 2, model: 2,
    patch: [0.3, 0.6, 0.8, 0.3], blocks: sec(3.5),
    envelope: [1, 0.8, 0.3, 0.8, 0.6, 0.8, 0],
    events: [
      { at: sec(0), kind: 'trigger', note: 55, velocity: 0.9 },
      { at: sec(0.3), kind: 'trigger', note: 62, velocity: 0.9 },
      { at: sec(1.6), kind: 'release', note: 55 },
      { at: sec(2.2), kind: 'release', note: -1 },
    ],
  },
  {
    name: 'env-sympathetic-steal-toggle', seed: 8, voices: 2, model: 1,
    patch: [0.5, 0.5, 0.7, 0.4], blocks: sec(3),
    envelope: [1, 0.05, 0.4, 0.5, 0.4, 0.5, 1],
    events: [
      ...[48, 52, 55, 59].map((note, i) => ({ at: sec(i * 0.2), kind: 'held', note, velocity: 0.8, hold: samples(0.6) })),
      { at: sec(1.2), kind: 'envelope', envelope: [0, 0.05, 0.4, 0.5, 0.4, 0.5, 1] },
      { at: sec(1.3), kind: 'trigger', note: 60, velocity: 0.8 },
      { at: sec(1.4), kind: 'envelope', envelope: [1, 0.01, 0.1, 0.3, 0.2, 0, 1] },
      { at: sec(1.5), kind: 'held', note: 64, velocity: 0.8, hold: samples(0.3) },
    ],
  },
]

export function scenarioToText(sc) {
  const lines = [
    `seed ${sc.seed}`, `voices ${sc.voices}`, `model ${sc.model}`, `patch ${sc.patch.join(' ')}`,
  ]
  if (sc.envelope) lines.push(`envelope ${sc.envelope.join(' ')}`)
  for (const e of [...sc.events].sort((a, b) => a.at - b.at)) {
    if (e.kind === 'trigger') lines.push(`at ${e.at} trigger ${e.note} ${e.velocity}`)
    else if (e.kind === 'held') lines.push(`at ${e.at} held ${e.note} ${e.velocity} ${e.hold}`)
    else if (e.kind === 'release') lines.push(`at ${e.at} release ${e.note}`)
    else if (e.kind === 'envelope') lines.push(`at ${e.at} envelope ${e.envelope.join(' ')}`)
    else if (e.kind === 'model') lines.push(`at ${e.at} model ${e.model}`)
    else if (e.kind === 'patch') lines.push(`at ${e.at} patch ${e.patch.join(' ')}`)
    else if (e.kind === 'panic') lines.push(`at ${e.at} panic`)
  }
  lines.push(`blocks ${sc.blocks}`)
  return lines.join('\n') + '\n'
}

// Render a scenario through the wasm module; returns interleaved L/R float32.
// Mirrors dsp/resonator/reference.cc's event loop exactly (events apply before
// the block they're scheduled on is rendered, in sorted order).
export function renderScenarioWasm(module, sc) {
  const x = new WebAssembly.Instance(module, {}).exports
  x.rs_init(sc.seed)
  x.rs_set_voices(sc.voices)
  x.rs_set_model(sc.model, 1)
  x.rs_set_patch(...sc.patch, 1)
  if (sc.envelope) x.rs_set_envelope(...sc.envelope)
  const events = [...sc.events].sort((a, b) => a.at - b.at)
  const out = new Float32Array(sc.blocks * BLOCK * 2)
  const l = new Float32Array(x.memory.buffer, x.rs_out_l(), BLOCK)
  const r = new Float32Array(x.memory.buffer, x.rs_out_r(), BLOCK)
  let next = 0
  for (let b = 0; b < sc.blocks; b++) {
    while (next < events.length && events[next].at === b) {
      const e = events[next++]
      if (e.kind === 'trigger') x.rs_trigger(e.note, e.velocity)
      else if (e.kind === 'held') x.rs_trigger_held(e.note, e.velocity, e.hold)
      else if (e.kind === 'release') x.rs_release(e.note)
      else if (e.kind === 'envelope') x.rs_set_envelope(...e.envelope)
      else if (e.kind === 'model') x.rs_set_model(e.model, 0)
      else if (e.kind === 'patch') x.rs_set_patch(...e.patch, 0)
      else if (e.kind === 'panic') x.rs_panic()
    }
    x.rs_render()
    for (let i = 0; i < BLOCK; i++) {
      out[(b * BLOCK + i) * 2] = l[i]
      out[(b * BLOCK + i) * 2 + 1] = r[i]
    }
  }
  return out
}
