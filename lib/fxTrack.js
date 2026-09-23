import * as Tone from 'tone'
import { REVERB_IR_PRESETS, FX_BUSES, FX_SYNC_DIVISIONS, FX_SYNC_TARGETS, FX_PARAM_SPECS } from './fxSpecs.js'

export { REVERB_IR_PRESETS, FX_BUSES, FX_SYNC_DIVISIONS, FX_SYNC_TARGETS, FX_PARAM_SPECS }

const _irBufferCache = new Map()

async function _loadIRBufferFromUrl(url) {
  if (_irBufferCache.has(url)) return _irBufferCache.get(url)
  const p = fetch(url)
    .then(r => { if (!r.ok) throw new Error(`IR fetch failed (${r.status}): ${url}`); return r.arrayBuffer() })
    .then(buf => Tone.getContext().rawContext.decodeAudioData(buf))
    .then(_bFormatToStereoIfNeeded)
  _irBufferCache.set(url, p)
  return p
}

// OpenAir ships some IRs as 4-channel B-format (FuMa: W, X, Y, Z). Web Audio's
// ConvolverNode interprets a 4-channel buffer as "true stereo" (ch0/1 → L, ch2/3 → R),
// which would garble a B-format IR. Decode to a virtual Blumlein stereo pair from W + Y.
function _bFormatToStereoIfNeeded(buffer) {
  if (buffer.numberOfChannels !== 4) return buffer
  const out = Tone.getContext().rawContext.createBuffer(2, buffer.length, buffer.sampleRate)
  const W = buffer.getChannelData(0)
  const Y = buffer.getChannelData(2)
  const L = out.getChannelData(0)
  const R = out.getChannelData(1)
  for (let i = 0; i < buffer.length; i++) {
    L[i] = W[i] + Y[i]
    R[i] = W[i] - Y[i]
  }
  return out
}

// A delay node's `delayTime` Signal is hard-capped at its `maxDelay` (Tone
// defaults to 1s and throws a RangeError above it). The free-mode slider goes
// to 1.5s and a tempo-synced division at slow BPM can run longer still, so the
// delay buses are built with this larger ceiling and synced divisions are
// clamped to it.
const DELAY_MAX_TIME = 4

// Automation destinations. Each entry declares its native range and unit so
// the apply step (engine.js:_applyAutomation) can convert a normalized 0..1
// source value into the destination's native value via denormalizeToRange().
export const AUTOMATION_TARGETS = [
  ...FX_BUSES.map(b => ({
    id: `send.${b.id}`, label: `→ ${b.label}`, group: 'Sends',
    min: 0, max: 1, unit: '',
  })),
  { id: 'volume',       label: 'Volume',  group: 'Track',   min: -40, max:    6, unit: 'dB' },
  { id: 'pan',          label: 'Pan',     group: 'Track',   min: -100, max:  100, unit: '' },
  { id: 'glide',        label: 'Glide',   group: 'Track',   min: 0,   max: 1000, unit: 'ms' },
  { id: 'filter.frequency', label: 'Filter Freq', group: 'Filter', min: 20,  max: 20000, unit: 'Hz', curve: 'exp' },
  { id: 'filter.Q',         label: 'Filter Q',    group: 'Filter', min: 0.1, max:    20, unit: '' },
  { id: 'adsr.attack',  label: 'Attack',  group: 'Amp Env', min: 0,   max:    2, unit: 's' },
  { id: 'adsr.decay',   label: 'Decay',   group: 'Amp Env', min: 0,   max:    2, unit: 's' },
  { id: 'adsr.sustain', label: 'Sustain', group: 'Amp Env', min: 0,   max:    1, unit: '' },
  { id: 'adsr.release', label: 'Release', group: 'Amp Env', min: 0,   max:    2, unit: 's' },
]

