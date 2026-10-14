#!/usr/bin/env node
// Load and soak measurements for Texture Mk II (docs/texture-mk2-plan.md,
// Phase 5). Drives the committed Beads wasm through the real worklet host
// (BeadsHost, including the quality's rate ↔ 44.1 kHz resampling) in Node, whose
// V8 is the wasm engine Chrome runs, and reports the share of one core each
// setup needs. Classic (the Clouds host) runs the same lanes for comparison.
//
//   node scripts/beads_bench.js            lane mixes, per quality, Classic vs Mk II
//   node scripts/beads_bench.js --soak     also a 10-minute single-lane soak
//
// Numbers are for the machine it runs on; a phone is typically 3–6× slower.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEXTURE_MK2_DEFAULTS, beadsDspParams, textureDspParams } from '../lib/granularEngine.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (worklet, cls, manifestName) => {
  const source = readFileSync(join(root, 'public/worklets', worklet), 'utf8')
  const Host = new Function(`${source}\nreturn ${cls}`)()
  const manifest = JSON.parse(readFileSync(join(root, 'public/wasm', manifestName), 'utf8'))
  const module = new WebAssembly.Module(readFileSync(join(root, 'public/wasm', manifest.asset)))
  return { Host, module, asset: manifest.asset }
}
const beads = load('beads-processor.js', 'BeadsHost', 'beads.manifest.json')
const clouds = load('clouds-granular-processor.js', 'TextureHost', 'clouds-granular.manifest.json')

const SR = 44100
const QUANTUM = 128
const QUALITIES = ['hifi', 'cleanTape', 'vintage', 'dirtyTape']

function mk2Lane(cfg, seed) {
  const x = new WebAssembly.Instance(beads.module, {}).exports
  const host = new beads.Host(x, SR, { seed, params: beadsDspParams({ ...TEXTURE_MK2_DEFAULTS, ...cfg }) })
  return { host, x, note: (time, dur) => host.note({ time, dur, gen: 0 }), faults: () => x.bd_fault_count() }
}
function classicLane(cfg, seed) {
  const x = new WebAssembly.Instance(clouds.module, {}).exports
  const host = new clouds.Host(x, SR, { seed, params: textureDspParams(cfg) })
  return { host, x, note: (time) => host.trig({ time, gen: 0 }), faults: () => x.cg_fault_count?.() ?? 0 }
}

// A lane-like input: a plucked note every quarter second, cycling a melody.
function laneInput(lane) {
  const melody = [220, 261.6, 329.6, 392, 440, 329.6, 293.7, 246.9]
  return (f) => {
    const t = f / SR
    const k = Math.floor(t * 4), local = t - k / 4
    const hz = melody[(k + lane) % melody.length]
    return 0.3 * Math.exp(-local * 8) * Math.sin(2 * Math.PI * hz * t)
  }
}

// Render `seconds` of `lanes`, each getting `notesPerSec` notes held `hold` s.
// Returns CPU share and health.
function run(lanes, seconds, { notesPerSec = 4, hold = 0.2, onSecond } = {}) {
  const frames = Math.round(seconds * SR)
  const inBuf = new Float32Array(QUANTUM), L = new Float32Array(QUANTUM), R = new Float32Array(QUANTUM)
  const inputs = lanes.map((_, i) => laneInput(i))
  let next = 0, peak = 0, nonFinite = 0, lastSec = -1, energy = 0
  const t0 = performance.now()
  for (let off = 0; off < frames; off += QUANTUM) {
    const now = off / SR
    // Schedule notes a little ahead, as the engine does.
    while (next < now + 0.1) {
      for (const [i, lane] of lanes.entries()) lane.note(next + 0.01 * i, hold)
      next += 1 / notesPerSec
    }
    for (const [i, lane] of lanes.entries()) {
      for (let j = 0; j < QUANTUM; j++) inBuf[j] = inputs[i](off + j)
      lane.host.process(inBuf, inBuf, L, R, QUANTUM, off)
      for (let j = 0; j < QUANTUM; j++) {
        const v = L[j]
        if (!Number.isFinite(v)) nonFinite++
        else { if (Math.abs(v) > peak) peak = Math.abs(v); energy += v * v }
      }
    }
    const sec = Math.floor(now)
    if (onSecond && sec !== lastSec) { lastSec = sec; onSecond(sec, lanes, energy); energy = 0 }
  }
  const ms = performance.now() - t0
  const faults = lanes.reduce((s, l) => s + l.faults(), 0)
  const stat = (k) => lanes.reduce((s, l) => s + (l.host.stats[k] ?? 0), 0)
  return { cpu: (ms / (seconds * 1000)) * 100, peak, nonFinite, faults, dropped: stat('dropped') + stat('overflow'), underrun: stat('underrun') }
}

