#!/usr/bin/env node
// Load and soak measurements for the Macro instrument (docs/plaits-macro-plan.md,
// Phase 6). Drives the committed wasm through the real worklet host (MacroHost,
// including 48 kHz → 44.1 kHz resampling) in Node, whose V8 is the wasm engine
// Chrome runs, and reports the share of one core each setup needs.
//
//   node scripts/macro_bench.js            lane mixes + per-engine worst case
//   node scripts/macro_bench.js --soak     also a 10-minute single-lane soak
//
// Numbers are for the machine it runs on; a phone is typically 3–6× slower.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { macroPatch, MACRO_ENGINES } from '../lib/macroSpecs.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'public/worklets/macro-processor.js'), 'utf8')
const { MacroHost } = new Function(`${source}\nreturn { MacroHost }`)()
const manifest = JSON.parse(readFileSync(join(root, 'public/wasm/macro.manifest.json'), 'utf8'))
const module = new WebAssembly.Module(readFileSync(join(root, 'public/wasm', manifest.asset)))

const SR = 44100
const QUANTUM = 128
const index = (id) => MACRO_ENGINES.find(e => e.id === id).index

function makeLane(engine, voices, seed) {
  const x = new WebAssembly.Instance(module, {}).exports
  return new MacroHost(x, SR, { seed, voices, engine: index(engine), patch: macroPatch({ macroDecay: 0.6 }) })
}

// Render `seconds` of `lanes`, each playing `notesPerSec` notes held `hold` s
// (cycling a small melody, chords when `chord`). Returns CPU share and health.
function run(lanes, seconds, { notesPerSec = 4, hold = 0.2, chord = 1, onSecond } = {}) {
  const frames = Math.round(seconds * SR)
  const L = new Float32Array(QUANTUM), R = new Float32Array(QUANTUM)
  const melody = [48, 51, 55, 58, 60, 63, 55, 53]
  let next = 0, n = 0, peak = 0, nonFinite = 0, lastSec = -1
  const t0 = performance.now()
  for (let off = 0; off < frames; off += QUANTUM) {
    const now = off / SR
    // Schedule the next second's notes a little ahead, as the engine does.
    while (next < now + 0.1) {
      for (const [i, lane] of lanes.entries()) {
        for (let c = 0; c < chord; c++) {
          lane.note({ time: next + 0.01 * i, midi: melody[(n + i) % melody.length] + 4 * c, velocity: 0.8, gen: 0, hold }, off)
        }
      }
      n++
      next += 1 / notesPerSec
    }
    for (const lane of lanes) {
      lane.render(L, R, QUANTUM, off)
      for (let j = 0; j < QUANTUM; j++) {
        const v = L[j]
        if (!Number.isFinite(v)) nonFinite++
        else if (Math.abs(v) > peak) peak = Math.abs(v)
      }
    }
    const sec = Math.floor(now)
    if (onSecond && sec !== lastSec) { lastSec = sec; onSecond(sec, lanes) }
  }
  const ms = performance.now() - t0
  const faults = lanes.reduce((s, l) => s + l.x.mc_fault_count(), 0)
  const dropped = lanes.reduce((s, l) => s + l.stats.dropped + l.stats.overflow, 0)
  return { cpu: (ms / (seconds * 1000)) * 100, peak, nonFinite, faults, dropped }
}

const fmt = (r) => `${r.cpu.toFixed(2).padStart(6)} %  peak ${r.peak.toFixed(2)}  faults ${r.faults}  dropped ${r.dropped}  non-finite ${r.nonFinite}`

console.log(`Macro load, ${SR} Hz host, ${manifest.asset}\n`)

// Typical: eight lanes of mixed engines, two voices each, 4 notes/s.
const mixed = ['va', 'fm', 'sixOpA', 'chords', 'modal', 'swarm', 'particle', 'bassDrum']
console.log('8 mixed lanes, 2 voices, 4 notes/s      ', fmt(run(mixed.map((e, i) => makeLane(e, 2, i + 1)), 20)))
console.log('8 mixed lanes, 4 voices, 3-note chords  ', fmt(run(mixed.map((e, i) => makeLane(e, 4, i + 1)), 20, { chord: 3, hold: 0.4 })))

// Worst case: the heaviest engine on every lane, every voice kept busy.
console.log('8 lanes 2-op FM, 4 voices, 8 notes/s    ', fmt(run(Array.from({ length: 8 }, (_, i) => makeLane('fm', 4, i + 1)), 20, { notesPerSec: 8, chord: 4, hold: 0.5 })))

// Per engine: one lane, 4 voices, 4-note chords held 0.5 s at 4/s (all voices busy).
console.log('\nOne lane, 4 voices kept busy (worst case per engine):')
for (const e of MACRO_ENGINES) {
  const r = run([makeLane(e.id, 4, 1)], 10, { chord: 4, hold: 0.5 })
  console.log(`  ${e.label.padEnd(18)} ${fmt(r)}`)
}

if (process.argv.includes('--soak')) {
  // Ten minutes on one lane, switching engine every 10 s through all 24 and
  // voice count every minute, the way a long Song Chainer set might.
  console.log('\n10-minute soak (engine change every 10 s, voices every 60 s):')
  const lane = makeLane('va', 2, 7)
  const mem0 = lane.x.memory.buffer.byteLength
  let silentMinutes = 0, minuteEnergy = 0
  const r = run([lane], 600, {
    notesPerSec: 3,
    onSecond(sec, [l]) {
      if (sec % 10 === 0) l.setEngine((sec / 10) % 24)
      if (sec % 60 === 0) {
        l.setVoices(1 + ((sec / 60) % 4))
        if (sec > 0 && minuteEnergy === 0) silentMinutes++
        minuteEnergy = 0
      }
      minuteEnergy += Math.abs(l.ring[0]) + Math.abs(l.ring[100])
    },
  })
  const mem1 = lane.x.memory.buffer.byteLength
  console.log(`  ${fmt(r)}  memory ${mem0} → ${mem1} bytes  silent minutes ${silentMinutes}  late ${lane.stats.late}`)
}
