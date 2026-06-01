import * as Tone from 'tone'

// 8 bars × 16 steps/bar = 128 sixteenth-note slots.
export const BARS          = 8
export const STEPS_PER_BAR = 16
export const TOTAL_STEPS   = BARS * STEPS_PER_BAR
export const SLOT_COUNT    = 4

export const SLOT_IDS    = ['A', 'B', 'C', 'D']
export const SLOT_COLORS = ['#c8f040', '#40c8f0', '#f0c840', '#c040f0']

// ── Scale system ──────────────────────────────────────────────────────────
export const SCALE_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
export const SCALE_MODES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues:      [0, 3, 5, 6, 7, 10],
}
const ROOT_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

// Geographic latitude bounds for Budapest network (cached from preprocess).
const LAT_MIN = 47.30
const LAT_MAX = 47.66

const MIDI_TO_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiToName(m) {
  return `${MIDI_TO_NAME[m % 12]}${Math.floor(m / 12) - 1}`
}

// Map a latitude to the nearest scale degree across a chosen pitch range.
// North = high. Returns a MIDI note number.
export function latToMidi(lat, root, modeName, baseOctave = 3, octaves = 3) {
  const semis    = ROOT_SEMITONES[root] ?? 0
  const mode     = SCALE_MODES[modeName] ?? SCALE_MODES.minor
  const t        = Math.max(0, Math.min(1, (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)))
  const totalDeg = mode.length * octaves
  const degIdx   = Math.min(totalDeg - 1, Math.floor(t * totalDeg))
  const oct      = baseOctave + Math.floor(degIdx / mode.length)
  const note     = mode[degIdx % mode.length]
  return 12 * (oct + 1) + semis + note
}

// Build the deterministic 8-bar phrase from a route + scale.
// Returns Array<{ step, midi, stop }>.
export function notesFromRoute(route, root, mode) {
  if (!route?.stops?.length || !route.totalDist) return []
  const notes = []
  for (const stop of route.stops) {
    const step = Math.min(TOTAL_STEPS - 1, Math.floor((stop.dist / route.totalDist) * TOTAL_STEPS))
    const midi = latToMidi(stop.lat, root, mode)
    notes.push({ step, midi, stop: stop.name ?? '' })
  }
  // Sort by step so playback is in order.
  notes.sort((a, b) => a.step - b.step)
  return notes
}

// ── Voice presets per slot — distinct timbres so layers stay separable ───
function buildSlotVoice(idx, output) {
  switch (idx) {
    case 0: { // A — bright pluck lead
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.4 },
      })
      s.connect(output)
      return s
    }
    case 1: { // B — soft Rhodes
      const s = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.4, modulationIndex: 4,
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 0.7 },
      })
      s.connect(output)
      return s
    }
    case 2: { // C — square bass
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope:   { attack: 0.002, decay: 0.3, sustain: 0.1, release: 0.3 },
      })
      s.volume.value = -8
      s.connect(output)
      return s
    }
    case 3: { // D — pad
      const s = new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 2,
        envelope: { attack: 0.4, decay: 0.6, sustain: 0.5, release: 1.2 },
      })
      s.volume.value = -10
      s.connect(output)
      return s
    }
    default: {
      const s = new Tone.PolySynth(Tone.Synth)
      s.connect(output)
      return s
    }
  }
}

export class LoopEngine {
  constructor() {
    this._live    = null
    this._slots   = []           // [{ voice, notes:[{step,midi,stop}], muted, captured }]
    this._liveNotes  = []
    this._liveMuted  = false
    this._step       = -1
    this._loopId     = null
    this._onStep     = null
    this._started    = false
    this._anySolo    = false     // not used; solo handled by setSolo()
    this._solos      = new Array(SLOT_COUNT).fill(false)
  }

  init() {
    const verb = new Tone.Reverb({ decay: 2.4, wet: 0.18 }).toDestination()
    const comp = new Tone.Compressor(-14, 3).connect(verb)

    this._live = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope:   { attack: 0.003, decay: 0.2, sustain: 0.05, release: 0.5 },
    })
    this._live.volume.value = -4
    this._live.connect(comp)

    for (let i = 0; i < SLOT_COUNT; i++) {
      const v = buildSlotVoice(i, comp)
      this._slots.push({ voice: v, notes: [], muted: false, captured: false })
    }

    this._masterComp = comp
    this._reverb     = verb
  }

  // ── Live phrase ──────────────────────────────────────────────────────────
  setLiveNotes(notes) {
    this._liveNotes = Array.isArray(notes) ? notes : []
  }
  setLiveMute(muted) { this._liveMuted = !!muted }

  // ── Slot ops ─────────────────────────────────────────────────────────────
  capture(slotIdx) {
    const s = this._slots[slotIdx]
    if (!s) return
    s.notes    = this._liveNotes.map(n => ({ ...n }))
    s.captured = true
  }
  clear(slotIdx) {
    const s = this._slots[slotIdx]
    if (!s) return
    s.notes    = []
    s.captured = false
  }
  setMute(slotIdx, muted) {
    if (this._slots[slotIdx]) this._slots[slotIdx].muted = !!muted
  }
  setSolo(slotIdx, solo) {
    this._solos[slotIdx] = !!solo
  }
  getSlot(slotIdx) {
    const s = this._slots[slotIdx]
    if (!s) return null
    return { notes: s.notes.slice(), muted: s.muted, captured: s.captured }
  }

  // ── Transport ────────────────────────────────────────────────────────────
  setBpm(bpm) { Tone.Transport.bpm.value = bpm }
  setOnStep(cb) { this._onStep = cb }

  async start(bpm = 96) {
    if (this._started) return
    await Tone.start()
    Tone.Transport.bpm.value = bpm
    this._step = -1

    this._loopId = Tone.Transport.scheduleRepeat((time) => {
      this._step = (this._step + 1) % TOTAL_STEPS
      const step = this._step
      const anySolo = this._solos.some(Boolean)

      // Live phrase — always audible unless explicitly muted.
      if (!this._liveMuted && !anySolo) {
        for (const n of this._liveNotes) {
          if (n.step === step) this._live.triggerAttackRelease(midiToName(n.midi), '8n', time, 0.7)
        }
      }

      // Captured slots.
      for (let i = 0; i < SLOT_COUNT; i++) {
        const s = this._slots[i]
        if (!s || !s.captured) continue
        if (s.muted) continue
        if (anySolo && !this._solos[i]) continue
        for (const n of s.notes) {
          if (n.step === step) s.voice.triggerAttackRelease(midiToName(n.midi), '8n', time, 0.6)
        }
      }

      const cb = this._onStep
      if (cb) Tone.Draw.schedule(() => cb(step), time)
    }, '16n')

    Tone.Transport.start()
    this._started = true
  }

  stop() {
    if (!this._started) return
    if (this._loopId != null) {
      Tone.Transport.clear(this._loopId)
      this._loopId = null
    }
    Tone.Transport.stop()
    Tone.Transport.position = 0
    this._step    = -1
    this._started = false
    if (this._onStep) this._onStep(-1)
  }

  dispose() {
    this.stop()
    this._live?.dispose()
    for (const s of this._slots) s.voice?.dispose()
    this._masterComp?.dispose()
    this._reverb?.dispose()
    this._live    = null
    this._slots   = []
  }
}

// ── Helpers exposed for the UI ───────────────────────────────────────────
export { midiToName }
