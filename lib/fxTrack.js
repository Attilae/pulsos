import * as Tone from 'tone'

// Reverb IR presets. `synthetic` uses Tone.Reverb (noise-generated IR).
// All other presets convolve against a real recorded IR loaded from /irs/.
// Real IRs are CC BY 4.0, from openairlib.net — see public/irs/ATTRIBUTION.md.
// `custom` is a runtime-loaded user file (no URL; buffer set via setCustomIRBuffer).
export const REVERB_IR_PRESETS = [
  { id: 'synthetic', label: 'Synthetic',      url: null },
  { id: 'tunnel',    label: 'Railway Tunnel', url: '/irs/tunnel.wav' },
  { id: 'cave',      label: 'Cave',           url: '/irs/cave.wav' },
  { id: 'stairwell', label: 'Stairwell',      url: '/irs/stairwell.wav' },
  { id: 'cathedral', label: 'Cathedral',      url: '/irs/cathedral.wav' },
  { id: 'hall',      label: 'Concert Hall',   url: '/irs/hall.wav' },
  { id: 'warehouse', label: 'Warehouse',      url: '/irs/warehouse.wav' },
  { id: 'custom',    label: 'Custom…',        url: null },
]

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

export const FX_BUSES = [
  { id: 'reverb',     label: 'Reverb',         defaults: { wet: 1.0, decay: 2.5, preDelay: 0.01, irType: 'synthetic' } },
  { id: 'jcreverb',   label: 'Spring Reverb',  defaults: { wet: 1.0, roomSize: 0.3  } },
  { id: 'delay',      label: 'Delay',          defaults: { wet: 1.0, delayTime: 0.25, feedback: 0.4 } },
  { id: 'pingpong',   label: 'Ping-Pong',      defaults: { wet: 1.0, delayTime: 0.2,  feedback: 0.3 } },
  { id: 'chorus',     label: 'Chorus',         defaults: { wet: 1.0, frequency: 4, delayTime: 4.5, depth: 0.5, feedback: 0.4, spread: 180 } },
  { id: 'phaser',     label: 'Phaser',         defaults: { wet: 1.0, frequency: 0.5, octaves: 3, baseFrequency: 700, Q: 10 } },
  { id: 'tremolo',    label: 'Tremolo',        defaults: { wet: 1.0, frequency: 4, depth: 0.5, spread: 180 } },
  { id: 'vibrato',    label: 'Vibrato',        defaults: { wet: 1.0, frequency: 5, depth: 0.1 } },
  { id: 'autofilter', label: 'Auto Filter',    defaults: { wet: 1.0, frequency: 2, baseFrequency: 800, octaves: 2, depth: 1 } },
  { id: 'autopanner', label: 'Auto Panner',    defaults: { wet: 1.0, frequency: 1, depth: 1 } },
  { id: 'wah',        label: 'Auto Wah',       defaults: { wet: 1.0, frequency: 2, baseFrequency: 1000, octaves: 4, depth: 1 } },
  { id: 'distortion', label: 'Distortion',     defaults: { wet: 1.0, distortion: 0.4, oversample: '4x' } },
  { id: 'bitcrusher', label: 'Bit Crusher',    defaults: { wet: 1.0, bits: 8 } },
  { id: 'widener',    label: 'Stereo Widener', defaults: { wet: 1.0, width: 0.7 } },
]

