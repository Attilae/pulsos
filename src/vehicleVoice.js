import * as Tone from 'tone'
import {
  vehiclePan,
  speedToVibratoDepth,
  occupancyToModIndex,
  delayToCents,
} from './mappings.js'

// Per-vehicle Tone.js signal chain.
// Signal flow: FMSynth → Vibrato → Filter → Panner → outputNode
//
// The outputNode is the lineType Volume node owned by the engine,
// so existing DAW mute/volume controls remain in effect.
export class VehicleVoice {
  constructor(outputNode) {
    this._active      = false
    this._note        = null
    this._prevSpeed   = 0
    this._outputNode  = outputNode
    this._harmonySynth   = null
    this._harmonyInterval = 0

    // Main voice: FMSynth with occupancy-driven modulation index
    this._synth = new Tone.FMSynth({
      oscillator:  { type: 'sine' },
      envelope:    { attack: 0.4, decay: 0.1, sustain: 1.0, release: 1.4 },
      modulation:  { type: 'sine' },
      modulationEnvelope: { attack: 0.5, decay: 0.1, sustain: 1.0, release: 1.4 },
      harmonicity: 3,
      modulationIndex: 0,
      volume: -18,
    })

    this._vibrato = new Tone.Vibrato({ frequency: 5.5, depth: 0, wet: 1 })

    // Lowpass filter — cutoff driven by speed/acceleration
    this._filter = new Tone.Filter({ frequency: 1200, type: 'lowpass', Q: 1.2 })

    this._panner = new Tone.Panner(0)

    // Chain and connect to provided output
    this._synth.chain(this._vibrato, this._filter, this._panner, outputNode)
  }

  // Switch between percussive (short one-shot) and harmonic (sustained) modes.
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
      this._harmonySynth.chain(this._filter, this._panner, this._outputNode)
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
  // data: { note, lat, lng, bearing, speed, currentStatus,
  //         occupancyPct, delay, uncertainty, edgeness? }
  update(data) {
    const { note, lng, bearing, speed, currentStatus, occupancyPct, delay } = data

    // ── Status envelope: drive ADSR from vehicle state machine ───────────────
    if (currentStatus === 0 && !this._active) {
      // INCOMING_AT → attack
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
      // IN_TRANSIT_TO → release
      this._synth.triggerRelease(Tone.now())
      this._harmonySynth?.triggerRelease(Tone.now())
      this._active = false
    } else if (currentStatus === 1 && !this._active) {
      // STOPPED_AT with no prior attack (e.g., first sight of vehicle at stop)
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
      this._synth.frequency.rampTo(
        Tone.Frequency(note).toFrequency(), 0.4
      )
      this._note = note
    }

    // ── Delay → pitch detuning (late train = sharp, early = flat) ────────────
    const cents = delayToCents(delay ?? 0)
    this._synth.detune.rampTo(cents, 2.0)

    // ── Speed → vibrato depth ─────────────────────────────────────────────────
    const vibratoDepth = speedToVibratoDepth(speed)
    this._vibrato.depth.rampTo(vibratoDepth, 1.5)

    // ── Implied acceleration → filter sweep ───────────────────────────────────
    const accel = ((speed ?? 0) - this._prevSpeed) / 5
    this._prevSpeed = speed ?? 0
    const baseFreq = 1200 + (occupancyToModIndex(occupancyPct) / 10) * 2000
    const accelFreq = Math.max(200, Math.min(6000, baseFreq + accel * 300))
    this._filter.frequency.rampTo(accelFreq, 0.6)

    // ── Occupancy → FM modulation index ──────────────────────────────────────
    const modIdx = occupancyToModIndex(occupancyPct)
    this._synth.modulationIndex.rampTo(modIdx, 3.0)

    // ── Bearing + longitude → stereo pan ─────────────────────────────────────
    const pan = vehiclePan(lng ?? 19.05, bearing ?? 0)
    this._panner.pan.rampTo(pan, 2.5)
  }

  // Handle schedule relationship changes (CANCELED, DELETED)
  handleScheduleRelationship(rel) {
    if (!this._active) return
    if (rel === 3 || rel === 'CANCELED') {
      // Descending glide then silence
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
    // Small delay before disposal so release tails finish
    setTimeout(() => {
      this._synth.dispose()
      this._vibrato.dispose()
      this._filter.dispose()
      this._panner.dispose()
      this._disposeHarmonySynth()
    }, 2000)
  }
}
