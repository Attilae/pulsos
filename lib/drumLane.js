// The Map drum lane plays a 16-step window into each pad's 64-slot buffer.
import { PAD_DEFS, STEPS, SOURCE_STEPS, normalizeStep } from './drumSpecs.js'
const wrap = (v, size) => ((v % size) + size) % size
const integer = v => Number.isFinite(v) ? Math.round(v) : 0
export function drumSourceStep(offset, step) {
  return wrap(integer(offset) + integer(step), SOURCE_STEPS)
}
// Inverse of MixerTab's offset-based step handler, including nonzero offsets.
export function drumVisibleStep(offset, source) {
  return wrap(integer(source) - integer(offset), SOURCE_STEPS)
}
export function drumSourcePage(source) {
  return Math.floor(wrap(integer(source), SOURCE_STEPS) / STEPS)
}
export function drumPlaybackStep(seconds, bpm) {
  const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 120
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return Math.floor(time / ((60 / tempo) / 4)) % STEPS
}
export function drumVelocityClass(value) {
  const v = normalizeStep(value)
  return !v ? '' : v >= 0.85 ? 'vel-accent' : v >= 0.55 ? 'vel-norm' : 'vel-soft'
}
export function drumWindowLabel(offset) {
  const start = drumSourceStep(offset, 0)
  const end = drumSourceStep(offset, STEPS - 1)
  return end >= start ? `${start + 1}–${end + 1}` : `${start + 1}–${SOURCE_STEPS}, 1–${end + 1}`
}

// Used only by sound diagnostics, never by the instrument-lane plan cap.
export function drumLaneEnabled(pattern, muted) {
  return !!pattern && !muted && PAD_DEFS.some(pad => !pattern.muted?.[pad.id])
}
