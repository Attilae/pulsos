#!/usr/bin/env node
// Import the Drum Machine's Stargate sample kits (lib/drumKit.js) from the
// CC0 Stargate DAW sample pack, pinned to one commit so a rerun is byte-stable.
// Research and licence checks: docs/drum-samples-research.md.
//
//   node scripts/import_drum_samples.js [--cache <dir>]
//
// Needs ffmpeg + ffprobe on PATH. For each pad it downloads the source file,
// then: mono, 44.1 kHz, 16-bit; leading and trailing silence trimmed; capped at
// the pad's maximum length with a short fade; peak at PEAK_DB (the 808 kit's
// recordings peak at about -3 dBFS, so the kits sit at the same level).
// Writes public/samples/drums/<dir>/<pad>.wav and the generated section of
// public/samples/drums/ATTRIBUTION.md between the stargate markers.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'stargatedaw/stargate-sample-pack'
const COMMIT = 'dbfd6ec52d4ed53b60bdbea5fc6adf295127c027'
const PACK = 'stargate-sample-pack'
const PEAK_DB = -3
const FADE_SEC = 0.03
// Longest a pad may ring, in seconds. Cymbals keep more of their tail.
const MAX_SEC = { kick: 1.5, snare: 1.0, hat: 0.6, rim: 0.6, ride: 3.0, clap: 1.0 }

const FS = 'fugue-state-audio/drums'
const KR = 'karoryfer'
const FSD = 'freesound/drums'

// dir = folder under public/samples/drums; must match lib/drumKit.js.
export const STARGATE_KITS = [
  {
    dir: 'x0x', label: 'x0x', origin: 'Fugue State Audio, kit `x0xproc1` (synthesized)',
    pads: {
      kick: `${FS}/kicks/x0xproc1-kick.wav`, snare: `${FS}/snares/x0xproc1-snare.wav`,
      hat: `${FS}/hihats/x0xproc1-hatclsd.wav`, rim: `${FS}/percussion/x0xproc1-rimshot.wav`,
      ride: `${FS}/cymbals/x0xproc1-ride.wav`, clap: `${FS}/claps/x0xproc1-clap.wav`,
    },
  },
  {
    dir: 'x0x-grit', label: 'x0x grit', origin: 'Fugue State Audio, kit `x0xproc2` (synthesized)',
    pads: {
      kick: `${FS}/kicks/x0xproc2-kick.wav`, snare: `${FS}/snares/x0xproc2-snare.wav`,
      hat: `${FS}/hihats/x0xproc2-hatclsd.wav`, rim: `${FS}/percussion/x0xproc2-rimshot.wav`,
      ride: `${FS}/cymbals/x0xproc2-cymbal.wav`, clap: `${FS}/claps/x0xproc2-clap.wav`,
    },
  },
  {
    dir: 'synth', label: 'Synth kit', origin: 'Fugue State Audio, kit `synthkit` (synthesized)',
    pads: {
      kick: `${FS}/kicks/synthkit-kick.wav`, snare: `${FS}/snares/synthkit-snare.wav`,
      hat: `${FS}/hihats/synthkit-hatclsd.wav`, rim: `${FS}/percussion/synthkit-8bit.wav`,
      ride: `${FS}/cymbals/synthkit-ride.wav`, clap: `${FS}/claps/synthkit-clap.wav`,
    },
  },
  {
    dir: 'distorted', label: 'Distorted', origin: 'Fugue State Audio, kit `distkit` (synthesized)',
    pads: {
      kick: `${FS}/kicks/distkit-kick.wav`, snare: `${FS}/snares/distkit-snare.wav`,
      hat: `${FS}/hihats/distkit-hatclsd.wav`, rim: `${FS}/percussion/distkit-claves.wav`,
      ride: `${FS}/cymbals/distkit-ride.wav`, clap: `${FS}/claps/distkit-clap.wav`,
    },
  },
  {
    dir: 'acoustic', label: 'Acoustic',
    origin: 'Karoryfer Samples (Big Rusty, Unruly and Swirly Drums, as picked for the Stargate pack); rim and clap from Freesound (CC0)',
    pads: {
      kick: `${KR}/kicks/kick_Szpaderski_24_dampened.wav`, snare: `${KR}/snares/snare_12x5.wav`,
      hat: `${KR}/hihats/hihat_BRD_tight.wav`, rim: `${FSD}/rimshot/132418__sajmund__rimshot-sweet.aiff`,
      ride: `${KR}/cymbals/ride_BRD_22.wav`, clap: `${FSD}/clap/493707__bastianpusch__handclap01.wav`,
    },
  },
  {
    dir: 'rusty', label: 'Rusty acoustic',
    origin: 'Karoryfer Samples (as above); rim and clap from Freesound (CC0)',
    pads: {
      kick: `${KR}/kicks/kick_Polmuz_mod_20_buzz.wav`, snare: `${KR}/snares/snare_ziggurat.wav`,
      hat: `${KR}/hihats/hihat_BRD_closed.wav`, rim: `${FSD}/rimshot/511382__pjhedman__se1-rim.wav`,
      ride: `${KR}/cymbals/ride_UD_20.wav`, clap: `${FSD}/clap/388042__sami-kullstrom__clap.wav`,
    },
  },
]

