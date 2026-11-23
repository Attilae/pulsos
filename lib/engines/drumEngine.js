import * as Tone from 'tone'
import { unlockAudio } from '../audioSession.js'
import { PAD_DEFS, STEPS, SOURCE_STEPS, STEP_LEVELS, cycleStepValue, normalizeStep } from '../drumSpecs.js'
import { patternFromStops } from '../drumGen.js'
import { normalizeDrumGroove, drumStepHits, padGrooveAt } from '../drumGroove.js'
import { normalizeDrumKit, drumKitOf } from '../drumKit.js'
import { createPadVoice } from '../drumVoices.js'

export { PAD_DEFS, STEPS, SOURCE_STEPS, STEP_LEVELS }

export { cycleStepValue, normalizeStep } from '../drumSpecs.js'
export { patternFromStops, DRUM_GEN_MODES, DRUM_GEN_LABELS, DRUM_GEN_HINTS, DEFAULT_DRUM_GEN_MODE } from '../drumGen.js'

export function emptyPattern() {
  return new Array(SOURCE_STEPS).fill(0)
}

export function emptyStops() {
  return Array.from({ length: SOURCE_STEPS }, () => [])
}

// Bucket a route's stops into 64 steps proportional to cumulative distance.
// Returns { pattern: number[64] (step velocities), stops: string[][] } where
// stops[i] is the list of stop names (in order) that fell into bucket i.
// The generators (distance / euclid / roles) live in lib/drumGen.js.
export function patternFromRoute(route) {
  return patternFromStops(route, { mode: 'distance' })
}

