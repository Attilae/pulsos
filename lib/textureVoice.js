import * as Tone from 'tone'
import {
  TEXTURE_DEFAULTS, TEXTURE_MK2_DEFAULTS, TEXTURE_MK2_MAKEUP_DB, beadsDspParams, textureDspParams, textureModelOf,
} from './granularEngine.js'
import { CLOUDS_PROCESSOR, cloudsProcessorOptions, isCloudsReady, prepareCloudsGranular } from './cloudsGranularLoader.js'
import { BEADS_PROCESSOR, beadsProcessorOptions, isBeadsReady, prepareBeads } from './beadsLoader.js'

// Texture (NEXT_PUBLIC_GRANULAR_ENGINE=clouds): a granular processor as an insert
// on a lane. The engine splices it between the lane's instruments and its
// routeGain:
//
//   synth → laneIn → [input ─┬─ dry ──────────────────────────┬→ output] → routeGain
//                            └─ AudioWorkletNode → model gain ┘
//
// so the lane's inserts, sends, solo/disable and stems all see its output, just
// as they would the dry sound. The processor records the lane into a buffer and
// plays grains out of it, like the module; lane notes are its trigger input.
//
// Two models, chosen by the lane's `txModel` (lib/granularEngine.js):
//   classic   Clouds-derived (public/worklets/clouds-granular-processor.js); a
//             note seeds one grain at its time
//   mk2       Beads-derived (public/worklets/beads-processor.js); a note is a
//             gate on SEED for its duration, and the output is lifted by
//             TEXTURE_MK2_MAKEUP_DB
// Switching model cross-fades from the old node to the new one once the new one
// is ready; the old node keeps playing until then.
//
// Construction is synchronous; the wasm/worklet load is not. Until a model's
// node exists, the dry path carries the lane, so it's never silent. If the load
// fails it stays that way (dry lane, no grains) and the failure is logged.
//
// It shares GranularVoice's method names so the engine's note paths can call
// either; the ones that only make sense for a rendered source (setBuffer,
// setMix, triggerRelease, setNote) are no-ops here.

const FADE_SEC = 0.02
// A note that arrives without a length (legato, drone) holds Mk II's gate this
// long: about one grain's worth.
const DEFAULT_GATE_SEC = 0.25

const MODELS = {
  classic: {
    processor: CLOUDS_PROCESSOR,
    isReady: isCloudsReady,
    prepare: prepareCloudsGranular,
    options: cloudsProcessorOptions,
    params: textureDspParams,
    gain: 1,
    note: (time, _dur, gen) => ({ type: 'trig', time, gen }),
  },
  mk2: {
    processor: BEADS_PROCESSOR,
    isReady: isBeadsReady,
    prepare: prepareBeads,
    options: beadsProcessorOptions,
    params: beadsDspParams,
    gain: 10 ** (TEXTURE_MK2_MAKEUP_DB / 20),
    note: (time, dur, gen) => ({ type: 'note', time, dur, gen }),
  },
}

const KEYS = ['txModel', ...Object.keys(TEXTURE_DEFAULTS), ...Object.keys(TEXTURE_MK2_DEFAULTS)]

let nextSeed = 1

export class TextureVoice {
  constructor(cfg = {}) {
    this.isInsert = true
    this._disposed = false
    this._cfg = { ...TEXTURE_DEFAULTS, ...TEXTURE_MK2_DEFAULTS, ...cfg }
    this._gen = 1
    // Two slots, because a model switch is asynchronous:
    //   _live  the slot whose node is carrying the lane now (null → dry path)
    //   _slot  the model the lane asked for; equals _live once that model is
    //          built, or is a pending slot while its DSP loads
    // A pending slot that's superseded before it loads is dropped, and switching
    // back to the live model just drops the pending one. Every node ever built
    // is therefore either _live or already retired, so dispose() reaches it.
    this._live = null                // { model, node, gain, error }
    this._slot = null
    this._failedModel = null
    this.error = null

    this.input = new Tone.Gain(1)
    this.output = new Tone.Gain(1)
    this._dry = new Tone.Gain(1)
    this.input.connect(this._dry)
    this._dry.connect(this.output)   // pass-through until a model's DSP is ready

    this._useModel(textureModelOf(this._cfg))
  }

  get model() { return this._slot?.model ?? textureModelOf(this._cfg) }
  get loaded() { return !this._disposed && !!this._live?.node }

  _useModel(model) {
    if (this._slot?.model === model && !this._slot.error) return
    if (this._slot && this._slot !== this._live) this._drop(this._slot)
    this.error = null
    if (this._live?.model === model) {
      // Back to the model that's already playing (e.g. a reversed switch).
      this._slot = this._live
      return
    }
    const slot = { model, node: null, gain: new Tone.Gain(0), error: null }
    slot.gain.connect(this.output)
    this._slot = slot
    const ctx = Tone.getContext()
    const spec = MODELS[model]
    if (spec.isReady(ctx)) this._build(slot, ctx)
    else spec.prepare(ctx).then(() => this._build(slot, ctx), (err) => this._fail(slot, err))
  }

  // Free a slot that never got a node.
  _drop(slot) {
    slot.dropped = true
    try { slot.gain.dispose() } catch {}
  }