const fmt = (r) => `${r.cpu.toFixed(2).padStart(6)} %  peak ${r.peak.toFixed(2)}  faults ${r.faults}  dropped ${r.dropped}  underrun ${r.underrun}  non-finite ${r.nonFinite}`
const lanes = (make, n = 8) => Array.from({ length: n }, (_, i) => make(i + 1))

console.log(`Texture load, ${SR} Hz host, 8 lanes, 4 notes/s, 20 s each`)
console.log(`  Mk II: ${beads.asset}   Classic: ${clouds.asset}\n`)

console.log('Classic at its defaults                    ', fmt(run(lanes(s => classicLane({}, s)), 20)))

const SETUPS = [
  ['defaults (note gates)', {}],
  ['free running, dense, rand, fb, reverb', {
    tx2SeedMode: 'free', tx2Density: 0.9, tx2TimeRand: 0.8, tx2SizeRand: 0.8, tx2ShapeRand: 0.8, tx2PitchRand: 0.8,
    tx2Feedback: 0.6, tx2Reverb: 0.6, tx2DryWet: 0.7,
  }],
  ['delay mode, clocked, fb, reverb', { tx2Size: 1, tx2SeedMode: 'clock', tx2Density: 0.45, tx2Feedback: 0.6, tx2Reverb: 0.6, tx2DryWet: 0.7 }],
]
for (const [label, cfg] of SETUPS) {
  console.log(`\nMk II, ${label}:`)
  for (const q of QUALITIES) {
    console.log(`  ${q.padEnd(10)}`, fmt(run(lanes(s => mk2Lane({ ...cfg, tx2Quality: q }, s)), 20)))
  }
}

if (process.argv.includes('--soak')) {
  // Ten minutes on one lane, cycling quality every 30 s, seed mode every 20 s,
  // and in and out of delay mode every 45 s, the way a long set with automation
  // might.
  console.log('\n10-minute soak (quality every 30 s, seed mode every 20 s, delay mode every 45 s):')
  const lane = mk2Lane({ tx2Density: 0.8, tx2Feedback: 0.4, tx2Reverb: 0.3 }, 7)
  const mem0 = lane.x.memory.buffer.byteLength
  const seedModes = ['gates', 'clock', 'free']
  const cfg = { ...TEXTURE_MK2_DEFAULTS, tx2Density: 0.8, tx2Feedback: 0.4, tx2Reverb: 0.3 }
  let silentSeconds = 0
  const r = run([lane], 600, {
    notesPerSec: 3,
    onSecond(sec, [l], energy) {
      // A switch empties the recording, so allow a couple of quiet seconds after one.
      if (sec > 2 && energy === 0) silentSeconds++
      let changed = false
      if (sec % 30 === 0) { cfg.tx2Quality = QUALITIES[(sec / 30) % 4]; changed = true }
      if (sec % 20 === 0) { cfg.tx2SeedMode = seedModes[(sec / 20) % 3]; changed = true }
      if (sec % 45 === 0) { cfg.tx2Size = (sec / 45) % 2 ? 1 : 0.5; changed = true }
      if (changed) l.host.setParams(beadsDspParams(cfg))
    },
  })
  const mem1 = lane.x.memory.buffer.byteLength
  const s = lane.host.stats
  console.log(`  ${fmt(r)}`)
  console.log(`  memory ${mem0} → ${mem1} bytes  switches ${s.switches}  late ${s.late}  silent seconds ${silentSeconds}`)
}
