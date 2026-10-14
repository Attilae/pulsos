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

const pct = v => `${Math.round(clamp01(v) * 100)}%`

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
  ...TEXTURE_KNOBS.map(k => ({ id: `grain.${k.key}`, label: k.label, group: 'Texture', min: 0, max: 1, textureModel: 'classic' })),
  ...TEXTURE_BLEND_PARAMS.map(k => ({ id: `grain.${k.key}`, label: k.label, group: 'Texture', min: 0, max: 1, textureModel: 'classic' })),
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

// ── Texture models: Classic and Mk II ───────────────────────────────────────
// A Texture insert runs one of two DSPs, chosen per lane by the granular cfg's
// `txModel` (absent = Classic, so older songs are unchanged):
//   classic   the Clouds-derived processor above (dsp/clouds)
//   mk2       the Beads-derived processor (dsp/beads, docs/texture-mk2-plan.md)
// Each model keeps its own keys (tx* and tx2*), so switching back and forth
// never loses a setting. Offering Mk II is gated by NEXT_PUBLIC_TEXTURE_MK2_ENABLED;
// a lane already set to Mk II plays it in any build that has Texture.

export const TEXTURE_MODELS = ['classic', 'mk2']
export const DEFAULT_TEXTURE_MODEL = 'classic'
export const TEXTURE_MODEL_LABELS = { classic: 'Classic', mk2: 'Mk II' }

// Next inlines NEXT_PUBLIC_* only for this literal member access.
export const TEXTURE_MK2_ENABLED = TEXTURE_ENABLED && process.env.NEXT_PUBLIC_TEXTURE_MK2_ENABLED === 'true'

export function textureModelOf(cfg) {
  return cfg?.txModel === 'mk2' ? 'mk2' : DEFAULT_TEXTURE_MODEL
}

// Mk II's quality settings, in the module's LED order, and how lane notes reach
// its SEED input (public/worklets/beads-processor.js).
export const TEXTURE_MK2_QUALITIES = [
  { id: 'hifi', label: 'Hi-fi', hint: '48 kHz, 16-bit: the clean setting. About 4 seconds of recording.' },
  { id: 'cleanTape', label: 'Clean tape', hint: '12-bit, processed at half rate inside a 48 kHz path: soft and dark. About 10 seconds of recording.' },
  { id: 'vintage', label: 'Vintage', hint: '32 kHz, 12-bit: a grainy early sampler. About 8 seconds of recording.' },
  { id: 'dirtyTape', label: 'Dirty tape', hint: '24 kHz, 8-bit mu-law with wow and flutter. About 16 seconds of recording.' },
]
export const TEXTURE_MK2_SEED_MODES = [
  { id: 'gates', label: 'Gates', hint: 'Grains while a lane note is held. Density at centre gives one grain per note.' },
  { id: 'clock', label: 'Clock', hint: 'Lane notes are a clock. Left of centre divides it, right of centre plays notes by chance.' },
  { id: 'free', label: 'Free', hint: 'Grains run on their own at Density’s rate, notes or not.' },
]

// Beads' PITCH knob law (beads/cv_reader.h, LAW_DETUNE): ±24 semitones with
// detents on unison, 1, 3, 4, 7, 12 and 24.
export function textureMk2PitchSemitones(knob) {
  const intervals = [0, 1, 3, 4, 7, 12, 24, 24]
  const detune = 2 * clamp01(knob) - 1
  const sign = detune < 0 ? -1 : 1
  const x = detune * sign * 6
  const i = Math.min(Math.floor(x), 6)
  const f = i === 6 ? 1 : Math.max((x - i - 1 / 3) * 1.5, 0)
  const t = f * f * (3 - 2 * f)
  const st = (intervals[i] + (intervals[i + 1] - intervals[i]) * t) * sign
  return Math.round(st * 10) / 10 || 0
}

// The four randomization knobs (LAW_ATTENUVERTER, with nothing patched):
// right of centre a slow random drift, left a fresh random value per grain.
export function textureMk2RandAmount(knob) {
  const v = clamp01(knob) - 0.5
  return (2 / 0.47) * v * Math.max(Math.abs(v) - 0.03, 0)
}

const DIVISIONS = [1, 2, 3, 4, 6, 8, 12, 16]   // trigger_generator.cc

