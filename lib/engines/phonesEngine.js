import * as Tone from 'tone'

// Slow, breathy loop: 16 bars × 4 beats = 64 beats per cycle.
// At 70 BPM, ~54 seconds per full pass — long enough that repetition
// feels like a tide rather than a beat.
export const BARS         = 16
export const BEATS_PER_BAR = 4
export const TOTAL_BEATS  = BARS * BEATS_PER_BAR
export const BPM          = 70

// Pentatonic only — no semitone clashes ever.
// (Root D, minor pentatonic — chosen by ear to sit warm under the city.)
const SCALE_SEMITONES = [0, 3, 5, 7, 10]   // D F G A C  (minor pentatonic)
const SCALE_ROOT_SEMI = 2                  // D

const LAT_MIN = 47.30
const LAT_MAX = 47.66

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiToName(m) { return `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}` }

function latToMidi(lat, baseOctave = 3, octaves = 3) {
  const t        = Math.max(0, Math.min(1, (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)))
  const totalDeg = SCALE_SEMITONES.length * octaves
  const degIdx   = Math.min(totalDeg - 1, Math.floor(t * totalDeg))
  const oct      = baseOctave + Math.floor(degIdx / SCALE_SEMITONES.length)
  const note     = SCALE_SEMITONES[degIdx % SCALE_SEMITONES.length]
  return 12 * (oct + 1) + SCALE_ROOT_SEMI + note
}

// Each voice gets its own octave centre + sparseness to layer cleanly.
// Sparseness = take every Nth stop, so dense lines don't overflow.
export const VOICE_DEFS = [
  { id: 'bass',   routeName: 'M2', routeType: 'metro', label: 'M2',     role: 'Upright bass',  baseOctave: 1, octaves: 2, sparse: 2 },
  { id: 'rhodes', routeName: 'M3', routeType: 'metro', label: 'M3',     role: 'Rhodes piano',  baseOctave: 3, octaves: 2, sparse: 3 },
  { id: 'hat',    routeName: '6',  routeType: 'tram',  label: 'Tram 6', role: 'Brushed hat',   baseOctave: 5, octaves: 1, sparse: 1 },
  { id: 'pad',    routeName: '2',  routeType: 'tram',  label: 'Tram 2', role: 'Tidal pad',     baseOctave: 4, octaves: 2, sparse: 3 },
]

// Bucket a route's stops into TOTAL_BEATS slots (nearest beat).
// Returns Array<{beat, midi, stop}> sorted by beat, sparsened.
export function phraseFromRoute(route, voice) {
  if (!route?.stops?.length || !route.totalDist) return []
  const notes = []
  let kept = 0
  for (const stop of route.stops) {
    const beat = Math.min(TOTAL_BEATS - 1, Math.round((stop.dist / route.totalDist) * TOTAL_BEATS))
    if (kept % voice.sparse !== 0) { kept++; continue }
    kept++
    const midi = latToMidi(stop.lat, voice.baseOctave, voice.octaves)
    notes.push({ beat, midi, stop: stop.name ?? '' })
  }
  // De-dupe: at most one note per voice per beat to keep the air clear.
  const seen = new Set()
  const out  = []
  for (const n of notes) {
    if (seen.has(n.beat)) continue
    seen.add(n.beat)
    out.push(n)
  }
  out.sort((a, b) => a.beat - b.beat)
  return out
}

export class PhonesEngine {
  constructor() {
    this._voices  = {}
    this._phrases = {}
    this._beat    = -1
    this._loopId  = null
    this._onBeat  = null
    this._started = false
    this._filter  = null
    this._reverb  = null
    this._master  = null
  }

