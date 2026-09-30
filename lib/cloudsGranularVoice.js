import * as Tone from 'tone'
import { GranularVoice } from './granularVoice.js'
import { CLOUDS_DSP_RATE, cloudsParamsFromGranular } from './granularEngine.js'
import {
  CLOUDS_PROCESSOR, cloudsProcessorOptions, isCloudsReady, prepareCloudsGranular,
} from './cloudsGranularLoader.js'
import { DEFAULT_GRANULAR } from './soundSpecs.js'

// Clouds-backed granular layer (NEXT_PUBLIC_GRANULAR_ENGINE=clouds). A drop-in
// for GranularVoice: same lifecycle (setBuffer / set / setMix / trigger* /
// setNote / connect / dispose / loaded), same place in the lane
// (→ routeGain, alongside the dry instrument), same additive `mix`.
// Signal flow:
//   AudioWorkletNode (Clouds grain cloud, free-running)
//     → AmplitudeEnvelope (the lane's note gates) → mix Gain → outputNode
//
// The node and the envelope are driven off the same audio clock: a note posts a
// timestamp to the worklet (grain pitch + a seeded grain at that time) and
// schedules the envelope at the same time here.
//
// Construction is synchronous; the wasm/worklet load is not. Until it resolves
// (and a source has been delivered), `loaded` is false and the engine skips the
// layer's notes, exactly as it does while GranularVoice's buffer is pending. If
// the load fails, the voice swaps in a GranularVoice with the same settings, so
// the lane keeps a granular layer rather than going quiet.

let nextSeed = 1

// Fractional MIDI pitch (Hz-valued harmony notes keep their exact tuning).
function toMidi(note) {
  try {
    const hz = typeof note === 'number' ? note : Tone.Frequency(note).toFrequency()
    return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : NaN
  } catch { return NaN }
}

export class CloudsGranularVoice {
  constructor(opts = {}) {
    this._disposed = false
    this._opts     = { ...opts }
    this._cfg      = { ...DEFAULT_GRANULAR, ...opts }
    this._baseMidi = toMidi(opts.baseNote ?? 'C4')
    this._dests    = []
    this._node     = null
    this._fallback = null
    this._gen      = 1
    this._buffer   = null         // latest AudioBuffer handed to setBuffer
    this._sourceId = 0
    this._sourceReady = false
    this._pitch    = 0

    // Same base level as GranularVoice (-6 dB): at default settings the cloud's
    // output RMS measures ≈ 0.93× the source's, i.e. about what GrainPlayer's
    // crossfaded grains deliver, so `mix` keeps its meaning.
    this._level = new Tone.Volume(opts.volume ?? -6)
    this._env = new Tone.AmplitudeEnvelope({
      attack:  this._cfg.attack,
      decay:   0,
      sustain: 1,
      release: this._cfg.release,
    })
    this._mix = new Tone.Gain(clamp01(this._cfg.mix))
    this._level.connect(this._env)
    this._env.connect(this._mix)

    const ctx = Tone.getContext()
    if (isCloudsReady(ctx)) this._build(ctx)
    else prepareCloudsGranular(ctx).then(() => this._build(ctx), (err) => this._fallBack(err))
  }

  get loaded() {
    if (this._fallback) return this._fallback.loaded
    return !this._disposed && !!this._node && this._sourceReady
  }

