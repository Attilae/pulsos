// The pinned wasi-sdk toolchain shared by the DSP builds (scripts/build_resonator.js,
// scripts/build_clouds.js). Downloaded once into dsp/.toolchain/ (gitignored) and
// verified against the SHA-256 digests below; WASI_SDK_PATH overrides the download
// with a local install of the same version.
//
// wasi-sdk rather than Emscripten because each module must instantiate inside an
// AudioWorkletGlobalScope with no JS glue: the builds link with --no-entry and
// export a plain C ABI with zero imports.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { platform, arch } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const WASI_SDK = {
  tag: 'wasi-sdk-34',
  version: '34.0',
  assets: {
    'arm64-macos':  'sha256:9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9',
    'x86_64-macos': 'sha256:87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb',
    'arm64-linux':  'sha256:f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971',
    'x86_64-linux': 'sha256:b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4',
  },
}

export const TOOLCHAIN_DIR = join(root, 'dsp', '.toolchain')

export const WASM_FLAGS = [
  '--target=wasm32-wasip1',
  '-mcpu=mvp', '-mbulk-memory', '-mnontrapping-fptoint', '-msign-ext', '-mmutable-globals',
  '-nostartfiles',
  '-Wl,--no-entry', '-Wl,--gc-sections', '-Wl,--strip-all',
  '-Wl,-z,stack-size=65536',
]

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function hostKey() {
  const os = platform() === 'darwin' ? 'macos' : platform() === 'linux' ? 'linux' : null
  const cpu = arch() === 'arm64' ? 'arm64' : arch() === 'x64' ? 'x86_64' : null
  if (!os || !cpu) throw new Error(`No pinned wasi-sdk for ${platform()}/${arch()}; set WASI_SDK_PATH`)
  return `${cpu}-${os}`
}

export async function ensureToolchain() {
  if (process.env.WASI_SDK_PATH) return process.env.WASI_SDK_PATH
  const key = hostKey()
  const name = `wasi-sdk-${WASI_SDK.version}-${key}`
  const dir = TOOLCHAIN_DIR
  const sdk = join(dir, name)
  if (existsSync(join(sdk, 'bin', 'clang++'))) return sdk

  mkdirSync(dir, { recursive: true })
  const url = `https://github.com/WebAssembly/wasi-sdk/releases/download/${WASI_SDK.tag}/${name}.tar.gz`
  const tarball = join(dir, `${name}.tar.gz`)
  console.log(`downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wasi-sdk download failed: ${res.status} ${res.statusText}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tarball))
  const digest = `sha256:${sha256(readFileSync(tarball))}`
  if (digest !== WASI_SDK.assets[key]) {
    unlinkSync(tarball)
    throw new Error(`wasi-sdk digest mismatch for ${name}: got ${digest}, expected ${WASI_SDK.assets[key]}`)
  }
  execFileSync('tar', ['xzf', tarball, '-C', dir])
  unlinkSync(tarball)
  if (platform() === 'darwin') {
    try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', sdk]) } catch {}
  }
  return sdk
}

export function toolchainVersion(sdk) {
  return execFileSync(join(sdk, 'bin', 'clang++'), ['--version']).toString().split('\n')[0].trim()
}

// Every vendored file must match its manifest; a local patch has to be recorded
// there (and in the vendor dir's PROVENANCE.md), never slipped in.
export function verifyVendor(vendorDir) {
  const manifest = JSON.parse(readFileSync(join(vendorDir, 'manifest.json'), 'utf8'))
  const problems = []
  for (const f of manifest.files) {
    const p = join(vendorDir, 'src', f.path)
    if (!existsSync(p)) { problems.push(`missing ${f.path}`); continue }
    const got = sha256(readFileSync(p))
    const want = f.patched ? f.patchedSha256 : f.sha256
    if (got !== want) problems.push(`modified ${f.path} (not recorded as a patch)`)
  }
  if (problems.length) throw new Error(`${vendorDir} does not match its manifest:\n  ${problems.join('\n  ')}`)
  return manifest
}
