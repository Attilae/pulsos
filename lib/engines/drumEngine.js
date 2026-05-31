import * as Tone from 'tone'

export const PAD_DEFS = [
  { id: 'kick',  label: 'Kick',  defaultRouteName: '6' },
  { id: 'snare', label: 'Snare', defaultRouteName: '2' },
  { id: 'hat',   label: 'Hat',   defaultRouteName: '4' },
  { id: 'rim',   label: 'Rim',   defaultRouteName: 'M2' },
  { id: 'ride',  label: 'Ride',  defaultRouteName: 'M3' },
  { id: 'clap',  label: 'Clap',  defaultRouteName: '1' },
]

export const STEPS        = 16   // visible / playback loop length (1 bar of 16ths)
export const SOURCE_STEPS = 64   // underlying buffer length per pad

export function emptyPattern() {
  return new Array(SOURCE_STEPS).fill(false)
}

export function emptyStops() {
  return Array.from({ length: SOURCE_STEPS }, () => [])
}

// Bucket a route's stops into 64 steps proportional to cumulative distance.
// Returns { pattern: bool[64], stops: string[][] } where stops[i] is the list
// of stop names (in order) that fell into bucket i.
export function patternFromRoute(route) {
  const pattern = emptyPattern()
  const stops   = emptyStops()
  if (!route?.stops?.length || !route.totalDist) return { pattern, stops }
  for (const stop of route.stops) {
    const idx = Math.min(SOURCE_STEPS - 1, Math.floor((stop.dist / route.totalDist) * SOURCE_STEPS))
    pattern[idx] = true
    stops[idx].push(stop.name ?? '')
  }
  return { pattern, stops }
}

export class DrumEngine {
  constructor() {
    this._voices   = {}
    this._volumes  = {}

    this._patterns = Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyPattern()]))
    this._stops    = Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyStops()]))
    this._offsets  = Object.fromEntries(PAD_DEFS.map(p => [p.id, 0]))

    this._muted    = Object.fromEntries(PAD_DEFS.map(p => [p.id, false]))
    this._padVols  = Object.fromEntries(PAD_DEFS.map(p => [p.id, 0]))

    this._loopId      = null
    this._currentStep = -1
    this._onStep      = null
    this._started     = false
  }

  init() {
    const masterComp = new Tone.Compressor(-12, 4).toDestination()

    this._voices.kick = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 6,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
    })
    this._voices.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.13, sustain: 0 },
    })
    this._voices.hat = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
    })
    this._voices.rim = new Tone.MembraneSynth({
      pitchDecay: 0.008, octaves: 2,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    })
    this._voices.ride = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.4, release: 0.2 },
      harmonicity: 8, modulationIndex: 40, resonance: 6000, octaves: 0.8,
    })
    this._voices.clap = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0 },
    })

    for (const pad of PAD_DEFS) {
      const vol = new Tone.Volume(0).connect(masterComp)
      this._volumes[pad.id] = vol
      this._voices[pad.id].connect(vol)
    }

    this._masterComp = masterComp
  }

  setPattern(padId, pattern) {
    if (Array.isArray(pattern) && pattern.length === SOURCE_STEPS) {
      this._patterns[padId] = pattern.slice()
    }
  }

  setStops(padId, stops) {
    if (Array.isArray(stops) && stops.length === SOURCE_STEPS) {
      this._stops[padId] = stops.map(s => s.slice())
    }
  }

  setOffset(padId, offset) {
    const n = ((Math.round(offset) % SOURCE_STEPS) + SOURCE_STEPS) % SOURCE_STEPS
    this._offsets[padId] = n
  }

  // Toggle a step using the *visible* step index (0..STEPS-1).
  toggleStep(padId, visibleStepIdx) {
    const p = this._patterns[padId]
    if (!p) return
    const offset = this._offsets[padId] ?? 0
    const idx = (offset + visibleStepIdx) % SOURCE_STEPS
    p[idx] = !p[idx]
  }

  getPattern(padId) {
    return this._patterns[padId]
  }

  setPadVolume(padId, db) {
    this._padVols[padId] = db
    this._volumes[padId]?.set({ volume: this._muted[padId] ? -Infinity : db })
  }

  setPadMute(padId, muted) {
    this._muted[padId] = muted
    this._volumes[padId]?.set({ volume: muted ? -Infinity : this._padVols[padId] })
  }

  clear(padId) {
    if (padId) {
      this._patterns[padId] = emptyPattern()
      this._stops[padId]    = emptyStops()
    } else {
      for (const p of PAD_DEFS) {
        this._patterns[p.id] = emptyPattern()
        this._stops[p.id]    = emptyStops()
      }
    }
  }

  setBpm(bpm) {
    Tone.Transport.bpm.value = bpm
  }

  setOnStep(cb) {
    this._onStep = cb
  }

  async start(bpm = 120) {
    if (this._started) return
    await Tone.start()
    Tone.Transport.bpm.value = bpm
    this._currentStep = -1

    this._loopId = Tone.Transport.scheduleRepeat((time) => {
      this._currentStep = (this._currentStep + 1) % STEPS
      const step = this._currentStep
      for (const pad of PAD_DEFS) {
        const offset = this._offsets[pad.id] ?? 0
        const srcIdx = (offset + step) % SOURCE_STEPS
        if (this._patterns[pad.id]?.[srcIdx]) {
          this._trigger(pad.id, time)
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
    this._currentStep = -1
    this._started = false
    if (this._onStep) this._onStep(-1)
  }

  dispose() {
    this.stop()
    for (const v of Object.values(this._voices)) v.dispose()
    for (const v of Object.values(this._volumes)) v.dispose()
    this._masterComp?.dispose()
    this._voices  = {}
    this._volumes = {}
  }

  _trigger(padId, time) {
    const v = this._voices[padId]
    if (!v) return
    if (padId === 'kick')       v.triggerAttackRelease('C1', '8n',  time)
    else if (padId === 'snare') v.triggerAttackRelease('16n', time)
    else if (padId === 'hat')   v.triggerAttackRelease('C6', '32n', time, 0.5)
    else if (padId === 'rim')   v.triggerAttackRelease('A4', '32n', time, 0.7)
    else if (padId === 'ride')  v.triggerAttackRelease('C5', '8n',  time, 0.4)
    else if (padId === 'clap')  v.triggerAttackRelease('8n', time)
  }
}