function _makeToneEffect(busId, defs) {
  switch (busId) {
    case 'reverb': {
      const rv = new Tone.Reverb({ decay: defs.decay, preDelay: defs.preDelay, wet: defs.wet })
      rv.generate()
      return rv
    }
    case 'jcreverb':
      return new Tone.JCReverb({ roomSize: defs.roomSize, wet: defs.wet })
    case 'delay':
      return new Tone.FeedbackDelay({
        delayTime: defs.delayTime,
        feedback:  defs.feedback,
        wet:       defs.wet,
        maxDelay:  DELAY_MAX_TIME,
      })
    case 'pingpong':
      return new Tone.PingPongDelay({
        delayTime: defs.delayTime,
        feedback:  defs.feedback,
        wet:       defs.wet,
        maxDelay:  DELAY_MAX_TIME,
      })
    case 'chorus':
      return new Tone.Chorus({
        frequency: defs.frequency,
        delayTime: defs.delayTime,
        depth:     defs.depth,
        feedback:  defs.feedback,
        spread:    defs.spread,
        wet:       defs.wet,
      }).start()
    case 'phaser':
      return new Tone.Phaser({
        frequency:     defs.frequency,
        octaves:       defs.octaves,
        baseFrequency: defs.baseFrequency,
        Q:             defs.Q,
        wet:           defs.wet,
      })
    case 'tremolo':
      return new Tone.Tremolo({
        frequency: defs.frequency,
        depth:     defs.depth,
        spread:    defs.spread,
        wet:       defs.wet,
      }).start()
    case 'vibrato':
      return new Tone.Vibrato({
        frequency: defs.frequency,
        depth:     defs.depth,
        wet:       defs.wet,
      })
    case 'autofilter':
      return new Tone.AutoFilter({
        frequency:     defs.frequency,
        baseFrequency: defs.baseFrequency,
        octaves:       defs.octaves,
        depth:         defs.depth,
        wet:           defs.wet,
      }).start()
    case 'autopanner':
      return new Tone.AutoPanner({
        frequency: defs.frequency,
        depth:     defs.depth,
        wet:       defs.wet,
      }).start()
    case 'wah':
      return new Tone.AutoFilter({
        frequency:     defs.frequency,
        baseFrequency: defs.baseFrequency,
        octaves:       defs.octaves,
        depth:         defs.depth,
        wet:           defs.wet,
      }).start()
    case 'distortion':
      return new Tone.Distortion({
        distortion: defs.distortion,
        oversample: defs.oversample,
        wet:        defs.wet,
      })
    case 'bitcrusher':
      return new Tone.BitCrusher({
        bits: defs.bits,
        wet:  defs.wet,
      })
    case 'widener':
      return new Tone.StereoWidener({
        width: defs.width,
        wet:   defs.wet,
      })
    default:
      return new Tone.JCReverb({ roomSize: 0.5, wet: defs.wet ?? 0.5 })
  }
}

// FX bus: wraps a Tone.js effect. Receives sends from instrument Gain nodes,
// routes through the effect, and connects to the master output chain.
//
// Signal flow:
//   sends → inputGain (mute handle) → effect (built-in dry/wet) → outputNode
export class FxTrack {
  constructor(busId, outputNode, overrides = {}) {
    const spec = FX_BUSES.find(b => b.id === busId)
    const defs = { ...(spec?.defaults ?? {}), ...overrides }

    this._busId          = busId
    this._outputNode     = outputNode
    this._inputGain      = new Tone.Gain(1)
    this._debounceTimers = new Map()
    this._disposed       = false

    if (busId === 'reverb') {
      this._irType         = defs.irType ?? 'synthetic'
      this._decay          = defs.decay
      this._preDelay       = defs.preDelay
      this._wetTarget      = defs.wet
      this._swapToken      = 0
      this._customIRBuffer = null

      // Always boot in synthetic mode; if a non-synthetic preset was requested,
      // kick off the async swap after the synchronous path completes.
      this._effect = new Tone.Reverb({ decay: this._decay, preDelay: this._preDelay, wet: this._wetTarget })
      this._effect.generate()
      this._inputGain.connect(this._effect)
      this._effect.connect(outputNode)

      if (this._irType !== 'synthetic') this._swapToIR(this._irType)
    } else {
      this._effect = _makeToneEffect(busId, defs)
      this._inputGain.connect(this._effect)
      this._effect.connect(outputNode)
    }

    // Tempo-sync state: when synced, the target Signal (delay time / LFO rate)
    // holds a note-division Tone notation instead of the raw ms/Hz value.
    this._syncTarget      = FX_SYNC_TARGETS[busId] ?? null
    this._syncDivision    = defs.sync ?? 'free'
    this._lastTargetValue = this._syncTarget ? defs[this._syncTarget] : null
    if (this._syncTarget && this._syncDivision !== 'free') this._applySyncTarget()
  }

  get input() { return this._inputGain }

