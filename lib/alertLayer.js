import * as Tone from 'tone'
import { modeForAlert, severityToReverb, MODES } from './mappings.js'

// Manages macro-level musical changes driven by service alerts.
// Owns the master reverb and tracks the current harmonic mode.
//
// Signal flow (engine wires this):
//   lineType volumes → masterReverb → masterCompressor → masterLimiter → Destination
export class AlertLayer {
  constructor() {
    this.currentMode      = 'dorian'
    this.currentModeScale = MODES.dorian

    // Master bus effects (engine must connect its output through these)
    this.reverb = new Tone.Reverb({ decay: 1.2, wet: 0.18 })
    this.reverb.generate()  // pre-compute impulse response

    this.compressor = new Tone.Compressor({
      threshold: -18, ratio: 4, attack: 0.05, release: 0.3,
    })
    this.limiter = new Tone.Limiter(-1)

    // Chain: reverb → compressor → limiter → destination
    this.reverb.chain(this.compressor, this.limiter, Tone.getDestination())

    this._modeTransitionTimer = null
  }

  // Called by the engine when an alert_update arrives from the server.
  // alerts: array of { cause, effect, severityLevel, informedEntities }
  handleAlerts(alerts) {
    // Find the most severe active alert
    const sorted = [...alerts].sort((a, b) =>
      (b.severityLevel ?? 0) - (a.severityLevel ?? 0)
    )
    const worst = sorted[0]

    if (!worst) {
      this._transitionMode('dorian')
      this._applyReverb(0)
      return
    }

    const newMode = modeForAlert(worst.cause, worst.effect)
    this._transitionMode(newMode)
    this._applyReverb(worst.severityLevel ?? 0)
  }

  // Smoothly cross-fade into a new mode over ~8 seconds.
  // Existing notes continue in old mode; new ones use the new scale.
  _transitionMode(modeName) {
    if (modeName === this.currentMode) return
    if (this._modeTransitionTimer) clearTimeout(this._modeTransitionTimer)

    // Schedule the actual scale switch after a short overlap window
    this._modeTransitionTimer = setTimeout(() => {
      this.currentMode      = modeName
      this.currentModeScale = MODES[modeName] ?? MODES.dorian
      this._modeTransitionTimer = null
    }, 8000)
  }

  _applyReverb(severity) {
    const { decay, wet } = severityToReverb(severity)
    // Reverb decay can't be ramped (it's a ConvolverNode), but wet can
    this.reverb.wet.rampTo(wet, 6.0)
    // Regenerate reverb with new decay — schedule slightly ahead
    // to avoid clicks (uses a new impulse; brief crossfade via wet ramp)
    setTimeout(() => {
      this.reverb.decay = decay
      this.reverb.generate()
    }, 6500)
  }

  // Returns the output node that the engine should chain lineType volumes into
  get input() {
    return this.reverb
  }

  dispose() {
    if (this._modeTransitionTimer) clearTimeout(this._modeTransitionTimer)
    this.reverb.dispose()
    this.compressor.dispose()
    this.limiter.dispose()
  }
}
