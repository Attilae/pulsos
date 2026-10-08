#!/usr/bin/env node
// Builds the Macro instrument's DSP (dsp/macro/bridge.cc over the
// vendored Plaits sources in vendor/plaits) into a standalone WebAssembly module.
// The output is committed, so regular `next build`/Vercel builds never need a
// compiler or a network download — this script only runs when the DSP changes.
//
//   node scripts/build_macro.js              build + write assets
//   node scripts/build_macro.js --check      rebuild in a temp dir and fail
//                                                if the committed assets differ
//   node scripts/build_macro.js --reference  also build the native reference
//                                                renderer (host c++) used by
//                                                scripts/macro_compare.js
//
// Toolchain: a pinned wasi-sdk release (clang + wasm-ld + wasi-libc headers),
// downloaded once into dsp/.toolchain/ (gitignored) by scripts/lib/wasiSdk.js and
// verified against the SHA-256 digests there. WASI_SDK_PATH overrides the download with a
// local install of the same version. wasi-sdk rather than Emscripten because
// the module must instantiate inside an AudioWorkletGlobalScope with no JS glue:
// the build links with --no-entry and exports a plain C ABI with zero imports.
//
// Writes:
//   public/wasm/macro-<sha8>.wasm   content-addressed, so it can be cached
//                                       immutably (see next.config headers)
//   public/wasm/macro.manifest.json toolchain, flags, source + output hashes
//   lib/macroAsset.js               generated URL/hash constants for the loader

import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WASI_SDK, WASM_FLAGS, ensureToolchain, sha256, toolchainVersion, verifyVendor as verifyVendorDir,
} from './lib/wasiSdk.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const CHECK = args.has('--check')
const REFERENCE = args.has('--reference')

const VENDOR = join(root, 'vendor', 'plaits')
const VENDOR_SRC = join(VENDOR, 'src')
const DSP_DIR = join(root, 'dsp', 'macro')
const WASM_DIR = join(root, 'public', 'wasm')
const MANIFEST = join(WASM_DIR, 'macro.manifest.json')
const ASSET_MODULE = join(root, 'lib', 'macroAsset.js')

// Translation units, in link order. Headers are covered by the vendor manifest.
const SOURCES = [
  'dsp/macro/bridge.cc',
  'vendor/plaits/src/plaits/dsp/chords/chord_bank.cc',
  'vendor/plaits/src/plaits/dsp/engine/additive_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/bass_drum_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/chord_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/fm_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/grain_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/hi_hat_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/modal_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/noise_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/particle_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/snare_drum_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/speech_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/string_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/swarm_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/virtual_analog_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/waveshaping_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine/wavetable_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine2/chiptune_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine2/phase_distortion_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine2/six_op_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine2/string_machine_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine2/virtual_analog_vcf_engine.cc',
  'vendor/plaits/src/plaits/dsp/engine2/wave_terrain_engine.cc',
  'vendor/plaits/src/plaits/dsp/fm/algorithms.cc',
  'vendor/plaits/src/plaits/dsp/fm/dx_units.cc',
  'vendor/plaits/src/plaits/dsp/physical_modelling/modal_voice.cc',
  'vendor/plaits/src/plaits/dsp/physical_modelling/resonator.cc',
  'vendor/plaits/src/plaits/dsp/physical_modelling/string.cc',
  'vendor/plaits/src/plaits/dsp/physical_modelling/string_voice.cc',
  'vendor/plaits/src/plaits/dsp/speech/lpc_speech_synth.cc',
  'vendor/plaits/src/plaits/dsp/speech/lpc_speech_synth_controller.cc',
  'vendor/plaits/src/plaits/dsp/speech/lpc_speech_synth_phonemes.cc',
  'vendor/plaits/src/plaits/dsp/speech/lpc_speech_synth_words.cc',
  'vendor/plaits/src/plaits/dsp/speech/naive_speech_synth.cc',
  'vendor/plaits/src/plaits/dsp/speech/sam_speech_synth.cc',
  'vendor/plaits/src/plaits/dsp/voice.cc',
  'vendor/plaits/src/plaits/resources.cc',
  'vendor/plaits/src/stmlib/dsp/units.cc',
  'vendor/plaits/src/stmlib/utils/random.cc',
]

