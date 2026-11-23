// Drum kits and per-pad voice settings. Pure, no Tone import: the Drum Machine
// tab, song state and the AI plan contract share it; lib/drumVoices.js builds
// the actual Tone voices. Research: docs/drum-research.md §2.1.
//
// Stored sparse on the drum pattern object, beside the groove keys:
//   kit:    'layered'                               absent = 'classic' (the original kit)
//   voices: { padId: { tune, decay, tone } }        absent / default values dropped
//
//   tune   semitones, -12..12 (noise pads shift their noise rate instead)
//   decay  multiplier on the voice's decay and release, 0.25..4
//   tone   -1..1: below 0 a low-pass darkens the pad, above 0 a high-pass thins it;
//          0 inserts no filter at all, so a Classic pad at defaults is unchanged.

import { PAD_DEFS } from './drumSpecs.js'

export const DRUM_KITS = [
  { id: 'classic', label: 'Classic', hint: 'The original synth kit.' },
  { id: 'layered', label: 'Layered', hint: 'Each pad built from layers: a clicky kick with drive, a tuned snare, an 808-style clap.' },
]
export const DRUM_KIT_IDS = DRUM_KITS.map(k => k.id)
export const DEFAULT_DRUM_KIT = 'classic'

export const PAD_VOICE_RANGES = Object.freeze({
  tune: Object.freeze({ min: -12, max: 12, step: 1, default: 0 }),
  decay: Object.freeze({ min: 0.25, max: 4, default: 1 }),
  tone: Object.freeze({ min: -1, max: 1, step: 0.05, default: 0 }),
})
export const DEFAULT_PAD_VOICE = Object.freeze({ tune: 0, decay: 1, tone: 0 })

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

/**
 * Sparse, validated kit fields of a drum pattern object: { kit?, voices? }.
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
  return out
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
