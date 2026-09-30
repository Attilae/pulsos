// Which DSP renders a lane's granular layer, and how Leið's granular settings
// (DEFAULT_GRANULAR in soundSpecs.js) become Clouds grain-scheduler values.
// Pure and dependency-free: the engine, tests and anything server-side can read
// it without pulling in Tone or the worklet.
//
//   NEXT_PUBLIC_GRANULAR_ENGINE=grainplayer   Tone.GrainPlayer (lib/granularVoice.js),
//                                             the original layer — the default
//   NEXT_PUBLIC_GRANULAR_ENGINE=clouds        the Clouds-derived wasm grain cloud
//                                             (lib/cloudsGranularVoice.js)
//
// It's a deployment-wide switch, not song state: the same song plays through
// whichever engine the build selects, with the same saved settings. See
// docs/clouds-granular-port-plan.md for what differs between them.

export const GRANULAR_ENGINES = ['grainplayer', 'clouds']
export const DEFAULT_GRANULAR_ENGINE = 'grainplayer'

export function normalizeGranularEngine(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return GRANULAR_ENGINES.includes(v) ? v : DEFAULT_GRANULAR_ENGINE
}

// Next inlines NEXT_PUBLIC_* only for this literal member access.
export const GRANULAR_ENGINE = normalizeGranularEngine(process.env.NEXT_PUBLIC_GRANULAR_ENGINE)

// ── Clouds parameter adapter ────────────────────────────────────────────────
// The DSP (dsp/clouds/bridge.cc) runs at 32 kHz and takes grain length in
// samples, a target count of overlapping grains, a scan speed, a bounded source
// window, jitter, the upstream window shape and stereo spread.

export const CLOUDS_DSP_RATE = 32000
export const CLOUDS_MAX_GRAINS = 32
export const CLOUDS_MIN_GRAIN_SAMPLES = 64
export const CLOUDS_MAX_GRAIN_SAMPLES = 16384
// Fixed for the first port (plan: "New Clouds controls ... after the existing
// contract is stable"). 0.75 is upstream's TEXTURE ≈ 0.56: a half-smoothed
// window, between its triangle and its bell.
export const CLOUDS_WINDOW_SHAPE = 0.75
export const CLOUDS_STEREO_SPREAD = 0.5

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// grainSize (seconds) → samples at the DSP rate.
export function cloudsGrainSamples(grainSize) {
  return clamp(Math.round(num(grainSize, 0.09) * CLOUDS_DSP_RATE), CLOUDS_MIN_GRAIN_SAMPLES, CLOUDS_MAX_GRAIN_SAMPLES)
}

// GrainPlayer's `overlap` is the crossfade (seconds) between consecutive grains,
// so it plays about 1 + overlap/grainSize grains at once, each mostly at full
// level. Every Clouds grain is windowed over its whole length, and it takes
// roughly twice as many of them to fill the same space without a pulsing
// amplitude, hence the factor of two. This is a starting calibration, not a
// measured perceptual match: audition before changing it.
export function cloudsDensity(grainSize, overlap) {
  const size = Math.max(num(grainSize, 0.09), 0.001)
  const ov = Math.max(num(overlap, 0.05), 0)
  return clamp(2 * (1 + ov / size), 1, CLOUDS_MAX_GRAINS)
}

// A granular cfg (any subset of DEFAULT_GRANULAR's keys, merged over its
// defaults by the caller) → the DSP's parameter block.
export function cloudsParamsFromGranular(cfg = {}) {
  let winStart = clamp(num(cfg.loopStart, 0), 0, 1)
  let winEnd = clamp(num(cfg.loopEnd, 1), 0, 1)
  if (winEnd < winStart) [winStart, winEnd] = [winEnd, winStart]
  return {
    size: cloudsGrainSamples(cfg.grainSize),
    density: cloudsDensity(cfg.grainSize, cfg.overlap),
    // Leið's playbackRate is a texture control that never changes pitch; here it
    // is the speed the grain position scans through the window.
    scanRate: clamp(num(cfg.playbackRate, 1), 0, 16),
    winStart,
    winEnd,
    jitter: clamp(num(cfg.jitter, 0), 0, 1),
    windowShape: CLOUDS_WINDOW_SHAPE,
    spread: CLOUDS_STEREO_SPREAD,
    reverse: !!cfg.reverse,
  }
}