// Parameter specs per bus (excluding `wet` — that has its own dedicated slider).
//
// Each entry shape:
//   { id, label, kind, min?, max?, step?, displayScale?, unit?, values? }
//
// kind:
//   'signal' — Tone Signal/Param; set via .rampTo(value, 0.05)
//   'number' — plain JS getter/setter on the effect node
//   'enum'   — string property; `values` lists allowed strings
//
// displayScale: multiplier from raw value to UI value (e.g. seconds → ms => 1000).
// unit: short string shown next to the value in the UI.
export const FX_PARAM_SPECS = {
  reverb: [
    { id: 'irType',   label: 'IR',    kind: 'enum',
      values:      REVERB_IR_PRESETS.map(p => p.id),
      valueLabels: Object.fromEntries(REVERB_IR_PRESETS.map(p => [p.id, p.label])) },
    { id: 'decay',    label: 'Decay', kind: 'number', min: 0.1, max: 10,   step: 0.1,   unit: 's',  debounceMs: 200 },
    { id: 'preDelay', label: 'Pre',   kind: 'number', min: 0,   max: 0.2,  step: 0.001, displayScale: 1000, unit: 'ms', debounceMs: 200 },
  ],
  jcreverb: [
    { id: 'roomSize', label: 'Room',  kind: 'signal', min: 0, max: 1,   step: 0.01 },
  ],
  delay: [
    { id: 'delayTime', label: 'Time', kind: 'signal', min: 0.01, max: 1.5,  step: 0.001, displayScale: 1000, unit: 'ms' },
    { id: 'feedback',  label: 'FB',   kind: 'signal', min: 0,    max: 0.95, step: 0.01 },
  ],
  pingpong: [
    { id: 'delayTime', label: 'Time', kind: 'signal', min: 0.01, max: 1.5,  step: 0.001, displayScale: 1000, unit: 'ms' },
    { id: 'feedback',  label: 'FB',   kind: 'signal', min: 0,    max: 0.95, step: 0.01 },
  ],
  chorus: [
    { id: 'frequency', label: 'Rate',   kind: 'signal', min: 0.1, max: 20,   step: 0.1,  unit: 'Hz' },
    { id: 'delayTime', label: 'Time',   kind: 'number', min: 1,   max: 20,   step: 0.1,  unit: 'ms' },
    { id: 'depth',     label: 'Depth',  kind: 'number', min: 0,   max: 1,    step: 0.01 },
    { id: 'feedback',  label: 'FB',     kind: 'signal', min: 0,   max: 0.95, step: 0.01 },
    { id: 'spread',    label: 'Spread', kind: 'number', min: 0,   max: 180,  step: 1,    unit: '°' },
  ],
  phaser: [
    { id: 'frequency',     label: 'Rate', kind: 'signal', min: 0.05, max: 10,   step: 0.05, unit: 'Hz' },
    { id: 'octaves',       label: 'Oct',  kind: 'number', min: 0,    max: 8,    step: 1 },
    { id: 'baseFrequency', label: 'Base', kind: 'number', min: 50,   max: 5000, step: 10,   unit: 'Hz' },
    { id: 'Q',             label: 'Q',    kind: 'signal', min: 0.1,  max: 20,   step: 0.1 },
  ],
  tremolo: [
    { id: 'frequency', label: 'Rate',   kind: 'signal', min: 0.1, max: 20,  step: 0.1, unit: 'Hz' },
    { id: 'depth',     label: 'Depth',  kind: 'signal', min: 0,   max: 1,   step: 0.01 },
    { id: 'spread',    label: 'Spread', kind: 'number', min: 0,   max: 180, step: 1,   unit: '°' },
  ],
  vibrato: [
    { id: 'frequency', label: 'Rate',  kind: 'signal', min: 0.1, max: 20, step: 0.1, unit: 'Hz' },
    { id: 'depth',     label: 'Depth', kind: 'signal', min: 0,   max: 1,  step: 0.01 },
  ],
  autofilter: [
    { id: 'frequency',     label: 'Rate',  kind: 'signal', min: 0.1, max: 20,   step: 0.1,  unit: 'Hz' },
    { id: 'baseFrequency', label: 'Base',  kind: 'number', min: 50,  max: 5000, step: 10,   unit: 'Hz' },
    { id: 'octaves',       label: 'Oct',   kind: 'number', min: 0,   max: 8,    step: 1 },
    { id: 'depth',         label: 'Depth', kind: 'signal', min: 0,   max: 1,    step: 0.01 },
  ],
  autopanner: [
    { id: 'frequency', label: 'Rate',  kind: 'signal', min: 0.05, max: 20, step: 0.05, unit: 'Hz' },
    { id: 'depth',     label: 'Depth', kind: 'signal', min: 0,    max: 1,  step: 0.01 },
  ],
  wah: [
    { id: 'frequency',     label: 'Rate',  kind: 'signal', min: 0.1, max: 20,   step: 0.1,  unit: 'Hz' },
    { id: 'baseFrequency', label: 'Base',  kind: 'number', min: 50,  max: 5000, step: 10,   unit: 'Hz' },
    { id: 'octaves',       label: 'Oct',   kind: 'number', min: 0,   max: 8,    step: 1 },
    { id: 'depth',         label: 'Depth', kind: 'signal', min: 0,   max: 1,    step: 0.01 },
  ],
  distortion: [
    { id: 'distortion', label: 'Drive', kind: 'number', min: 0, max: 1, step: 0.01 },
    { id: 'oversample', label: 'OS',    kind: 'enum',   values: ['none', '2x', '4x'] },
  ],
  bitcrusher: [
    { id: 'bits', label: 'Bits', kind: 'signal', min: 1, max: 16, step: 1 },
  ],
  widener: [
    { id: 'width', label: 'Width', kind: 'signal', min: 0, max: 1, step: 0.01 },
  ],
}

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
      })
    case 'pingpong':
      return new Tone.PingPongDelay({
        delayTime: defs.delayTime,
        feedback:  defs.feedback,
        wet:       defs.wet,
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
  }

  get input() { return this._inputGain }

  setWet(normalizedValue) {
    const v = Math.max(0, Math.min(1, normalizedValue))
    this._wetTarget = v
    if (this._effect?.wet) this._effect.wet.rampTo(v, 0.05)
  }

  setParam(paramId, value) {
    const spec = FX_PARAM_SPECS[this._busId]?.find(p => p.id === paramId)
    if (!spec) return

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