  // Apply the current sync mode to the target Signal. Free → ramp to the last
  // numeric value; a division → set the Tone notation (converted vs Transport.bpm).
  _applySyncTarget() {
    const sig = this._syncTarget && this._effect?.[this._syncTarget]
    if (!sig) return
    if (this._syncDivision === 'free') {
      const n = this._lastTargetValue
      if (n == null) return
      if (typeof sig.rampTo === 'function') sig.rampTo(n, 0.05)
      else if ('value' in sig) sig.value = n
    } else if (this._syncTarget === 'delayTime') {
      // Convert the division to seconds and clamp to the delay node's ceiling;
      // a slow-BPM whole note can exceed it and Tone would throw a RangeError.
      const secs = Tone.Time(this._syncDivision).toSeconds()
      sig.value  = Math.min(secs, DELAY_MAX_TIME)
    } else {
      sig.value = this._syncDivision
    }
  }

  // Re-evaluate synced divisions against a new tempo (called on BPM change).
  reapplySync() {
    if (this._syncDivision !== 'free') this._applySyncTarget()
  }

  setWet(normalizedValue) {
    const v = Math.max(0, Math.min(1, normalizedValue))
    this._wetTarget = v
    if (this._effect?.wet) this._effect.wet.rampTo(v, 0.05)
  }

  setParam(paramId, value) {
    const spec = FX_PARAM_SPECS[this._busId]?.find(p => p.id === paramId)
    if (!spec) return

    if (paramId === 'sync') {
      this._syncDivision = value
      this._applySyncTarget()
      return
    }
    // While synced, remember the raw ms/Hz value for a future switch back to
    // Free, but don't apply it (the Signal holds the note division).
    if (paramId === this._syncTarget && this._syncDivision !== 'free') {
      this._lastTargetValue = value
      return
    }

    if (this._busId === 'reverb' && paramId === 'irType') {
      this._swapToIR(value)
      return
    }

    // Cache synth-only params so they survive convolver swaps
    if (this._busId === 'reverb') {
      if (paramId === 'decay')    this._decay    = value
      if (paramId === 'preDelay') this._preDelay = value
      if ((paramId === 'decay' || paramId === 'preDelay') && this._irType !== 'synthetic') return
    }

    if (spec.kind === 'signal') {
      const sig = this._effect[paramId]
      if (sig && typeof sig.rampTo === 'function') sig.rampTo(value, 0.05)
      else if (sig && 'value' in sig) sig.value = value
    } else if (spec.kind === 'enum' || spec.kind === 'number') {
      if (spec.debounceMs) {
        const existing = this._debounceTimers.get(paramId)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          try { this._effect[paramId] = value } catch {}
          this._debounceTimers.delete(paramId)
        }, spec.debounceMs)
        this._debounceTimers.set(paramId, timer)
      } else {
        try { this._effect[paramId] = value } catch {}
      }
    }
  }

  async setCustomIRBuffer(audioBuffer) {
    this._customIRBuffer = audioBuffer
    await this._swapToIR('custom')
  }

  async _swapToIR(id) {
    if (this._busId !== 'reverb') return
    const token = ++this._swapToken
    this._irType = id

    let newEffect = null
    try {
      if (id === 'synthetic') {
        newEffect = new Tone.Reverb({ decay: this._decay, preDelay: this._preDelay, wet: this._wetTarget })
        newEffect.generate()
      } else if (id === 'custom') {
        if (!this._customIRBuffer) return
        newEffect = new Tone.Convolver({ wet: this._wetTarget })
        newEffect.buffer = this._customIRBuffer
      } else {
        const preset = REVERB_IR_PRESETS.find(p => p.id === id)
        if (!preset?.url) return
        const buf = await _loadIRBufferFromUrl(preset.url)
        if (this._disposed || token !== this._swapToken) return
        newEffect = new Tone.Convolver({ wet: this._wetTarget })
        newEffect.buffer = buf
      }

      if (this._disposed || token !== this._swapToken) {
        try { newEffect?.dispose() } catch {}
        return
      }

      const old = this._effect
      try { this._inputGain.disconnect(old) } catch {}
      try { old.disconnect() } catch {}
      this._effect = newEffect
      this._inputGain.connect(newEffect)
      newEffect.connect(this._outputNode)
      try { old.dispose() } catch {}
    } catch (err) {
      console.error('FxTrack IR swap failed:', err)
      try { newEffect?.dispose() } catch {}
    }
  }

  setMute(isMuted) {
    this._inputGain.gain.rampTo(isMuted ? 0 : 1, 0.05)
  }

  dispose() {
    this._disposed = true
    for (const t of this._debounceTimers.values()) clearTimeout(t)
    this._debounceTimers.clear()
    try { this._effect?.disconnect()   } catch {}
    try { this._effect?.dispose()      } catch {}
    try { this._inputGain.disconnect() } catch {}
    try { this._inputGain.dispose()    } catch {}
  }
}