  init() {
    // Master chain: each voice → its own volume → filter → reverb → out
    this._reverb = new Tone.Reverb({ decay: 6, wet: 0.42 }).toDestination()
    this._filter = new Tone.Filter({ frequency: 3200, type: 'lowpass', rolloff: -12, Q: 0.7 }).connect(this._reverb)
    this._master = new Tone.Volume(-4).connect(this._filter)

    // Bass — round MonoSynth, low octave
    const bass = new Tone.MonoSynth({
      oscillator: { type: 'triangle' },
      envelope:   { attack: 0.02, decay: 0.4, sustain: 0.4, release: 1.2 },
      filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.8, baseFrequency: 180, octaves: 2 },
    })
    bass.volume.value = -6
    bass.connect(this._master)

    // Rhodes-ish FM
    const rhodes = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 1.2, modulationIndex: 6,
      envelope:   { attack: 0.01, decay: 0.8, sustain: 0.1, release: 1.4 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0, release: 0.4 },
    })
    rhodes.volume.value = -8
    rhodes.connect(this._master)

    // Brushed hat — short pink noise burst
    const hat = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.05 },
    })
    hat.volume.value = -22
    hat.connect(this._master)

    // Tidal pad — slow attack PolySynth
    const pad = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: 2,
      envelope: { attack: 1.6, decay: 0.8, sustain: 0.7, release: 2.4 },
    })
    pad.volume.value = -14
    pad.connect(this._master)

    this._voices.bass   = bass
    this._voices.rhodes = rhodes
    this._voices.hat    = hat
    this._voices.pad    = pad
  }

  setPhrase(voiceId, phrase) {
    this._phrases[voiceId] = Array.isArray(phrase) ? phrase : []
  }

  setBrighter(brighter) {
    if (!this._filter) return
    this._filter.frequency.rampTo(brighter ? 6500 : 1400, 1.2)
  }

  setMasterVolume(db) {
    if (!this._master) return
    this._master.volume.rampTo(db, 0.2)
  }

  setOnBeat(cb) { this._onBeat = cb }

  async start() {
    if (this._started) return
    await Tone.start()
    Tone.Transport.bpm.value = BPM
    this._beat = -1

    this._loopId = Tone.Transport.scheduleRepeat((time) => {
      this._beat = (this._beat + 1) % TOTAL_BEATS
      const beat = this._beat
      this._triggerBeat(beat, time)
      const cb = this._onBeat
      if (cb) Tone.Draw.schedule(() => cb(beat), time)
    }, '4n')

    Tone.Transport.start()
    this._started = true
  }

  _triggerBeat(beat, time) {
    // Bass
    for (const n of this._phrases.bass ?? []) {
      if (n.beat === beat) this._voices.bass?.triggerAttackRelease(midiToName(n.midi), '2n', time, 0.7)
    }
    // Rhodes — longer holds, soft velocity
    for (const n of this._phrases.rhodes ?? []) {
      if (n.beat === beat) this._voices.rhodes?.triggerAttackRelease(midiToName(n.midi), '1n', time, 0.45)
    }
    // Hat — pitch ignored, just texture
    for (const n of this._phrases.hat ?? []) {
      if (n.beat === beat) this._voices.hat?.triggerAttackRelease('16n', time, 0.5)
    }
    // Pad — sustained, often layered with neighbour
    for (const n of this._phrases.pad ?? []) {
      if (n.beat === beat) this._voices.pad?.triggerAttackRelease(midiToName(n.midi), '2m', time, 0.4)
    }
  }

  stop() {
    if (!this._started) return
    if (this._loopId != null) {
      Tone.Transport.clear(this._loopId)
      this._loopId = null
    }
    // Let voices ring out naturally — but kill the transport.
    Tone.Transport.stop()
    Tone.Transport.position = 0
    this._beat = -1
    this._started = false
    if (this._onBeat) this._onBeat(-1)
  }

  dispose() {
    this.stop()
    for (const v of Object.values(this._voices)) v.dispose()
    this._filter?.dispose()
    this._reverb?.dispose()
    this._master?.dispose()
    this._voices = {}
  }
}
