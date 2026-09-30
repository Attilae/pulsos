// Which DSP renders a lane's granular layer, and the vocabulary of Texture, the
// Clouds-derived engine. Pure and dependency-free: the engine, the UI, songState
// and tests can read it without pulling in Tone or the worklet.
//
//   NEXT_PUBLIC_GRANULAR_ENGINE=grainplayer   Tone.GrainPlayer (lib/granularVoice.js),
//                                             the original layer: the default
//   NEXT_PUBLIC_GRANULAR_ENGINE=clouds        Texture (lib/textureVoice.js), a live
//                                             grain processor on the lane's audio
//
// It's a deployment-wide switch, not song state. Both engines' settings live
// side by side in a lane's granular config (Texture's keys are prefixed `tx`),
// so a song keeps both and plays through whichever engine the build selects.
// See dsp/clouds/README.md.

import { TEXTURE_PITCH_TABLE } from './texturePitchTable.js'

export const GRANULAR_ENGINES = ['grainplayer', 'clouds']
export const DEFAULT_GRANULAR_ENGINE = 'grainplayer'

export function normalizeGranularEngine(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return GRANULAR_ENGINES.includes(v) ? v : DEFAULT_GRANULAR_ENGINE
}

// Next inlines NEXT_PUBLIC_* only for this literal member access.
export const GRANULAR_ENGINE = normalizeGranularEngine(process.env.NEXT_PUBLIC_GRANULAR_ENGINE)
export const TEXTURE_ENABLED = GRANULAR_ENGINE === 'clouds'

// ── Texture controls ────────────────────────────────────────────────────────
// Texture is an insert: the lane's dry sound streams into a one-second
// recording buffer and grains are played back out of it, like the module's
// granular mode. Every knob is a 0..1 value, exactly what the module's CV scaler
// hands its processor; `format` renders the readout.

const pct = v => `${Math.round(v * 100)}%`

// PITCH follows upstream's lut_quantized_pitch: ±24 semitones, not linear. A
// wide dead zone at centre, semitone detents near it, octaves at the ends.
export function texturePitchSemitones(knob) {
  const x = clamp01(knob) * (TEXTURE_PITCH_TABLE.length - 1)
  const i = Math.min(Math.floor(x), TEXTURE_PITCH_TABLE.length - 2)
  const t = x - i
  const st = TEXTURE_PITCH_TABLE[i] + (TEXTURE_PITCH_TABLE[i + 1] - TEXTURE_PITCH_TABLE[i]) * t
  return Math.round(st) || 0      // never -0
}

// IN GAIN: -18 dB (fully left) to +6 dB (fully right), linear in dB like the
// module's knob. 0.75 is unity.
export function textureInGainDb(knob) {
  return -18 + 24 * clamp01(knob)
}

export const TEXTURE_KNOBS = [
  {
    key: 'txPosition', label: 'Position', default: 0.2, size: 'lg',
    hint: 'Where grains are taken from in the last second of the lane. Left is just now, right is further back.',
    format: v => `-${Math.round(clamp01(v) * 1020)}ms`,
  },
  {
    key: 'txSize', label: 'Size', default: 0.5, size: 'lg',
    hint: 'Grain length, from short clicks on the left to long, smeared slices of the lane on the right.',
    format: pct,
  },
  {
    key: 'txPitch', label: 'Pitch', default: 0.5, size: 'lg', bipolar: true, detent: 0.5,
    hint: 'Transposes the grains up to two octaves either way. Near centre it steps by semitones; the ends jump by octaves.',
    format: v => { const s = texturePitchSemitones(v); return s > 0 ? `+${s}st` : `${s}st` },
  },
  {
    key: 'txDensity', label: 'Density', default: 0.65, size: 'lg', bipolar: true, detent: 0.5,
    hint: 'Centre: grains only on lane notes. Right: more grains at random times. Left: more grains at a steady rate.',
    format: v => {
      const d = clamp01(v)
      if (d > 0.47 && d < 0.53) return 'trig'
      const amt = Math.round(Math.abs(d - 0.5) * 200)
      return d > 0.5 ? `rnd ${amt}%` : `reg ${amt}%`
    },
  },
  {
    key: 'txTexture', label: 'Texture', default: 0.5, size: 'lg',
    hint: 'Grain envelope from square to triangle to a smooth bell. Past three quarters, a diffuser smears the grains.',
    format: pct,
  },
  {
    key: 'txInGain', label: 'In gain', default: 0.75, size: 'sm',
    hint: 'How loud the lane is recorded into the buffer, -18 to +6 dB.',
    format: v => { const db = Math.round(textureInGainDb(v)); return db > 0 ? `+${db}dB` : `${db}dB` },
  },
]

// The four parameters the module's BLEND knob switches between (button B).
export const TEXTURE_BLEND_PARAMS = [
  { key: 'txBlend',    label: 'Dry/wet', short: 'D/W', default: 0.5, hint: 'Balance between the dry lane and the grains.' },
  { key: 'txSpread',   label: 'Spread',  short: 'SPR', default: 0.5, hint: 'Random stereo placement of each grain.' },
  { key: 'txFeedback', label: 'Feedback', short: 'FB', default: 0,   hint: 'Records the grains back into the buffer. High values build up; Freeze turns it into a long tail.' },
  { key: 'txReverb',   label: 'Reverb',  short: 'REV', default: 0,   hint: 'Texture’s own reverb, after the grains.' },
]

export const TEXTURE_DEFAULTS = Object.fromEntries([
  ...TEXTURE_KNOBS.map(k => [k.key, k.default]),
  ...TEXTURE_BLEND_PARAMS.map(k => [k.key, k.default]),
  ['txFreeze', false],
])

// Automation targets offered while Texture is on (grain.* like the GrainPlayer
// layer's, so the engine's apply/restore path handles both). Freeze is a latch,
// not a continuous value, and isn't automatable.
export const TEXTURE_PARAM_TARGETS = [
  ...TEXTURE_KNOBS.map(k => ({ id: `grain.${k.key}`, label: k.label, group: 'Texture', min: 0, max: 1 })),
  ...TEXTURE_BLEND_PARAMS.map(k => ({ id: `grain.${k.key}`, label: k.label, group: 'Texture', min: 0, max: 1 })),
]

// A lane's granular cfg → the DSP's parameter block (dsp/clouds/bridge.cc,
// cg_set_params). Dry/wet gets the module's CV-scaler trim so both ends reach
// fully dry and fully wet.
export function textureDspParams(cfg = {}) {
  const v = (key) => clamp01(num(cfg[key], TEXTURE_DEFAULTS[key]))
  return {
    position: v('txPosition'),
    size: v('txSize'),
    pitch: v('txPitch'),
    density: v('txDensity'),
    texture: v('txTexture'),
    dryWet: clamp01(v('txBlend') * 1.05 - 0.025),
    spread: v('txSpread'),
    feedback: v('txFeedback'),
    reverb: v('txReverb'),
    inGain: 10 ** (textureInGainDb(v('txInGain')) / 20),
    freeze: !!cfg.txFreeze,
  }
}

function num(v, fallback) { return Number.isFinite(v) ? v : fallback }
function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) }