// delay_controller.cc's kRatio: the repeat as a fraction of the note clock,
// powers of two below DENSITY's centre and dividers above it.
const DELAY_RATIOS = [16, 16, 8, 8, 4, 4, 2, 2, 1, 1, 1, 1, 2, 3, 4, 6, 8, 10, 12, 16, 16, 16]
// The longest free delay per quality (its buffer at the delay clock's rate:
// max_delay × ratio / rate in processor.h and granular_processor.h).
const MAX_DELAY_SEC = { hifi: 4, cleanTape: 512000 / 48000, vintage: 8, dirtyTape: 16 }

// What DENSITY does depends on the seed mode (trigger_generator.cc) and, with
// SIZE at full, on delay mode (delay_controller.cc).
export function textureMk2DensityText(knob, seedMode = 'gates', { delay = false, quality = 'hifi' } = {}) {
  const d = clamp01(knob)
  if (delay) {
    if (seedMode === 'free') {
      const sec = Math.max(68 / 48000, (MAX_DELAY_SEC[quality] ?? 4) * 2 ** (-Math.abs(d - 0.5) * 18))
      return sec >= 1 ? `${sec.toFixed(2)}s` : `${Math.round(sec * 1000)}ms`
    }
    const x = d * 20
    const i = Math.min(Math.floor(x), 20)
    const div = DELAY_RATIOS[(x - i) < 0.5 ? i : i + 1]
    return div === 1 ? '1 note' : `1/${div} note`
  }
  if (seedMode === 'clock') {
    if (d < 0.48) return `÷${DIVISIONS[Math.max(0, Math.min(7, Math.floor(d * 2.15 * 8)))]}`
    const p = Math.max((d - 0.52) * 2.15, 0)
    return d <= 0.52 ? 'every' : `${Math.round(Math.min(1, p * p) * 100)}%`
  }
  if (d > 0.48 && d < 0.52) return seedMode === 'gates' ? 'each note' : 'off'
  const amt = Math.round(Math.abs(d - 0.5) * 200)
  return d > 0.5 ? `rnd ${amt}%` : `reg ${amt}%`
}

const signedRand = v => {
  const a = textureMk2RandAmount(v)
  if (Math.abs(a) < 0.005) return 'off'
  return a > 0 ? `drift ${Math.round(a * 100)}%` : `grain ${Math.round(-a * 100)}%`
}

export const TEXTURE_MK2_KNOBS = [
  {
    key: 'tx2Time', label: 'Time', default: 0.05, size: 'lg', rand: 'tx2TimeRand',
    hint: 'How far back in the recording grains are taken from. In delay mode, an offset for the repeats.',
    format: pct,
  },
  {
    key: 'tx2Size', label: 'Size', default: 0.5, size: 'lg', rand: 'tx2SizeRand',
    hint: 'Grain length. The left third plays grains backwards, longest at the far left; from a third onwards they play forwards and grow longer to the right. Fully right turns Texture into a delay.',
    format: v => (clamp01(v) >= 0.99 ? 'delay' : pct(v)),
  },
  {
    key: 'tx2Shape', label: 'Shape', default: 0.5, size: 'lg', rand: 'tx2ShapeRand',
    hint: 'Grain envelope, from a sharp click to a slow swell.',
    format: pct,
  },
  {
    key: 'tx2Pitch', label: 'Pitch', default: 0.5, size: 'lg', bipolar: true, detent: 0.5, rand: 'tx2PitchRand',
    hint: 'Transposes the grains up to two octaves either way, with detents on musical intervals.',
    format: v => { const s = textureMk2PitchSemitones(v); return s > 0 ? `+${s}st` : `${s}st` },
  },
]
export const TEXTURE_MK2_RAND_KNOBS = TEXTURE_MK2_KNOBS.map(k => ({
  key: k.rand, label: `${k.label} random`, default: 0.5, size: 'xs', bipolar: true, detent: 0.5,
  hint: `Randomizes ${k.label.toLowerCase()}: right of centre a slow drift, left a new value for every grain.`,
  format: signedRand,
}))
export const TEXTURE_MK2_MIX_KNOBS = [
  {
    key: 'tx2Density', label: 'Density', default: 0.65, size: 'lg', bipolar: true, detent: 0.5,
    hint: 'How many grains, and how lane notes drive them: see the seed mode. In delay mode without notes, the delay length.',
    format: textureMk2DensityText,
  },
  { key: 'tx2Feedback', label: 'Feedback', default: 0, size: 'md', hint: 'Records the output back into the buffer.', format: pct },
  { key: 'tx2DryWet', label: 'Dry/wet', default: 0.5, size: 'md', hint: 'Balance between the lane and the grains.', format: pct },
  { key: 'tx2Reverb', label: 'Reverb', default: 0, size: 'md', hint: 'Texture’s own reverb, after the grains.', format: pct },
  {
    key: 'tx2InGain', label: 'In gain', default: 0.75, size: 'sm',
    hint: 'How loud the lane is recorded into the buffer, -18 to +6 dB.',
    format: v => { const db = Math.round(textureInGainDb(v)); return db > 0 ? `+${db}dB` : `${db}dB` },
  },
]

