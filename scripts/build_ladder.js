#!/usr/bin/env node
// Builds the Analog lane filter's DSP (dsp/ladder/bridge.cc over the vendored
// DaisySP LadderFilter in vendor/daisysp) into a standalone WebAssembly module.
// The output is committed, so regular `next build`/Vercel builds never need a
// compiler or a network download — this script only runs when the DSP changes.
//
//   node scripts/build_ladder.js              build + write assets
//   node scripts/build_ladder.js --check      rebuild in a temp dir and fail if
//                                             the committed assets differ
//   node scripts/build_ladder.js --reference  also build the native reference
//                                             renderer (host c++) used by
//                                             scripts/ladder_compare.js
//
// Toolchain: the pinned wasi-sdk in scripts/lib/wasiSdk.js (shared with the
// Resonator, Clouds and Macro builds; WASI_SDK_PATH overrides the download).
//
// Writes:
//   public/wasm/ladder-<sha8>.wasm     content-addressed, cached immutably
//   public/wasm/ladder.manifest.json   toolchain, flags, source + output hashes
//   lib/ladderAsset.js                 generated URL/hash constants for the loader

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

const VENDOR = join(root, 'vendor', 'daisysp')
const VENDOR_SRC = join(VENDOR, 'src', 'Source')
const DSP_DIR = join(root, 'dsp', 'ladder')
const WASM_DIR = join(root, 'public', 'wasm')
const MANIFEST = join(WASM_DIR, 'ladder.manifest.json')
const ASSET_MODULE = join(root, 'lib', 'ladderAsset.js')
const NAME = 'ladder'
const ABI_VERSION = 1

// Translation units, in link order. Headers are covered by the vendor manifest.
const SOURCES = [
  'dsp/ladder/bridge.cc',
  'vendor/daisysp/src/Source/Filters/ladder.cpp',
]

// -ffp-contract=off keeps the native reference build from fusing multiply-adds
// that wasm cannot, so the two stay comparable. -Wno-unknown-attributes: see
// vendor/daisysp/PROVENANCE.md (a GCC-only attribute on the unused ProcessBlock).
const COMMON_FLAGS = ['-O3', '-fno-exceptions', '-fno-rtti', '-ffp-contract=off', '-std=c++14', '-Wno-unknown-attributes', `-I${VENDOR_SRC}`]
// ladder.h includes <array> and dsp.h <cmath>/<random>: header-only libc++ use,
// the no-exceptions variant matching -fno-exceptions. Nothing from libc++ links.
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
  const abi = new WebAssembly.Instance(mod, {}).exports.ld_abi_version()
  if (abi !== ABI_VERSION) throw new Error(`${NAME}.wasm ABI ${abi}, expected ${ABI_VERSION}`)
  return bytes
}

function buildReference() {
  const out = join(DSP_DIR, '.build')
  mkdirSync(out, { recursive: true })
  const bin = join(out, 'ladder-reference')
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
  const tmp = mkdtempSync(join(tmpdir(), 'ladder-'))
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
      abiVersion: ABI_VERSION,
      toolchain: {
        name: 'wasi-sdk', tag: WASI_SDK.tag, version: WASI_SDK.version,
        clang: toolchainVersion(sdk), assets: WASI_SDK.assets,
      },
      flags: [...WASM_FLAGS, ...CXX_HEADERS, ...COMMON_FLAGS.map(f => f.startsWith('-I') ? '-Ivendor/daisysp/src/Source' : f)],
      upstream: vendor.upstream,
      sources: SOURCES.map(s => ({ path: s, sha256: sha256(readFileSync(join(root, s))) })),
      exports: WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(e => e.name),
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')

    writeFileSync(ASSET_MODULE, [
      '// Generated by scripts/build_ladder.js — do not edit by hand.',
      '// The Analog lane filter DSP module (see public/wasm/ladder.manifest.json).',
      `export const LADDER_WASM_URL = '/wasm/${asset}'`,
      `export const LADDER_WASM_SHA256 = '${hash}'`,
      `export const LADDER_WASM_BYTES = ${bytes.length}`,
      `export const LADDER_ABI_VERSION = ${ABI_VERSION}`,
      '',
    ].join('\n'))

    console.log(`ladder → public/wasm/${asset} (${bytes.length} bytes, sha256 ${hash.slice(0, 16)}…)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (REFERENCE) buildReference()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