async function download(path, cacheDir) {
  const local = join(cacheDir, path)
  if (existsSync(local)) return local
  mkdirSync(dirname(local), { recursive: true })
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${PACK}/${path.split('/').map(encodeURIComponent).join('/')}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  writeFileSync(local, Buffer.from(await res.arrayBuffer()))
  return local
}

function ffmpegLog(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
  return r.stderr // ffmpeg logs (including volumedetect) to stderr
}
const durationOf = f => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())
function measurePeakDb(f) {
  const m = /max_volume: (-?[\d.]+) dB/.exec(ffmpegLog(['-i', f, '-af', 'volumedetect', '-f', 'null', '-']))
  if (!m) throw new Error(`no peak for ${f}`)
  return Number(m[1])
}

function processFile(src, out, padId, tmp) {
  const max = MAX_SEC[padId]
  const stage = join(tmp, `stage-${padId}.wav`)
  // Pass 1: mono 44.1 kHz, trim silence at both ends, cap the length.
  ffmpegLog(['-y', '-i', src, '-ac', '1', '-ar', '44100', '-af', [
    'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.002',
    'areverse', 'silenceremove=start_periods=1:start_threshold=-60dB', 'areverse',
    `atrim=0:${max}`,
  ].join(','), '-c:a', 'pcm_f32le', stage])
  const dur = durationOf(stage)
  const gain = PEAK_DB - measurePeakDb(stage)
  // Pass 2: fade the last few ms (so a capped tail doesn't click), set the peak.
  ffmpegLog(['-y', '-i', stage, '-af', [
    `afade=t=out:st=${Math.max(0, dur - FADE_SEC).toFixed(4)}:d=${FADE_SEC}`,
    `volume=${gain.toFixed(2)}dB`,
  ].join(','), '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-bitexact', out])
  return { dur: durationOf(out) }
}

function attributionSection(rows) {
  const lines = [
    '<!-- stargate:begin (generated by scripts/import_drum_samples.js; do not edit by hand) -->',
    '',
    'The kits below come from the [Stargate DAW sample pack](https://github.com/stargatedaw/stargate-sample-pack)',
    `(commit \`${COMMIT.slice(0, 12)}\`), licensed [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)`,
    'in that repository\'s `LICENSE`. Its folder READMEs give the origins: Fugue State Audio\'s kits are',
    'synthesized and given to the public domain; the `karoryfer/` files are picks from Karoryfer Samples\'',
    'CC0 kits (Big Rusty Drums, Unruly Drums, Swirly Drums); `freesound/` files are CC0 uploads to',
    'freesound.org, with the Freesound sound id at the start of the file name.',
    '',
    'Each file was converted to mono 16-bit 44.1 kHz, trimmed of silence at both ends, capped in length',
    `with a ${FADE_SEC * 1000} ms fade, and peak-normalised to ${PEAK_DB} dBFS.`,
    '',
  ]
  for (const kit of rows) {
    lines.push(`## \`${kit.dir}/\` — ${kit.label} (CC0)`, '', `${kit.origin}.`, '')
    lines.push('| File | Pad | Source (stargate-sample-pack) |', '| ---- | --- | ----------------------------- |')
    for (const [pad, path] of Object.entries(kit.pads)) lines.push(`| \`${pad}.wav\` | ${pad} | \`${path}\` |`)
    lines.push('')
  }
  lines.push('<!-- stargate:end -->')
  return lines.join('\n')
}

async function main() {
  const i = process.argv.indexOf('--cache')
  const cacheDir = i > 0 ? resolve(process.argv[i + 1]) : join(tmpdir(), 'leid-stargate-cache')
  const tmp = join(cacheDir, '_tmp')
  mkdirSync(tmp, { recursive: true })
  for (const kit of STARGATE_KITS) {
    const outDir = join(ROOT, 'public/samples/drums', kit.dir)
    mkdirSync(outDir, { recursive: true })
    for (const [pad, path] of Object.entries(kit.pads)) {
      const src = await download(path, cacheDir)
      const { dur } = processFile(src, join(outDir, `${pad}.wav`), pad, tmp)
      console.log(`${kit.dir}/${pad}.wav  ${dur.toFixed(2)} s  ← ${path}`)
    }
  }
  const attrPath = join(ROOT, 'public/samples/drums/ATTRIBUTION.md')
  const attr = readFileSync(attrPath, 'utf8')
  const section = attributionSection(STARGATE_KITS)
  const re = /<!-- stargate:begin[\s\S]*?<!-- stargate:end -->/
  writeFileSync(attrPath, re.test(attr) ? attr.replace(re, section) : `${attr.trimEnd()}\n\n${section}\n`)
  console.log('ATTRIBUTION.md updated')
}

main().catch(e => { console.error(e); process.exit(1) })
