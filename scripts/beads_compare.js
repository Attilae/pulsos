#!/usr/bin/env node
// Native vs wasm comparison for the Texture Mk II (Beads) bridge. Needs the
// reference renderer: `npm run compare:beads` builds it first. Renders every
// scenario in scripts/lib/beadsScenarios.js through both, reports the largest
// sample difference, and writes WAVs to dsp/beads/.build/renders/ for listening
// (at the scenario's starting quality rate; a scenario that switches quality
// plays back at the wrong speed after the switch).

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BEADS_SCENARIOS, QUALITY_RATE, renderScenarioWasm, scenarioText, testInput } from './lib/beadsScenarios.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const build = join(root, 'dsp', 'beads', '.build')
const renders = join(build, 'renders')
mkdirSync(renders, { recursive: true })

const manifest = JSON.parse(readFileSync(join(root, 'public', 'wasm', 'beads.manifest.json'), 'utf8'))
const module = new WebAssembly.Module(readFileSync(join(root, 'public', 'wasm', manifest.asset)))
const bin = join(build, 'beads-reference')

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
for (const sc of BEADS_SCENARIOS) {
  const rate = QUALITY_RATE[sc.quality]
  const input = testInput(rate)
  const srcFile = join(build, `${sc.name}.input.f32`)
  writeFileSync(srcFile, Buffer.from(input.buffer))
  const scFile = join(build, `${sc.name}.txt`)
  const outFile = join(build, `${sc.name}.native.f32`)
  writeFileSync(scFile, scenarioText(sc))
  execFileSync(bin, [scFile, srcFile, outFile])
  const raw = readFileSync(outFile)
  const native = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const { out: wasm, exports } = renderScenarioWasm(module, sc, input)
  if (native.length !== wasm.length) throw new Error(`${sc.name}: length ${native.length} vs ${wasm.length}`)
  let maxDiff = 0, identical = true, peak = 0, nonFinite = 0
  for (let i = 0; i < wasm.length; i++) {
    if (!Number.isFinite(wasm[i])) nonFinite++
    if (native[i] !== wasm[i]) identical = false
    maxDiff = Math.max(maxDiff, Math.abs(native[i] - wasm[i]))
    peak = Math.max(peak, Math.abs(wasm[i]))
  }
  worst = Math.max(worst, maxDiff)
  writeFileSync(join(renders, `${sc.name}.wav`), wav(wasm, rate))
  console.log(`${sc.name.padEnd(24)} ${identical ? 'bit-identical' : `max |diff| ${maxDiff.toExponential(2)}`}  peak ${peak.toFixed(3)}  faults ${exports.bd_fault_count()}  non-finite ${nonFinite}`)
}
console.log(`renders → ${renders}`)
if (worst > 1e-4) process.exit(1)
