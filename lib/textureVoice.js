import * as Tone from 'tone'
import { TEXTURE_DEFAULTS, textureDspParams } from './granularEngine.js'
import { CLOUDS_PROCESSOR, cloudsProcessorOptions, isCloudsReady, prepareCloudsGranular } from './cloudsGranularLoader.js'

// Texture (NEXT_PUBLIC_GRANULAR_ENGINE=clouds): the Clouds-derived granular
// processor as an insert on a lane. The engine splices it between the lane's
// instruments and its routeGain:
//
//   synth → laneIn → [input → AudioWorkletNode (dry + grains) → output] → routeGain
//
// so the lane's inserts, sends, solo/disable and stems all see its output, just
// as they would the dry sound. The processor records the lane into a one-second
// buffer and plays grains out of it, like the module; lane notes are its TRIG
// input (a grain seeded at each note's time).
//
// Construction is synchronous; the wasm/worklet load is not. Until it resolves,
// input is wired straight to output, so the lane is never silent. If the load
// fails it stays that way (dry lane, no grains) and the failure is logged.
//
// It shares GranularVoice's method names so the engine's note paths can call
// either; the ones that only make sense for a rendered source (setBuffer,
// setMix, triggerRelease, setNote) are no-ops here.

let nextSeed = 1

export class TextureVoice {
  constructor(cfg = {}) {
    this.isInsert = true
    this._disposed = false
    this._cfg = { ...TEXTURE_DEFAULTS, ...cfg }
    this._gen = 1
    this._node = null
    this.error = null

    this.input = new Tone.Gain(1)
    this.output = new Tone.Gain(1)
    this.input.connect(this.output)        // pass-through until the DSP is ready

    const ctx = Tone.getContext()
    if (isCloudsReady(ctx)) this._build(ctx)
    else prepareCloudsGranular(ctx).then(() => this._build(ctx), (err) => this._fail(err))
  }

  get loaded() { return !this._disposed && !!this._node }

  _build(ctx) {
    if (this._disposed || this._node) return
    let node
    try {
      node = ctx.createAudioWorkletNode(CLOUDS_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        outputChannelCount: [2],
        processorOptions: { ...cloudsProcessorOptions(), seed: nextSeed++, params: textureDspParams(this._cfg) },
      })
    } catch (err) {
      this._fail(err)
      return
    }
    node.port.onmessage = ({ data }) => {
      if (data?.type === 'error') this._fail(new Error(data.message))
      else if (data?.type === 'warning') console.warn('[texture] scheduling warning', data.stats)
    }
    node.onprocessorerror = () => this._fail(new Error('Texture processor error'))
    // Swap the pass-through for the processor in one step.
    Tone.connect(this.input, node)
    Tone.connect(node, this.output)
    this.input.disconnect(this.output)
    this._node = node
  }

  // Recoverable: the lane keeps playing dry.
  _fail(err) {
    if (this._disposed || this.error) return
    this.error = err
    console.warn('[texture] unavailable, the lane plays dry:', err?.message ?? err)
    const node = this._node
    this._node = null
    if (node) {
      try { this.input.disconnect(node) } catch {}
      try { node.disconnect() } catch {}
    }
    this.input.connect(this.output)
  }

  _post(msg) {
    if (this._disposed || !this._node) return
    try { this._node.port.postMessage(msg) } catch {}
  }

  connect(dest) {
    this.output.connect(dest)
    return this
  }

  // Accepts the lane's full granular cfg (or any subset); only tx* keys matter.
  set(params = {}) {
    let changed = false
    for (const k of Object.keys(TEXTURE_DEFAULTS)) {
      if (params[k] != null && params[k] !== this._cfg[k]) { this._cfg[k] = params[k]; changed = true }
    }
    if (changed) this._post({ type: 'params', params: textureDspParams(this._cfg) })
    return this
  }

  // TRIG: seed a grain at the note's time.
  triggerAttackRelease(_note, _dur, time) { this.triggerAttack(_note, time) }
  triggerAttack(_note, time) {
    this._post({ type: 'trig', time: time ?? Tone.now(), gen: this._gen })
  }

  // Drop queued triggers (stop, rebuild). Grains already sounding ring out.
  cancelScheduled() {
    this._gen += 1
    this._post({ type: 'cancel', gen: this._gen })
  }

  triggerRelease() {}
  setNote() {}
  setMix() {}
  setBuffer() {}

  dispose() {
    if (this._disposed) return this
    this._post({ type: 'dispose' })
    this._disposed = true
    const node = this._node, input = this.input, output = this.output
    this._node = null
    setTimeout(() => {
      try { node?.disconnect() } catch {}
      try { if (node) { node.port.onmessage = null; node.port.close() } } catch {}
      try { input.dispose() } catch {}
      try { output.dispose() } catch {}
    }, 40)
    return this
  }
}