  _build(ctx) {
    if (this._disposed || this._node || this._fallback) return
    try {
      this._node = ctx.createAudioWorkletNode(CLOUDS_PROCESSOR, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          ...cloudsProcessorOptions(),
          seed: nextSeed++,
          params: cloudsParamsFromGranular(this._cfg),
          pitch: this._pitch,
        },
      })
    } catch (err) {
      this._fallBack(err)
      return
    }
    this._node.port.onmessage = ({ data }) => {
      if (data?.type === 'error') this._fallBack(new Error(data.message))
      else if (data?.type === 'source' && data.cropped) console.warn('[clouds] grain source cropped to', data.len, 'samples')
      else if (data?.type === 'warning') console.warn('[clouds] scheduling warning', data.stats)
    }
    this._node.onprocessorerror = () => this._fallBack(new Error('clouds processor error'))
    Tone.connect(this._node, this._level)
    if (this._buffer) this._sendSource(this._buffer)
  }

  // Recoverable failure: hand the lane to the original GrainPlayer layer.
  _fallBack(err) {
    if (this._disposed || this._fallback) return
    console.warn('[clouds] granular engine unavailable, using GrainPlayer:', err?.message ?? err)
    this._teardownNode()
    const fb = new GranularVoice({ ...this._opts, ...this._cfg })
    for (const d of this._dests) fb.connect(d)
    if (this._buffer) fb.setBuffer(this._buffer)
    this._fallback = fb
    try { this._level.dispose(); this._env.dispose(); this._mix.dispose() } catch {}
  }

  _teardownNode() {
    const node = this._node
    this._node = null
    this._sourceReady = false
    if (!node) return
    try { node.port.postMessage({ type: 'dispose', gen: ++this._gen }) } catch {}
    // The processor fades itself out (≈5 ms) before it stops.
    setTimeout(() => {
      try { node.disconnect() } catch {}
      try { node.port.onmessage = null; node.port.close() } catch {}
    }, 40)
  }

  _post(msg, transfer) {
    if (this._disposed || !this._node) return
    try { this._node.port.postMessage(msg, transfer ?? []) } catch {}
  }

  connect(dest) {
    this._dests.push(dest)
    if (this._fallback) this._fallback.connect(dest)
    else this._mix.connect(dest)
    return this
  }

  setMix(v) {
    this._cfg.mix = v
    if (this._fallback) return this._fallback.setMix(v)
    this._mix.gain.rampTo(clamp01(v), 0.05)
  }

  _semis(note) {
    const midi = toMidi(note)
    return Number.isFinite(midi) ? Math.max(-48, Math.min(48, midi - this._baseMidi)) : this._pitch
  }

  triggerAttackRelease(note, dur, time) {
    if (this._fallback) return this._fallback.triggerAttackRelease(note, dur, time)
    if (!this.loaded) return
    const t = time ?? Tone.now()
    this._pitch = this._semis(note)
    this._post({ type: 'note', time: t, semis: this._pitch, gen: this._gen })
    this._env.triggerAttackRelease(dur, t)
  }

  triggerAttack(note, time) {
    if (this._fallback) return this._fallback.triggerAttack(note, time)
    const t = time ?? Tone.now()
    this._pitch = this._semis(note)
    this._post({ type: 'note', time: t, semis: this._pitch, gen: this._gen })
    this._env.triggerAttack(t)
  }

  triggerRelease(time) {
    if (this._fallback) return this._fallback.triggerRelease(time)
    this._env.triggerRelease(time ?? Tone.now())
  }

  // Retune while the envelope is open (drone root changes).
  setNote(note) {
    if (this._fallback) return this._fallback.setNote(note)
    this._pitch = this._semis(note)
    this._post({ type: 'pitch', semis: this._pitch })
  }

  // Flat param interface mirroring GranularVoice.set(); tolerates the full cfg.
  set(params = {}) {
    if (this._fallback) { this._fallback.set(params); return this }
    const p = params
    for (const k of Object.keys(DEFAULT_GRANULAR)) if (p[k] != null) this._cfg[k] = p[k]
    if (p.mix     != null) this.setMix(p.mix)
    if (p.attack  != null) this._env.attack  = p.attack
    if (p.release != null) this._env.release = p.release
    this._post({ type: 'params', params: cloudsParamsFromGranular(this._cfg) })
    return this
  }

  // Swap in a freshly rendered grain source. It is resampled to the DSP's 32 kHz
  // mono off the audio thread first; a newer source supersedes a pending one.
  setBuffer(audioBuffer) {
    if (this._disposed || !audioBuffer) return
    this._buffer = audioBuffer
    if (this._fallback) return this._fallback.setBuffer(audioBuffer)
    if (this._node) this._sendSource(audioBuffer)
  }

  async _sendSource(audioBuffer) {
    const id = ++this._sourceId
    let samples
    try {
      samples = await resampleToDspRate(audioBuffer)
    } catch (err) {
      console.warn('[clouds] source resample failed', err)
      return
    }
    if (id !== this._sourceId || this._disposed || !this._node) return
    this._post({ type: 'source', id, samples }, [samples.buffer])
    this._sourceReady = true
  }

  dispose() {
    if (this._disposed) return this
    if (this._fallback) this._fallback.dispose()
    this._teardownNode()
    this._disposed = true
    const level = this._level, env = this._env, mix = this._mix
    setTimeout(() => {
      try { level.dispose() } catch {}
      try { env.dispose() } catch {}
      try { mix.dispose() } catch {}
    }, 40)
    return this
  }
}

// AudioBuffer (any rate, any channel count) → Float32Array, mono, 32 kHz. Uses
// the browser's resampler via an OfflineAudioContext; falls back to a linear
// resample where that context can't run at 32 kHz.
async function resampleToDspRate(audioBuffer) {
  const frames = Math.max(1, Math.ceil(audioBuffer.duration * CLOUDS_DSP_RATE))
  const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext
  if (Offline) {
    try {
      const ctx = new Offline(1, frames, CLOUDS_DSP_RATE)
      const src = ctx.createBufferSource()
      src.buffer = audioBuffer
      src.connect(ctx.destination)
      src.start(0)
      const out = await ctx.startRendering()
      return new Float32Array(out.getChannelData(0))
    } catch {}
  }
  const chans = audioBuffer.numberOfChannels
  const data = []
  for (let c = 0; c < chans; c++) data.push(audioBuffer.getChannelData(c))
  const step = audioBuffer.sampleRate / CLOUDS_DSP_RATE
  const out = new Float32Array(frames)
  const last = audioBuffer.length - 1
  for (let i = 0; i < frames; i++) {
    const p = i * step
    const j = Math.min(Math.floor(p), last)
    const k = Math.min(j + 1, last)
    const t = p - j
    let v = 0
    for (let c = 0; c < chans; c++) v += data[c][j] + (data[c][k] - data[c][j]) * t
    out[i] = v / chans
  }
  return out
}

function clamp01(v) { return Math.max(0, Math.min(1, v)) }
