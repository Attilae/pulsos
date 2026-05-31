import * as Tone from 'tone'

// Per-vehicle Tone.js signal chain (instrument track, dry signal only).
// Signal flow: FMSynth → Panner → outputNode
// Effects live on FxTrack instances; automation drives their params.
export class VehicleVoice {
  constructor(outputNode) {
    this._active      = false
    this._note        = null
    this._outputNode  = outputNode
    this._harmonySynth   = null
    this._harmonyInterval = 0

    this._synth = new Tone.FMSynth({
      oscillator:  { type: 'sine' },
      envelope:    { attack: 0.4, decay: 0.1, sustain: 1.0, release: 1.4 },
      modulation:  { type: 'sine' },
      modulationEnvelope: { attack: 0.5, decay: 0.1, sustain: 1.0, release: 1.4 },
      harmonicity: 3,
      modulationIndex: 0,
      volume: -18,
    })

    this._panner = new Tone.Panner(0)
    this._synth.chain(this._panner, outputNode)
  }

  setMode(mode, harmonyInterval = 0) {
    if (mode === 'percussive') {
      this._synth.set({ envelope: { attack: 0.003, decay: 0.18, sustain: 0, release: 0.35 } })
      this._disposeHarmonySynth()
    } else {
      this._synth.set({ envelope: { attack: 0.4, decay: 0.1, sustain: 1.0, release: 1.4 } })
      this._setHarmonyInterval(harmonyInterval)
    }
  }

  _setHarmonyInterval(semitones) {
    this._harmonyInterval = semitones
    if (semitones === 0) { this._disposeHarmonySynth(); return }
    if (!this._harmonySynth) {
      this._harmonySynth = new Tone.Synth({
        oscillator: { type: 'sine' },
        volume: -12,
        envelope: { attack: 0.4, decay: 0.1, sustain: 0.8, release: 1.4 },
      })
      this._harmonySynth.chain(this._panner, this._outputNode)
    }
  }

  _disposeHarmonySynth() {
    if (this._harmonySynth) {
      this._harmonySynth.dispose()
      this._harmonySynth = null
    }
    this._harmonyInterval = 0
  }

  // Update voice with the latest vehicle state.
  // data: { note, currentStatus, delay? }
  update(data) {
    const { note, currentStatus, delay } = data

    // ── Status envelope: drive ADSR from vehicle state machine ───────────────
    if (currentStatus === 0 && !this._active) {
      const n = note ?? this._note ?? 'D4'
      this._synth.triggerAttack(n, Tone.now())
      if (this._harmonySynth && this._harmonyInterval) {
        this._harmonySynth.triggerAttack(
          Tone.Frequency(n).transpose(this._harmonyInterval).toFrequency(), Tone.now()
        )
      }
      this._note   = note ?? this._note
      this._active = true
    } else if (currentStatus === 2 && this._active) {
      this._synth.triggerRelease(Tone.now())
      this._harmonySynth?.triggerRelease(Tone.now())
      this._active = false
    } else if (currentStatus === 1 && !this._active) {
      const n = note ?? 'D4'
      this._synth.triggerAttack(n, Tone.now())
      if (this._harmonySynth && this._harmonyInterval) {
        this._harmonySynth.triggerAttack(
          Tone.Frequency(n).transpose(this._harmonyInterval).toFrequency(), Tone.now()
        )
      }
      this._note   = note ?? this._note
      this._active = true
    }

    // ── Note change while active — smooth portamento ──────────────────────────
    if (note && note !== this._note && this._active) {
      this._synth.frequency.rampTo(Tone.Frequency(note).toFrequency(), 0.4)
      this._note = note
    }

    // ── Delay → subtle pitch detuning (late = sharp, early = flat) ───────────
    if (delay != null) {
      const cents = Math.max(-200, Math.min(200, delay * 0.67))
      this._synth.detune.rampTo(cents, 2.0)
    }
  }

  handleScheduleRelationship(rel) {
    if (!this._active) return
    if (rel === 3 || rel === 'CANCELED') {
      const currentFreq = Tone.Frequency(this._note ?? 'D4').toFrequency()
      this._synth.frequency.rampTo(currentFreq / 4, 2.5)
      this._synth.volume.rampTo(-80, 2.8)
      this._active = false
    } else if (rel === 7 || rel === 'DELETED') {
      this._synth.triggerRelease(Tone.now())
      this._active = false
    }
  }

  dispose() {
    if (this._active) {
      this._synth.triggerRelease(Tone.now())
      this._harmonySynth?.triggerRelease(Tone.now())
    }
    setTimeout(() => {
      this._synth.dispose()
      this._panner.dispose()
      this._disposeHarmonySynth()
    }, 2000)
  }
}
