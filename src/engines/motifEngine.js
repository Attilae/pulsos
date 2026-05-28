import * as Tone from 'tone'
import { latToMidi, SCALE_ROOTS, SCALE_MODES } from './loopEngine.js'

export const LENGTH_OPTIONS = [2, 4, 8]   // bars
export const STEPS_PER_BAR  = 16

// Pure generator. Deterministic given (route, options, seed).
// Returns { notes: [{ step, midi, length, stop }], totalSteps }.
//
// Algorithm:
//   - Total steps = bars * 16.
//   - Choose a starting offset along the route based on seed (a portion of
//     totalDist) — this is the "reroll" knob: a different window into the
//     same route's geography produces a different motif from the same line.
//   - For each stop, compute its bucket = floor(((dist - offset) mod totalDist) / totalDist * N).
//   - Within each non-empty bucket keep the *first* stop visited (so order
//     along the route is preserved).
//   - Pitch = lat → chosen scale (north = high).
//   - Note length = distance to the next note in steps, capped at 4 steps.
export function generateMotif(route, { root, mode, bars, seed }) {
  const totalSteps = bars * STEPS_PER_BAR
  if (!route?.stops?.length || !route.totalDist) return { notes: [], totalSteps }

  const offset = ((seed % 1) + 1) % 1 * route.totalDist
  const buckets = new Array(totalSteps).fill(null)

  for (const stop of route.stops) {
    const d = ((stop.dist - offset) % route.totalDist + route.totalDist) % route.totalDist
    const step = Math.min(totalSteps - 1, Math.floor((d / route.totalDist) * totalSteps))
    if (buckets[step] !== null) continue
    buckets[step] = stop
  }

  // Emit notes; assign length = run until next non-empty bucket (capped).
  const notes = []
  for (let i = 0; i < totalSteps; i++) {
    const s = buckets[i]
    if (!s) continue
    let j = i + 1
    while (j < totalSteps && buckets[j] === null) j++
    const length = Math.max(1, Math.min(4, j - i))
    notes.push({
      step:   i,
      midi:   latToMidi(s.lat, root, mode),
      length,
      stop:   s.name ?? '',
    })
  }

  return { notes, totalSteps }
}

// Re-export scale options so the UI can render selectors without importing
// loopEngine directly (keeps tab-to-engine boundary clean).
export { SCALE_ROOTS, SCALE_MODES }

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function midiToName(m) { return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}` }

// Preview player — single voice, plays a motif from start to finish, then stops.
export class MotifPreview {
  constructor() {
    this._synth   = null
    this._reverb  = null
    this._partId  = null
    this._stopAt  = null
    this._onDone  = null
    this._playing = false
  }

  init() {
    this._reverb = new Tone.Reverb({ decay: 1.6, wet: 0.18 }).toDestination()
    this._synth  = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope:   { attack: 0.005, decay: 0.18, sustain: 0.2, release: 0.4 },
    })
    this._synth.volume.value = -6
    this._synth.connect(this._reverb)
  }

  async play(notes, bpm = 110, onStep, onDone) {
    if (!this._synth || !notes.length) return
    this.stop()
    await Tone.start()

    Tone.Transport.bpm.value = bpm
    const stepSeconds = (60 / bpm) / 4  // 16th note

    // Schedule each note absolutely from now.
    const now = Tone.now() + 0.05
    for (const n of notes) {
      this._synth.triggerAttackRelease(
        midiToName(n.midi),
        n.length * stepSeconds * 0.95,
        now + n.step * stepSeconds,
        0.8,
      )
    }

    // Drive playhead via a Transport-scheduled repeat we tear down on stop.
    const lastStep = Math.max(...notes.map(n => n.step + n.length))
    let step = -1
    Tone.Transport.position = 0
    this._partId = Tone.Transport.scheduleRepeat((time) => {
      step += 1
      if (step >= lastStep) {
        if (this._onDone) Tone.Draw.schedule(this._onDone, time)
        this.stop()
        return
      }
      if (onStep) Tone.Draw.schedule(() => onStep(step), time)
    }, '16n')

    this._onDone  = onDone
    this._playing = true
    Tone.Transport.start()
  }

  stop() {
    if (this._partId != null) {
      Tone.Transport.clear(this._partId)
      this._partId = null
    }
    Tone.Transport.stop()
    Tone.Transport.position = 0
    this._synth?.releaseAll()
    this._playing = false
    const d = this._onDone
    this._onDone = null
    if (d) d()
  }

  isPlaying() { return this._playing }

  dispose() {
    this.stop()
    this._synth?.dispose()
    this._reverb?.dispose()
    this._synth  = null
    this._reverb = null
  }
}
