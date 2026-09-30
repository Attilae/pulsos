#!/usr/bin/env node
// Builds the Clouds granular layer's DSP (dsp/clouds/bridge.cc over the vendored
// Clouds sources in vendor/clouds) into a standalone WebAssembly module. The
// output is committed, so regular `next build`/Vercel builds never need a
// compiler or a network download — this script only runs when the DSP changes.
//
//   node scripts/build_clouds.js              build + write assets
//   node scripts/build_clouds.js --check      rebuild in a temp dir and fail if
//                                             the committed assets differ
//   node scripts/build_clouds.js --reference  also build the native reference
//                                             renderer (host c++) used by
//                                             scripts/clouds_compare.js
//
// Toolchain: the pinned wasi-sdk in scripts/lib/wasiSdk.js (shared with the
// Resonator build).
//
// Writes:
//   public/wasm/clouds-granular-<sha8>.wasm   content-addressed, cached immutably
//   public/wasm/clouds-granular.manifest.json toolchain, flags, source + output hashes
//   lib/cloudsGranularAsset.js                generated URL/hash constants for the loader

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

const VENDOR = join(root, 'vendor', 'clouds')
const VENDOR_SRC = join(VENDOR, 'src')
const DSP_DIR = join(root, 'dsp', 'clouds')
const WASM_DIR = join(root, 'public', 'wasm')
const MANIFEST = join(WASM_DIR, 'clouds-granular.manifest.json')
const ASSET_MODULE = join(root, 'lib', 'cloudsGranularAsset.js')
const NAME = 'clouds-granular'

// Translation units, in link order. Headers are covered by the vendor manifest.
const SOURCES = [
  'dsp/clouds/bridge.cc',
  'vendor/clouds/src/clouds/resources.cc',
  'vendor/clouds/src/clouds/dsp/mu_law.cc',
  'vendor/clouds/src/stmlib/dsp/units.cc',
  'vendor/clouds/src/stmlib/utils/random.cc',
]

// Same switches as the Resonator build: -DTEST selects upstream's portable math,
// -ffp-contract=off keeps native and wasm comparable.
const COMMON_FLAGS = ['-O3', '-DTEST', '-fno-exceptions', '-fno-rtti', '-ffp-contract=off', '-std=c++14', `-I${VENDOR_SRC}`]

const rel = (p) => relative(root, p).split('\\').join('/')

function buildWasm(sdk, outFile) {
  const clang = join(sdk, 'bin', 'clang++')
  const sysroot = join(sdk, 'share', 'wasi-sysroot')
  execFileSync(clang, [
    ...WASM_FLAGS, `--sysroot=${sysroot}`, ...COMMON_FLAGS,
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
  const bin = join(out, 'clouds-reference')
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
  const tmp = mkdtempSync(join(tmpdir(), 'clouds-'))
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
      flags: [...WASM_FLAGS, ...COMMON_FLAGS.map(f => f.startsWith('-I') ? '-Ivendor/clouds/src' : f)],
      upstream: vendor.upstream,
      sources: SOURCES.map(s => ({ path: s, sha256: sha256(readFileSync(join(root, s))) })),
      exports: WebAssembly.Module.exports(new WebAssembly.Module(bytes)).map(e => e.name),
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')

    writeFileSync(ASSET_MODULE, [
      '// Generated by scripts/build_clouds.js — do not edit by hand.',
      '// The Clouds granular DSP module (see public/wasm/clouds-granular.manifest.json).',
      `export const CLOUDS_WASM_URL = '/wasm/${asset}'`,
      `export const CLOUDS_WASM_SHA256 = '${hash}'`,
      `export const CLOUDS_WASM_BYTES = ${bytes.length}`,
      '',
    ].join('\n'))

    console.log(`clouds → public/wasm/${asset} (${bytes.length} bytes, sha256 ${hash.slice(0, 16)}…)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (REFERENCE) buildReference()
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
