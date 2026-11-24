// Drum kits and per-pad voice settings. Pure, no Tone import: the Drum Machine
// tab, song state and the AI plan contract share it; lib/drumVoices.js builds
// the actual Tone voices. Research: docs/drum-research.md §2.1.
//
// Stored sparse on the drum pattern object, beside the groove keys:
//   kit:    'layered'                               absent = 'classic' (the original kit)
//   voices: { padId: { tune, decay, tone } }        absent / default values dropped
//   levels: { padId: dB }                           pad volume, -30..+6; absent / 0 dropped
//
//   tune   semitones, -12..12 (noise pads shift their noise rate instead)
//   decay  multiplier on the voice's decay and release, 0.25..4
//   tone   -1..1: below 0 a low-pass darkens the pad, above 0 a high-pass thins it;
//          0 inserts no filter at all, so a Classic pad at defaults is unchanged.

import { PAD_DEFS } from './drumSpecs.js'

// Sample kits name one file per pad (public/, licences in
// public/samples/drums/ATTRIBUTION.md). Decay can only shorten a sample.
const TR808_DIR = '/samples/drums/808/'

// One file per pad from public/samples/drums/<dir>/<pad>.wav. The Stargate kits
// are written by scripts/import_drum_samples.js (CC0 Stargate DAW sample pack;
// research: docs/drum-samples-research.md).
const padFiles = dir => Object.fromEntries(
  PAD_DEFS.map(p => [p.id, `/samples/drums/${dir}/${p.id}.wav`]),
)

export const DRUM_KITS = [
  { id: 'classic', label: 'Classic', hint: 'The original synth kit.' },
  { id: 'layered', label: 'Layered', hint: 'Each pad built from layers: a clicky kick with drive, a tuned snare, an 808-style clap.' },
  {
    id: 'tr808', label: '808 samples',
    hint: 'Recordings of a real Roland TR-808: long booming kick, snappy snare, clap, rimshot, cymbal on the ride pad.',
    samples: {
      kick: `${TR808_DIR}kick.wav`, snare: `${TR808_DIR}snare.wav`, hat: `${TR808_DIR}hat.wav`,
      rim: `${TR808_DIR}rim.wav`, ride: `${TR808_DIR}ride.wav`, clap: `${TR808_DIR}clap.wav`,
    },
  },
  {
    id: 'x0x', label: 'x0x',
    hint: 'Processed analog drum-machine sounds: a short punchy kick, crisp snare and clap, tight hats. House, techno, electro.',
    samples: padFiles('x0x'),
  },
  {
    id: 'x0x-grit', label: 'x0x grit',
    hint: 'A dirtier drum machine: a long saturated kick, short snare and rim, a washy cymbal on the ride pad. Industrial, acid, lo-fi techno.',
    samples: padFiles('x0x-grit'),
  },
  {
    id: 'synth', label: 'Synth kit',
    hint: 'Clean synthesized drums with a booming kick and a chiptune blip on the rim pad. Synth-pop, electro, game music.',
    samples: padFiles('synth'),
  },
  {
    id: 'distorted', label: 'Distorted',
    hint: 'Distorted electronic drums: a driven kick and snare, claves on the rim pad, a long trashy ride. Breakbeat, industrial, noise.',
    samples: padFiles('distorted'),
  },
  {
    id: 'acoustic', label: 'Acoustic',
    hint: 'A recorded acoustic kit: a dampened kick, a tight snare, closed hats, a ride cymbal and a real hand clap. Jazz, funk, indie, hip-hop.',
    samples: padFiles('acoustic'),
  },
  {
    id: 'rusty', label: 'Rusty acoustic',
    hint: 'A raw, trashy acoustic kit: a buzzing kick, a rattly snare, loose hats and a dark ride. Garage rock, dub, lo-fi.',
    samples: padFiles('rusty'),
  },
]
export const DRUM_KIT_IDS = DRUM_KITS.map(k => k.id)
export const DEFAULT_DRUM_KIT = 'classic'

export const PAD_VOICE_RANGES = Object.freeze({
  tune: Object.freeze({ min: -12, max: 12, step: 1, default: 0 }),
  decay: Object.freeze({ min: 0.25, max: 4, default: 1 }),
  tone: Object.freeze({ min: -1, max: 1, step: 0.05, default: 0 }),
})
export const DEFAULT_PAD_VOICE = Object.freeze({ tune: 0, decay: 1, tone: 0 })
// A pad's volume in dB, on top of the kit's own per-pad balance. Mute is separate.
export const PAD_LEVEL_RANGE = Object.freeze({ min: -30, max: 6, step: 0.5, default: 0 })