export const TEXTURE_MK2_DEFAULTS = Object.fromEntries([
  ...[...TEXTURE_MK2_KNOBS, ...TEXTURE_MK2_RAND_KNOBS, ...TEXTURE_MK2_MIX_KNOBS].map(k => [k.key, k.default]),
  ['tx2Quality', 'hifi'],
  ['tx2SeedMode', 'gates'],
  ['tx2Freeze', false],
])

// Quality, seed mode and freeze are discrete and aren't automatable.
export const TEXTURE_MK2_PARAM_TARGETS = [...TEXTURE_MK2_KNOBS, ...TEXTURE_MK2_RAND_KNOBS, ...TEXTURE_MK2_MIX_KNOBS]
  .map(k => ({ id: `grain.${k.key}`, label: k.label, group: 'Texture Mk II', min: 0, max: 1, textureModel: 'mk2' }))

// Which Texture targets a lane offers: the lane's own model first, then (while
// Mk II is offered, or the lane uses it) the other one's, which stay valid but
// inactive like the lane filter's model-specific targets.
export function textureParamTargets(cfg) {
  const model = textureModelOf(cfg)
  if (!TEXTURE_MK2_ENABLED && model === 'classic') return TEXTURE_PARAM_TARGETS
  return model === 'mk2'
    ? [...TEXTURE_MK2_PARAM_TARGETS, ...TEXTURE_PARAM_TARGETS]
    : [...TEXTURE_PARAM_TARGETS, ...TEXTURE_MK2_PARAM_TARGETS]
}

// Whether an automation target drives the lane's current Texture model.
export function textureTargetActive(targetId, cfg) {
  if (!targetId?.startsWith('grain.tx')) return true
  return targetId.startsWith('grain.tx2') ? textureModelOf(cfg) === 'mk2' : textureModelOf(cfg) === 'classic'
}

// A lane's granular cfg → BeadsHost's parameter block (public/worklets/beads-processor.js).
export function beadsDspParams(cfg = {}) {
  const v = (key) => clamp01(num(cfg[key], TEXTURE_MK2_DEFAULTS[key]))
  const quality = TEXTURE_MK2_QUALITIES.some(q => q.id === cfg.tx2Quality) ? cfg.tx2Quality : 'hifi'
  const seedMode = TEXTURE_MK2_SEED_MODES.some(m => m.id === cfg.tx2SeedMode) ? cfg.tx2SeedMode : 'gates'
  return {
    time: v('tx2Time'), size: v('tx2Size'), shape: v('tx2Shape'), pitch: v('tx2Pitch'),
    timeAmt: v('tx2TimeRand'), sizeAmt: v('tx2SizeRand'), shapeAmt: v('tx2ShapeRand'), pitchAmt: v('tx2PitchRand'),
    density: v('tx2Density'), feedback: v('tx2Feedback'), dryWet: v('tx2DryWet'), reverb: v('tx2Reverb'),
    inGain: 10 ** (textureInGainDb(v('tx2InGain')) / 20),
    freeze: !!cfg.tx2Freeze,
    quality,
    seedMode,
  }
}

// Mk II's output level relative to Classic. Upstream's dry/wet law leaves an even
// blend about 3 dB under Classic's (dsp/beads/README.md, "Lane loudness"), so
// TextureVoice lifts Mk II by this much: an even blend then matches Classic
// within half a dB, and fully dry sits 0.5 dB over the bare lane.
export const TEXTURE_MK2_MAKEUP_DB = 3

function num(v, fallback) { return Number.isFinite(v) ? v : fallback }
function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) }
