import * as Tone from 'tone'
import { noteToMidi } from './mappings.js'

// Per-track granular layer (see engine.setGranular). Tone.GrainPlayer is a
// continuous Source, not a triggerable instrument, so this wrapper bridges it
// into the instrument surface TransitEngine expects (triggerAttackRelease /
// triggerAttack / triggerRelease / connect / set / dispose / loaded).
// Signal flow:
//   GrainPlayer (loop, free-running) → AmplitudeEnvelope → mix Gain → outputNode
// The voice is constructed bufferless; the grain source is the track's own
// instrument, rendered offline by engine._renderGranularSource and delivered
// via setBuffer(), which starts the looping player. The envelope gates
// per-note bursts (or stays open for drone mode); the mix gain levels the
// layer against the dry instrument. Pitch comes from GrainPlayer.detune
// relative to baseNote (the note the source was rendered at) — independent of
// playbackRate, which stays a texture control.
export class GranularVoice {
  constructor(opts = {}) {
    this._disposed      = false
    this._baseMidi      = noteToMidi(opts.baseNote ?? 'C4')
    this._loopStartFrac = clamp01(opts.loopStart ?? 0)
    this._loopEndFrac   = clamp01(opts.loopEnd ?? 1)
    this._jitter        = opts.jitter ?? 0

    this._player = new Tone.GrainPlayer({
      loop:         true,
      grainSize:    opts.grainSize    ?? 0.09,
      overlap:      opts.overlap      ?? 0.05,
      playbackRate: opts.playbackRate ?? 1,
      reverse:      !!opts.reverse,
      // Higher base level than the dry synth (-18) so the layer has real
      // presence: granular windowing + the looped render's quiet tail sap a lot
      // of RMS, and mix is a linear post-env gain. This gives mix an audible
      // range (mix 1.0 ≈ -6 dB, default 0.5 ≈ -12 dB, peer of the dry note).
      volume:       opts.volume ?? -6,
    })

    this._env = new Tone.AmplitudeEnvelope({
      attack:  opts.attack ?? 0.05,
      decay:   0,
      sustain: 1,
      release: opts.release ?? 0.8,
    })

    this._mix = new Tone.Gain(clamp01(opts.mix ?? 0.5))

    this._player.connect(this._env)
    this._env.connect(this._mix)
  }

  get loaded() { return this._player.loaded }

  connect(dest) {
    this._mix.connect(dest)
    return this
  }

  setMix(v) {
    this._mix.gain.rampTo(clamp01(v), 0.05)
  }

  // Loop start/end are stored as 0–1 fractions of the buffer so the UI works
  // before the rendered buffer (and its duration) is known.
  _applyLoopWindow() {
    if (!this._player.loaded) return
    const duration = this._player.buffer.duration
    if (!duration) return
    const start = this._loopStartFrac * duration
    // Keep the window at least one grain wide so the grain clock never stalls.
    const minSpan = Math.max(Number(this._player.grainSize) || 0.01, 0.01)
    const end = Math.max(this._loopEndFrac * duration, start + minSpan)
    this._player.loopStart = start
    this._player.loopEnd   = Math.min(end, duration)
  }

  // detune is global per player, so overlapping notes (arp steps, dense
  // arrivals) retune the shared grain stream — mono-ish granular by design.
  _applyPitch(note, withJitter = true) {
    const semis  = noteToMidi(note) - this._baseMidi
    this._player.detune = Math.max(-2400, Math.min(2400, semis * 100))
    if (withJitter && this._jitter > 0 && this._player.loaded) {
      const duration = this._player.buffer.duration
      const start = this._loopStartFrac * duration
      const end   = Number(this._player.loopEnd) || duration
      const span  = Math.max(end - start - (Number(this._player.grainSize) || 0), 0)
      this._player.loopStart = start + Math.random() * this._jitter * span
    }
  }

  triggerAttackRelease(note, dur, time) {
    if (!this.loaded) return
    this._applyPitch(note)
    this._env.triggerAttackRelease(dur, time)
  }

  triggerAttack(note, time) {
    this._applyPitch(note)
    this._env.triggerAttack(time ?? Tone.now())
  }

  triggerRelease(time) {
    this._env.triggerRelease(time ?? Tone.now())
  }

  // Retune while the envelope is open (drone root changes).
  setNote(note) {
    this._applyPitch(note, false)
  }

  // Flat param interface mirroring Tone's .set(); tolerates the full granular
  // cfg object (unknown keys like `enabled` are ignored).
  set(params = {}) {
    const p = params
    if (p.mix     != null) this.setMix(p.mix)
    if (p.attack  != null) this._env.attack  = p.attack
    if (p.release != null) this._env.release = p.release
    if (p.grainSize    != null) { this._player.grainSize = p.grainSize; this._applyLoopWindow() }
    if (p.overlap      != null) this._player.overlap = p.overlap
    if (p.playbackRate != null) this._player.playbackRate = p.playbackRate
    if (p.reverse      != null) this._player.reverse = !!p.reverse
    if (p.jitter       != null) this._jitter = p.jitter
    if (p.loopStart != null || p.loopEnd != null) {
      if (p.loopStart != null) this._loopStartFrac = clamp01(p.loopStart)
      if (p.loopEnd   != null) this._loopEndFrac   = clamp01(p.loopEnd)
      this._applyLoopWindow()
    }
    return this
  }

  // Swap in a freshly rendered grain source and (re)start the looping player.
  setBuffer(audioBuffer) {
    if (this._disposed || !audioBuffer) return
    try {
      if (this._player.state === 'started') this._player.stop()
      this._player.buffer.set(audioBuffer)
      this._applyLoopWindow()
      this._player.start()
    } catch (err) { console.warn('GranularVoice setBuffer', err) }
  }

  dispose() {
    if (this._disposed) return this
    this._disposed = true
    try { this._player.stop() } catch {}
    this._player.dispose()
    this._env.dispose()
    this._mix.dispose()
    return this
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)) }
