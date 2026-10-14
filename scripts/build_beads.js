#!/usr/bin/env node
// Builds Texture Mk II's DSP (dsp/beads/bridge.cc over the vendored Beads
// sources in vendor/beads) into a standalone WebAssembly module. The output is
// committed, so regular `next build`/Vercel builds never need a compiler or a
// network download: this script only runs when the DSP changes.
//
//   node scripts/build_beads.js              build + write assets
//   node scripts/build_beads.js --check      rebuild in a temp dir and fail if
//                                            the committed assets differ
//   node scripts/build_beads.js --reference  also build the native reference
//                                            renderer (host c++) used by
//                                            scripts/beads_compare.js
//
// Toolchain: the pinned wasi-sdk in scripts/lib/wasiSdk.js (shared with the
// Resonator, Clouds and Macro builds).
//
// Writes:
//   public/wasm/beads-<sha8>.wasm     content-addressed, cached immutably
//   public/wasm/beads.manifest.json   toolchain, flags, source + output hashes
//   lib/beadsAsset.js                 generated URL/hash constants for the loader

import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WASI_SDK, WASM_FLAGS, ensureToolchain, sha256, toolchainVersion, verifyVendor,
} from './lib/wasiSdk.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const CHECK = args.has('--check')
const REFERENCE = args.has('--reference')

const VENDOR = join(root, 'vendor', 'beads')
const VENDOR_SRC = join(VENDOR, 'src')
const DSP_DIR = join(root, 'dsp', 'beads')
const WASM_DIR = join(root, 'public', 'wasm')
const MANIFEST = join(WASM_DIR, 'beads.manifest.json')
const ASSET_MODULE = join(root, 'lib', 'beadsAsset.js')
const NAME = 'beads'
// Translation units, in link order. Headers are covered by the vendor manifest.
const SOURCES = [
  'dsp/beads/bridge.cc',
  'vendor/beads/src/beads/dsp/processor.cc',
  'vendor/beads/src/beads/dsp/delay_clock.cc',
  'vendor/beads/src/beads/dsp/delay_controller.cc',
  'vendor/beads/src/beads/dsp/trigger_generator.cc',
  'vendor/beads/src/beads/dsp/mu_law.cc',
  'vendor/beads/src/beads/resources.cc',
  'vendor/beads/src/stmlib/dsp/units.cc',
  'vendor/beads/src/stmlib/utils/random.cc',
]

// Same switches as the Resonator build: -DTEST selects upstream's portable math,
// -ffp-contract=off keeps native and wasm comparable. -DNDEBUG drops
// delay_line.h's asserts (they would import abort). Upstream sizes a few
// scratch arrays by the block length (a clang VLA extension; at most 12 frames).
const COMMON_FLAGS = ['-O3', '-DTEST', '-DNDEBUG', '-Wno-vla-cxx-extension', '-Wno-unknown-warning-option', '-fno-exceptions', '-fno-rtti', '-ffp-contract=off', '-std=c++14', `-I${VENDOR_SRC}`]

// Beads, like Plaits, includes C++ standard headers (<cmath>, <algorithm>).
// wasi-sdk keeps libc++'s headers per exception mode; these are the no-exceptions
// ones, matching -fno-exceptions. Header-only use: nothing from libc++ is linked.
const CXX_HEADERS = ['-isystem', '<sysroot>/include/wasm32-wasip1/noeh/c++/v1']

const rel = (p) => relative(root, p).split('\\').join('/')

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
    throw new Error(`${NAME}.wasm must have no imports, found: ${imports.map(i => `${i.module}.${i.name}`).join(', ')}`)
  }
  return bytes
}

function buildReference() {
  const out = join(DSP_DIR, '.build')
  mkdirSync(out, { recursive: true })
  const bin = join(out, 'beads-reference')
  const cxx = process.env.CXX || 'c++'
  execFileSync(cxx, [
    ...COMMON_FLAGS, '-o', bin,
    join(DSP_DIR, 'reference.cc'), ...SOURCES.map(s => join(root, s)),
  ], { stdio: 'inherit' })
  console.log(`reference → ${rel(bin)}`)
}

async function main() {
  const vendor = verifyVendor(VENDOR)
  const sdk = await ensureToolchain()
  const tmp = mkdtempSync(join(tmpdir(), 'beads-'))
  try {
    const bytes = buildWasm(sdk, join(tmp, `${NAME}.wasm`))
    const hash = sha256(bytes)
    const asset = `${NAME}-${hash.slice(0, 8)}.wasm`

    if (CHECK) {
      const committed = JSON.parse(readFileSync(MANIFEST, 'utf8'))
      const onDisk = existsSync(join(WASM_DIR, committed.asset)) ? sha256(readFileSync(join(WASM_DIR, committed.asset))) : null
      if (committed.sha256 !== hash || onDisk !== hash) {
        console.error(`${NAME}.wasm is stale: rebuilt ${hash}, manifest ${committed.sha256}, on disk ${onDisk}`)
        process.exit(1)
      }
      console.log(`${NAME}.wasm matches its sources (${asset})`)
      return
    }

    mkdirSync(WASM_DIR, { recursive: true })
    const stale = new RegExp(`^${NAME}-[0-9a-f]{8}\\.wasm$`)
    for (const f of readdirSync(WASM_DIR)) {
      if (stale.test(f) && f !== asset) rmSync(join(WASM_DIR, f))
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
      flags: [...WASM_FLAGS, ...CXX_HEADERS, ...COMMON_FLAGS.map(f => f.startsWith('-I') ? '-Ivendor/beads/src' : f)],
      upstream: vendor.upstream,
      sources: SOURCES.map(s => ({ path: s, sha256: sha256(readFileSync(join(root, s))) })),
      exports: WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(e => e.name),
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')

    writeFileSync(ASSET_MODULE, [
      '// Generated by scripts/build_beads.js — do not edit by hand.',
      '// The Texture Mk II (Beads) DSP module (see public/wasm/beads.manifest.json).',
      `export const BEADS_WASM_URL = '/wasm/${asset}'`,
      `export const BEADS_WASM_SHA256 = '${hash}'`,
      `export const BEADS_WASM_BYTES = ${bytes.length}`,
      '',
    ].join('\n'))


    console.log(`beads → public/wasm/${asset} (${bytes.length} bytes, sha256 ${hash.slice(0, 16)}…)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (REFERENCE) buildReference()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