  _build(slot, ctx) {
    if (this._disposed || slot.dropped || slot !== this._slot || slot.node) return
    const spec = MODELS[slot.model]
    let node
    try {
      node = ctx.createAudioWorkletNode(spec.processor, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        outputChannelCount: [2],
        processorOptions: { ...spec.options(), seed: nextSeed++, params: spec.params(this._cfg) },
      })
    } catch (err) {
      this._fail(slot, err)
      return
    }
    node.port.onmessage = ({ data }) => {
      if (data?.type === 'error') this._fail(slot, new Error(data.message))
      else if (data?.type === 'warning') console.warn(`[texture ${slot.model}] scheduling warning`, data.stats)
    }
    node.onprocessorerror = () => this._fail(slot, new Error(`Texture ${slot.model} processor error`))
    Tone.connect(this.input, node)
    Tone.connect(node, slot.gain)
    slot.node = node
    // Fade the new model in, and whatever was carrying the lane (the dry path or
    // the previous model) out.
    const now = Tone.now()
    slot.gain.gain.setValueAtTime(0, now)
    slot.gain.gain.linearRampToValueAtTime(spec.gain, now + FADE_SEC)
    this._fadeOutDry(now)
    const old = this._live
    this._live = slot
    if (old && old !== slot) this._retire(old, now)
  }

  _fadeOutDry(now) {
    const g = this._dry.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.getValueAtTime(now), now)
    g.linearRampToValueAtTime(0, now + FADE_SEC)
  }

  _fadeInDry(now) {
    const g = this._dry.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.getValueAtTime(now), now)
    g.linearRampToValueAtTime(1, now + FADE_SEC)
  }

  // Fade a slot out and free it once silent.
  _retire(slot, now = Tone.now()) {
    const g = slot.gain.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.getValueAtTime(now), now)
    g.linearRampToValueAtTime(0, now + FADE_SEC)
    const node = slot.node
    slot.node = null
    setTimeout(() => {
      // Only once it's silent: a disposed processor stops outputting at once.
      try { node?.port.postMessage({ type: 'dispose' }) } catch {}
      try { this.input.disconnect(node) } catch {}
      try { node?.disconnect() } catch {}
      try { if (node) { node.port.onmessage = null; node.port.close() } } catch {}
      try { slot.gain.dispose() } catch {}
    }, FADE_SEC * 1000 + 40)
  }

  // Recoverable: the lane keeps playing dry (or, if this was a model switch that
  // never got going, through the model it had).
  _fail(slot, err) {
    if (this._disposed || slot.error || slot.dropped) return
    slot.error = err
    console.warn(`[texture ${slot.model}] unavailable, the lane plays dry:`, err?.message ?? err)
    const now = Tone.now()
    if (slot === this._live) {
      // A running node broke: back to dry. A pending switch still proceeds.
      this._retire(slot, now)
      this._live = null
      if (slot === this._slot) this.error = err
      this._fadeInDry(now)
      return
    }
    if (slot !== this._slot) return
    this.error = err
    if (this._live) {
      // The switch failed before it happened: stay on the old model, and don't
      // retry on every knob turn (retry() does, on request).
      this._drop(slot)
      this._slot = this._live
      this._failedModel = slot.model
      return
    }
    this._fadeInDry(now)
  }

  // Messages go to the node that's playing, in its own model's vocabulary.
  _post(msg) {
    const node = this._live?.node
    if (this._disposed || !node) return
    try { node.port.postMessage(msg) } catch {}
  }

  connect(dest) {
    this.output.connect(dest)
    return this
  }

  // Accepts the lane's full granular cfg (or any subset); only txModel, tx* and
  // tx2* keys matter. A change to the other model's keys is kept for later.
  set(params = {}) {
    let changed = false
    for (const k of KEYS) {
      if (params[k] != null && params[k] !== this._cfg[k]) { this._cfg[k] = params[k]; changed = true }
    }
    if (!changed) return this
    const model = textureModelOf(this._cfg)
    if (model !== this._slot?.model && model !== this._failedModel) this._useModel(model)
    else if (this._live) this._post({ type: 'params', params: MODELS[this._live.model].params(this._cfg) })
    return this
  }

  // Try the lane's model again after a failed load.
  retry() {
    this._failedModel = null
    this._useModel(textureModelOf(this._cfg))
  }

  // TRIG / SEED. `dur` is a Tone time; Mk II holds its gate that long.
  triggerAttackRelease(_note, dur, time) {
    let sec = DEFAULT_GATE_SEC
    try { sec = Tone.Time(dur).toSeconds() } catch {}
    this._note(time, Number.isFinite(sec) && sec > 0 ? sec : DEFAULT_GATE_SEC)
  }
  triggerAttack(_note, time) { this._note(time, DEFAULT_GATE_SEC) }

  _note(time, dur) {
    const model = this._live?.model
    if (!model) return
    this._post(MODELS[model].note(time ?? Tone.now(), dur, this._gen))
  }

  // Drop queued notes (stop, rebuild). Grains already sounding ring out.
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
    this._disposed = true
    const slots = [...new Set([this._live, this._slot])].filter(Boolean)
    const input = this.input, output = this.output, dry = this._dry
    this._live = this._slot = null
    for (const slot of slots) {
      try { slot.node?.port.postMessage({ type: 'dispose' }) } catch {}
    }
    setTimeout(() => {
      for (const slot of slots) {
        const node = slot.node
        try { node?.disconnect() } catch {}
        try { if (node) { node.port.onmessage = null; node.port.close() } } catch {}
        try { slot.gain.dispose() } catch {}
      }
      try { dry.dispose() } catch {}
      try { input.dispose() } catch {}
      try { output.dispose() } catch {}
    }, 40)
    return this
  }
}