const PAD_IDS = PAD_DEFS.map(p => p.id)
const isNum = v => typeof v === 'number' && Number.isFinite(v)
const clampTo = (v, r) => Math.max(r.min, Math.min(r.max, v))

/** A full { tune, decay, tone } for a pad, defaults filled in and clamped. */
export function normalizePadVoice(v) {
  return {
    tune: isNum(v?.tune) ? Math.round(clampTo(v.tune, PAD_VOICE_RANGES.tune)) : 0,
    decay: isNum(v?.decay) ? clampTo(v.decay, PAD_VOICE_RANGES.decay) : 1,
    tone: isNum(v?.tone) ? clampTo(v.tone, PAD_VOICE_RANGES.tone) : 0,
  }
}

const isDefaultVoice = v => v.tune === 0 && v.decay === 1 && v.tone === 0

/** A pad level in dB, clamped to PAD_LEVEL_RANGE and snapped to its step (0 when unset). */
export function normalizePadLevel(db) {
  if (!isNum(db)) return 0
  const r = PAD_LEVEL_RANGE
  return Math.round(clampTo(db, r) / r.step) * r.step + 0   // + 0 turns -0 into 0
}

/** Every pad's level in dB, defaults filled in. */
export function drumPadLevels(dp) {
  return Object.fromEntries(PAD_IDS.map(id => [id, normalizePadLevel(dp?.levels?.[id])]))
}

/**
 * Sparse, validated kit fields of a drum pattern object: { kit?, voices?, levels? }.
 * A pattern with the Classic kit at defaults returns {}, so it stays byte-identical.
 */
export function normalizeDrumKit(dp) {
  const out = {}
  if (DRUM_KIT_IDS.includes(dp?.kit) && dp.kit !== DEFAULT_DRUM_KIT) out.kit = dp.kit
  const voices = {}
  for (const id of PAD_IDS) {
    if (!dp?.voices?.[id]) continue
    const v = normalizePadVoice(dp.voices[id])
    if (!isDefaultVoice(v)) voices[id] = v
  }
  if (Object.keys(voices).length) out.voices = voices
  const levels = {}
  for (const id of PAD_IDS) {
    const db = normalizePadLevel(dp?.levels?.[id])
    if (db !== 0) levels[id] = db
  }
  if (Object.keys(levels).length) out.levels = levels
  return out
}

/** The kit definition for an id (Classic for anything unknown). */
export function drumKitDef(kit) {
  return DRUM_KITS.find(k => k.id === kit) ?? DRUM_KITS[0]
}

/** Sample URLs a kit plays (empty for synth kits). */
export function drumKitSampleUrls(kit) {
  return Object.values(drumKitDef(kit).samples ?? {})
}

/** The kit a pattern object plays. */
export function drumKitOf(dp) {
  return DRUM_KIT_IDS.includes(dp?.kit) ? dp.kit : DEFAULT_DRUM_KIT
}

/**
 * Decay slider position (0..1) ↔ multiplier. Log scale, so the default (×1)
 * sits in the middle and ×0.25 / ×4 are equally far from it.
 */
export function decayToSlider(m) {
  const r = PAD_VOICE_RANGES.decay
  return Math.log(clampTo(m, r) / r.min) / Math.log(r.max / r.min)
}
export function sliderToDecay(x) {
  const r = PAD_VOICE_RANGES.decay
  const m = r.min * Math.pow(r.max / r.min, Math.max(0, Math.min(1, x)))
  // Snap to the default near the middle so the slider can find ×1 again.
  return Math.abs(m - 1) < 0.04 ? 1 : Math.round(m * 100) / 100
}

/**
 * The filter a tone value inserts, or null for none. Below 0 a low-pass from
 * 18 kHz down to ~140 Hz; above 0 a high-pass from 30 Hz up to ~11 kHz.
 */
export function toneFilter(tone) {
  if (!isNum(tone) || tone === 0) return null
  const t = clampTo(tone, PAD_VOICE_RANGES.tone)
  return t < 0
    ? { type: 'lowpass', frequency: 18000 * Math.pow(2, t * 7) }
    : { type: 'highpass', frequency: 30 * Math.pow(2, t * 8.5) }
}

/** Playback-rate multiplier for a tune value (noise voices have no pitch). */
export function tuneRate(tune) {
  return Math.pow(2, (isNum(tune) ? tune : 0) / 12)
}
