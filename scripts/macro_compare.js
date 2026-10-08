#!/usr/bin/env node
// Native vs WebAssembly reference comparison for the Macro DSP. Renders the
// same scenarios (identical seed, patch and note schedule) through the native
// reference binary and the committed wasm module, then reports the largest
// sample difference per scenario. Also writes both renders as WAV files so they
// can be auditioned side by side.
//
//   node scripts/build_macro.js --reference   # builds the native binary
//   node scripts/macro_compare.js [--out dir] [--tolerance 1e-4]
//
// Tolerance: both builds use -ffp-contract=off and the same sources, but libm
// (Apple libm vs wasi-libc) and compiler scheduling can differ in the last
// float bits; the recursive filters let those bits wander. A difference under
// the tolerance (-80 dBFS by default) is inaudible and is treated as a match.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MACRO_SCENARIOS, renderScenarioWasm, scenarioToText } from './lib/macroScenarios.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : fallback
}
const outDir = opt('--out', join(root, 'dsp', 'macro', '.build', 'renders'))
const tolerance = Number(opt('--tolerance', '1e-4'))

const bin = join(root, 'dsp', 'macro', '.build', 'macro-reference')
if (!existsSync(bin)) {
  console.error('native reference missing — run: node scripts/build_macro.js --reference')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(root, 'public', 'wasm', 'macro.manifest.json'), 'utf8'))
const wasmBytes = readFileSync(join(root, 'public', 'wasm', manifest.asset))
const wasmModule = new WebAssembly.Module(wasmBytes)

function writeWav(path, interleaved, sampleRate = 48000) {
  const n = interleaved.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

mkdirSync(outDir, { recursive: true })
let failures = 0
for (const sc of MACRO_SCENARIOS) {
  const scenarioFile = join(outDir, `${sc.name}.txt`)
  const nativeFile = join(outDir, `${sc.name}.native.f32`)
  writeFileSync(scenarioFile, scenarioToText(sc))
  execFileSync(bin, [scenarioFile, nativeFile])
  const raw = readFileSync(nativeFile)
  const native = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const { out: wasm, exports } = renderScenarioWasm(wasmModule, sc)

  let maxDiff = 0, peak = 0, nonFinite = 0
  for (let i = 0; i < native.length; i++) {
    if (!Number.isFinite(wasm[i]) || !Number.isFinite(native[i])) nonFinite++
    maxDiff = Math.max(maxDiff, Math.abs(native[i] - wasm[i]))
    peak = Math.max(peak, Math.abs(wasm[i]))
  }
  const ok = native.length === wasm.length && nonFinite === 0 && maxDiff <= tolerance && exports.mc_fault_count() === 0
  if (!ok) failures++
  writeWav(join(outDir, `${sc.name}.native.wav`), native)
  writeWav(join(outDir, `${sc.name}.wasm.wav`), wasm)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${sc.name.padEnd(28)} maxDiff ${maxDiff.toExponential(2)}  peak ${peak.toFixed(3)}  samples ${native.length}  faults ${exports.mc_fault_count()}`)
}
console.log(`renders in ${outDir}`)
process.exit(failures ? 1 : 0)