// ── Reusable drum voices + step loop ─────────────────────────────────────────
// DrumSequencer owns the 6 drum voices, the per-pad pattern/offset/mute state,
// and a Transport-synced 16-step loop — but it does NOT own Transport start/stop.
// The Drum Machine tab drives it through DrumEngine (which owns the Transport);
// the DAW's TransitEngine embeds one and schedules it on its own mock Transport
// so a beat plays in sync under the transit tracks. See docs / CLAUDE.md.
export class DrumSequencer {
  constructor() {
    this._voices   = {}
    this._volumes  = {}
    this._masterComp = null

    this._patterns = Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyPattern()]))
    this._stops    = Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyStops()]))
    this._offsets  = Object.fromEntries(PAD_DEFS.map(p => [p.id, 0]))

    this._muted    = Object.fromEntries(PAD_DEFS.map(p => [p.id, false]))
    this._padVols  = Object.fromEntries(PAD_DEFS.map(p => [p.id, 0]))

    // Sparse swing/humanize/chance/ratchet fields (lib/drumGroove.js).
    this._groove      = {}
    // Kit + per-pad tune/decay/tone (lib/drumKit.js); voices built by lib/drumVoices.js.
    this._kit         = 'classic'
    this._padVoices   = {}

    this._loopId      = null
    this._currentStep = -1
    this._onStep      = null
    this._onTrigger   = null
  }

  // Build the drum voices, routed into `destination` (a Tone node). Defaults to
  // the main output when omitted (standalone drum-machine use).
  init(destination = null) {
    const out = destination ?? Tone.getDestination()
    const masterComp = new Tone.Compressor(-12, 4).connect(out)

    for (const pad of PAD_DEFS) {
      this._volumes[pad.id] = new Tone.Volume(this._muted[pad.id] ? -Infinity : this._padVols[pad.id]).connect(masterComp)
    }
    this._buildVoices()

    this._masterComp = masterComp
    return this
  }

  // (Re)build every pad's voice for the current kit, feeding the existing pad
  // Volumes, so a kit switch keeps mute, volume and the running schedule.
  _buildVoices() {
    for (const v of Object.values(this._voices)) v.dispose()
    this._voices = {}
    for (const pad of PAD_DEFS) {
      const voice = createPadVoice(this._kit, pad.id)
      if (!voice) continue
      voice.set(this._padVoices[pad.id])
      voice.connect(this._volumes[pad.id])
      this._voices[pad.id] = voice
    }
  }

  setOnStep(cb) {
    this._onStep = cb
  }

  // Per-hit audio-rate callback: (padId, time, stepVel). Unlike setOnStep — which
  // is deferred through Tone.Draw and so runs at frame rate with no pad identity —
  // this fires with the raw scheduler time, ahead of the audio clock, so callers
  // can schedule sample-accurate audio against a hit (the DAW's sidechain ducking).
  setOnTrigger(cb) {
    this._onTrigger = cb
  }

  // ── Per-pad state ─────────────────────────────────────────────────────────
  setPattern(padId, pattern) {
    if (Array.isArray(pattern) && pattern.length === SOURCE_STEPS) {
      this._patterns[padId] = pattern.map(normalizeStep)
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

  // Cycle a step's velocity level using the *visible* step index (0..STEPS-1).
  toggleStep(padId, visibleStepIdx) {
    const p = this._patterns[padId]
    if (!p) return
    const offset = this._offsets[padId] ?? 0
    const idx = (offset + visibleStepIdx) % SOURCE_STEPS
    p[idx] = cycleStepValue(p[idx])
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

  // ── Bulk load (used by the DAW's TransitEngine) ───────────────────────────
  // Accepts { patterns, offsets, muted } keyed by padId — the same shapes the
  // Drum Machine tab keeps in React state. Applies mute live if voices exist.
  load({ patterns, offsets, muted, ...rest } = {}) {
    this.setGroove(rest)
    this.setKit(rest)
    for (const pad of PAD_DEFS) {
      const pat = patterns?.[pad.id]
      if (Array.isArray(pat) && pat.length === SOURCE_STEPS) this._patterns[pad.id] = pat.map(normalizeStep)
      if (offsets && offsets[pad.id] != null) this.setOffset(pad.id, offsets[pad.id])
      if (muted) this.setPadMute(pad.id, !!muted[pad.id])
    }
  }

  // Swing, humanize, per-pad chance and per-step ratchets, from any object that
  // carries the drum pattern's sparse groove keys. Read on the next 16th.
  setGroove(dp) {
    this._groove = normalizeDrumGroove(dp)
  }

  // Kit and per-pad voice settings from any object carrying the drum pattern's
  // sparse `kit` / `voices` keys. A kit change rebuilds the voices (only if they
  // exist yet: init() builds them for whatever kit is set by then).
  setKit(dp) {
    const { voices = {} } = normalizeDrumKit(dp)
    const kit = drumKitOf(dp)
    this._padVoices = voices
    if (kit !== this._kit) {
      this._kit = kit
      if (this._masterComp) this._buildVoices()
      return
    }
    for (const pad of PAD_DEFS) this._voices[pad.id]?.set(voices[pad.id])
  }

  // True when at least one pad has an active step (so callers can skip scheduling).
  hasActiveSteps() {
    return PAD_DEFS.some(pad => this._patterns[pad.id]?.some(Boolean))
  }

  // ── Transport-synced loop (does NOT start/stop the Transport) ─────────────
  // Registers a scheduleRepeat on the current Tone.Transport and returns its id.
  // The caller owns Transport.start()/stop()/cancel().
  // startAt anchors the 16th-note grid to a Transport time. The Song Chainer needs
  // a future anchor so a section's drums line up with its lanes when it is built
  // ahead of its boundary; everything else leaves it at the transport origin.
  schedule(startAt = 0) {
    this.clearSchedule()
    this._currentStep = -1
    this._loopId = Tone.getTransport().scheduleRepeat((time) => {
      this._currentStep = (this._currentStep + 1) % STEPS
      const step = this._currentStep
      // Read per tick so a tempo change mid-play keeps swing and rolls in time.
      const sixteenthSec = Tone.Time('16n').toSeconds()
      for (const pad of PAD_DEFS) {
        const offset = this._offsets[pad.id] ?? 0
        const srcIdx = (offset + step) % SOURCE_STEPS
        const vel = this._patterns[pad.id]?.[srcIdx]
        if (!vel) continue
        const hits = drumStepHits({ step, vel, sixteenthSec, ...padGrooveAt(this._groove, pad.id, srcIdx) })
        for (const hit of hits) this._trigger(pad.id, time + hit.offset, hit.vel)
        // Muted pads still run through _trigger (mute is a -Infinity Volume
        // downstream), but they make no sound — so they must not drive anything
        // keyed off "this pad was heard", e.g. sidechain ducking. A roll ducks
        // once, on its first hit; a step lost to chance doesn't duck at all.
        if (hits.length && this._onTrigger && !this._muted[pad.id]) {
          this._onTrigger(pad.id, time + hits[0].offset, hits[0].vel)
        }
      }
      const cb = this._onStep
      if (cb) Tone.getDraw().schedule(() => cb(step), time)
    }, '16n', startAt)
    return this._loopId
  }

  clearSchedule() {
    if (this._loopId != null) {
      Tone.getTransport().clear(this._loopId)
      this._loopId = null
    }
    this._currentStep = -1
    if (this._onStep) this._onStep(-1)
  }

  dispose() {
    this.clearSchedule()
    for (const v of Object.values(this._voices))  v.dispose()
    for (const v of Object.values(this._volumes)) v.dispose()
    this._masterComp?.dispose()
    this._voices  = {}
    this._volumes = {}
    this._masterComp = null
    this._onTrigger = null
  }

  // stepVel scales each voice's baked base level, so a full step (1) sounds
  // exactly like the pre-velocity feature.
  _trigger(padId, time, stepVel = 1) {
    this._voices[padId]?.trigger(time, stepVel)
  }
}

// DrumEngine — the Drum Machine tab's engine. Owns the Transport; delegates all
// voice + pattern + step-loop work to a DrumSequencer so the DAW can reuse it.
export class DrumEngine {
  constructor() {
    this._seq     = new DrumSequencer()
    this._started = false
  }

  init() {
    this._seq.init()   // routes to the main output
  }

  setPattern(padId, pattern) { this._seq.setPattern(padId, pattern) }
  setStops(padId, stops)     { this._seq.setStops(padId, stops) }
  setOffset(padId, offset)   { this._seq.setOffset(padId, offset) }
  toggleStep(padId, i)       { this._seq.toggleStep(padId, i) }
  getPattern(padId)          { return this._seq.getPattern(padId) }
  setPadVolume(padId, db)    { this._seq.setPadVolume(padId, db) }
  setPadMute(padId, muted)   { this._seq.setPadMute(padId, muted) }
  setGroove(dp)              { this._seq.setGroove(dp) }
  setKit(dp)                 { this._seq.setKit(dp) }
  clear(padId)               { this._seq.clear(padId) }
  setOnStep(cb)              { this._seq.setOnStep(cb) }

  setBpm(bpm) {
    Tone.getTransport().bpm.value = bpm
  }

  async start(bpm = 120) {
    if (this._started) return
    await unlockAudio()
    Tone.getTransport().bpm.value = bpm
    this._seq.schedule()
    Tone.getTransport().start()
    this._started = true
  }

  stop() {
    if (!this._started) return
    this._seq.clearSchedule()
    Tone.getTransport().stop()
    Tone.getTransport().position = 0
    this._started = false
  }

  dispose() {
    this.stop()
    this._seq.dispose()
  }
}
