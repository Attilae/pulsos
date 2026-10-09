#!/usr/bin/env node
// Native vs wasm comparison for the Analog filter bridge. Needs the reference
// renderer: `npm run compare:ladder` builds it first. Renders every scenario in
// scripts/lib/ladderScenarios.js (all six responses at 44.1/48/96 kHz with
// cutoff/resonance/drive sweeps, self-oscillation + reset, mono input, response
// crossfades and out-of-range parameters) through both, reports the largest
// sample difference, and writes WAVs to dsp/ladder/.build/renders/ for listening.
//
// Tolerance: both builds use -ffp-contract=off and the same float32 code, so the
// expected difference is zero; anything above TOLERANCE is a DSP mismatch, not
// rounding noise to be allowed for.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ladderScenarios, renderScenarioWasm, scenarioText } from './lib/ladderScenarios.js'

const TOLERANCE = 1e-6

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const build = join(root, 'dsp', 'ladder', '.build')
const renders = join(build, 'renders')
mkdirSync(renders, { recursive: true })

const manifest = JSON.parse(readFileSync(join(root, 'public', 'wasm', 'ladder.manifest.json'), 'utf8'))
const module = new WebAssembly.Module(readFileSync(join(root, 'public', 'wasm', manifest.asset)))
const bin = join(build, 'ladder-reference')

function wav(interleaved, rate) {
  const n = interleaved.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(interleaved[i] * 32767))), 44 + i * 2)
  return buf
}

let worst = 0
for (const sc of ladderScenarios()) {
  const scFile = join(build, `${sc.name}.txt`)
  const framesFile = join(build, `${sc.name}.frames.f32`)
  const outFile = join(build, `${sc.name}.native.f32`)
  writeFileSync(scFile, scenarioText(sc))
  writeFileSync(framesFile, Buffer.from(sc.frames.buffer))
  execFileSync(bin, [scFile, framesFile, outFile])
  const raw = readFileSync(outFile)
  const native = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const { out: wasm } = renderScenarioWasm(module, sc)
  if (native.length !== wasm.length) throw new Error(`${sc.name}: length ${native.length} vs ${wasm.length}`)
  let maxDiff = 0, identical = true, peak = 0
  for (let i = 0; i < wasm.length; i++) {
    if (native[i] !== wasm[i]) identical = false
    maxDiff = Math.max(maxDiff, Math.abs(native[i] - wasm[i]))
    peak = Math.max(peak, Math.abs(wasm[i]))
  }
  worst = Math.max(worst, maxDiff)
  writeFileSync(join(renders, `${sc.name}.wav`), wav(wasm.map(v => v * 0.5), sc.rate))
  console.log(`${sc.name.padEnd(24)} ${identical ? 'bit-identical' : `max |diff| ${maxDiff.toExponential(2)}`}  peak ${peak.toFixed(3)}`)
}
console.log(`renders → ${renders}`)
if (worst > TOLERANCE) {
  console.error(`native/wasm mismatch: ${worst.toExponential(2)} > ${TOLERANCE}`)
  process.exit(1)
}