// -DTEST selects upstream's portable (non-ARM-assembly) code paths — the same
// switch its desktop test build uses. -ffp-contract=off keeps the native
// reference build from fusing multiply-adds that wasm cannot, so the two stay
// comparable.
// `-include stdio.h`: in TEST mode plaits/user_data.h mocks the flash writer
// with printf but doesn't include <stdio.h> itself (upstream's test harness
// always included it first). The mock is never called here.
const COMMON_FLAGS = ['-O3', '-DTEST', '-include', 'stdio.h', '-fno-exceptions', '-fno-rtti', '-ffp-contract=off', '-std=c++14', `-I${VENDOR_SRC}`]
// Plaits, unlike Rings, includes C++ standard headers (<cmath>, <algorithm>).
// wasi-sdk keeps libc++'s headers per exception mode; these are the no-exceptions
// ones, matching -fno-exceptions. Header-only use: nothing from libc++ is linked.
const CXX_HEADERS = ['-isystem', '<sysroot>/include/wasm32-wasip1/noeh/c++/v1']
const rel = (p) => relative(root, p).split('\\').join('/')

// Every vendored file must match vendor/plaits/manifest.json.
function verifyVendor() {
  return verifyVendorDir(VENDOR)
}

function buildWasm(sdk, outFile) {
  const clang = join(sdk, 'bin', 'clang++')
  const sysroot = join(sdk, 'share', 'wasi-sysroot')
  execFileSync(clang, [
    ...WASM_FLAGS, `--sysroot=${sysroot}`, ...CXX_HEADERS.map(f => f.replace('<sysroot>', sysroot)), ...COMMON_FLAGS,
    '-o', outFile, ...SOURCES.map(s => join(root, s)),
  ], { stdio: 'inherit' })
  const bytes = readFileSync(outFile)
  const mod = new WebAssembly.Module(bytes)
  const imports = WebAssembly.Module.imports(mod)
  if (imports.length) {
    throw new Error(`macro.wasm must have no imports, found: ${imports.map(i => `${i.module}.${i.name}`).join(', ')}`)
  }
  return bytes
}

function buildReference() {
  const out = join(DSP_DIR, '.build')
  mkdirSync(out, { recursive: true })
  const bin = join(out, 'macro-reference')
  const cxx = process.env.CXX || 'c++'
  execFileSync(cxx, [
    ...COMMON_FLAGS, '-o', bin,
    join(DSP_DIR, 'reference.cc'), ...SOURCES.map(s => join(root, s)),
  ], { stdio: 'inherit' })
  console.log(`reference → ${rel(bin)}`)
}

async function main() {
  const vendor = verifyVendor()
  const sdk = await ensureToolchain()
  const tmp = mkdtempSync(join(tmpdir(), 'macro-'))
  try {
    const bytes = buildWasm(sdk, join(tmp, 'macro.wasm'))
    const hash = sha256(bytes)
    const asset = `macro-${hash.slice(0, 8)}.wasm`

    if (CHECK) {
      const committed = JSON.parse(readFileSync(MANIFEST, 'utf8'))
      const onDisk = existsSync(join(WASM_DIR, committed.asset)) ? sha256(readFileSync(join(WASM_DIR, committed.asset))) : null
      if (committed.sha256 !== hash || onDisk !== hash) {
        console.error(`macro.wasm is stale: rebuilt ${hash}, manifest ${committed.sha256}, on disk ${onDisk}`)
        process.exit(1)
      }
      console.log(`macro.wasm matches its sources (${asset})`)
      return
    }

    mkdirSync(WASM_DIR, { recursive: true })
    for (const f of readdirSync(WASM_DIR)) {
      if (/^macro-[0-9a-f]{8}\.wasm$/.test(f) && f !== asset) rmSync(join(WASM_DIR, f))
    }
    writeFileSync(join(WASM_DIR, asset), bytes)

    const manifest = {
      asset,
      sha256: hash,
      bytes: bytes.length,
      toolchain: {
        name: 'wasi-sdk', tag: WASI_SDK.tag, version: WASI_SDK.version,
        clang: toolchainVersion(sdk), assets: WASI_SDK.assets,
      },
      flags: [...WASM_FLAGS, ...CXX_HEADERS, ...COMMON_FLAGS.map(f => f.startsWith('-I') ? '-Ivendor/plaits/src' : f)],
      upstream: vendor.upstream,
      sources: SOURCES.map(s => ({ path: s, sha256: sha256(readFileSync(join(root, s))) })),
      exports: WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(e => e.name),
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')

    writeFileSync(ASSET_MODULE, [
      '// Generated by scripts/build_macro.js — do not edit by hand.',
      '// The Macro DSP module (see public/wasm/macro.manifest.json).',
      `export const MACRO_WASM_URL = '/wasm/${asset}'`,
      `export const MACRO_WASM_SHA256 = '${hash}'`,
      `export const MACRO_WASM_BYTES = ${bytes.length}`,
      '',
    ].join('\n'))

    console.log(`macro → public/wasm/${asset} (${bytes.length} bytes, sha256 ${hash.slice(0, 16)}…)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (REFERENCE) buildReference()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
