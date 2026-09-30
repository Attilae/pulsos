// Main-thread half of the Resonator lane instrument: a Tone-compatible voice
// that the engine drives like any other synth (connect / set / trigger* /
// dispose), backed by one AudioWorkletNode running the Rings-derived DSP
// (public/worklets/resonator-processor.js).
//
// Construction is synchronous but requires prepareResonator() (lib/resonatorLoader.js)
// to have resolved for the context — the engine checks that before building
// lanes, so a missing asset is reported instead of producing a silent lane.
//
// Behaviour differences from Tone synths, all deliberate:
//   - with the envelope off (the default) every note is a strike that decays
//     naturally; `duration` and note-offs don't shorten it;
//   - with it on, each voice runs its own ADSR inside the DSP: a note is held
//     for its `duration` (sent as `hold`) or until triggerRelease, and the
//     envelope also drives the noise "bow" that can sustain the resonator;
//   - there's no portamento or frequency signal to automate;
//   - notes are sent as audio-context timestamps, never Transport positions, so
//     they line up with every other lane's scheduled events.

import * as Tone from 'tone'
import {
  RESONATOR_PROCESSOR, ResonatorUnavailableError, isResonatorReady, resonatorProcessorOptions,
} from './resonatorLoader.js'
import { normalizeResonatorParams, resonatorModelIndex, resonatorPatch, resonatorEnvelopePatch } from './resonatorSpecs.js'

// Rings' limited output peaks near 0.8 with an RMS around 0.15, noticeably
// quieter than an oscillator synth at the same `volume`. This lines its level up
// with the other lane instruments at the engine's default -18 dB.
const MAKEUP_DB = 10

let nextSeed = 1

// Fractional MIDI pitch. Not Tone.Frequency().toMidi(), which rounds: Hz-valued
// notes (harmony transpositions) must keep their exact tuning.
function toMidi(note) {
  try {
    const hz = typeof note === 'number' ? note : Tone.Frequency(note).toFrequency()
    return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : NaN
  } catch { return NaN }
}

export class ResonatorVoice {
  constructor(params = {}, { volume = -18, context } = {}) {
    const ctx = context ?? Tone.getContext()
    if (!isResonatorReady(ctx)) {
      throw new ResonatorUnavailableError('The Resonator instrument is still loading.')
    }
    this.name = 'ResonatorVoice'
    this.params = normalizeResonatorParams(params)
    this._gen = 1
    this._disposed = false
    this.ready = false
    this.error = null
    this.onError = null

    this.output = new Tone.Volume(volume + MAKEUP_DB)
    this.volume = this.output.volume

    const n = this.params
    this._node = ctx.createAudioWorkletNode(RESONATOR_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        ...resonatorProcessorOptions(),
        seed: nextSeed++,
        voices: n.resonatorVoices,
        model: resonatorModelIndex(n.resonatorModel),
        patch: resonatorPatch(n),
        envelope: resonatorEnvelopePatch(n),
      },
    })
    this._node.port.onmessage = ({ data }) => this._onMessage(data)
    this._node.onprocessorerror = () => this._fail(new ResonatorUnavailableError('The Resonator instrument stopped unexpectedly.'))
    Tone.connect(this._node, this.output)
  }

  // Tone synths expose `loaded` for sample-backed voices; the engine only gates
  // Sampler/Drums on it, but keep it truthful for anyone who asks.
  get loaded() { return !this._disposed && !this.error }

  _onMessage(data) {
    if (!data) return
    if (data.type === 'ready') this.ready = true
    else if (data.type === 'error') this._fail(new ResonatorUnavailableError('The Resonator instrument could not start.', new Error(data.message)))
    else if (data.type === 'warning') console.warn('[resonator] scheduling warning', data.stats)
  }

  _fail(err) {
    if (this.error) return
    this.error = err
    console.warn('[resonator]', err.message, err.cause ?? '')
    this.onError?.(err)
  }

  _post(msg) {
    if (this._disposed) return
    try { this._node.port.postMessage(msg) } catch {}
  }

  connect(destination, ...rest) {
    this.output.connect(destination, ...rest)
    return this
  }

  disconnect(...args) {
    this.output.disconnect(...args)
    return this
  }

  toDestination() {
    this.output.toDestination()
    return this
  }

  // Accepts the lane's flat param map (any subset). Model and voice-count
  // changes are applied by the DSP with a declick; patch values are smoothed.
  set(params = {}) {
    const next = normalizeResonatorParams({ ...this.params, ...params })
    const prev = this.params
    this.params = next
    if (next.resonatorModel !== prev.resonatorModel) {
      this._post({ type: 'model', model: resonatorModelIndex(next.resonatorModel) })
    }
    if (next.resonatorVoices !== prev.resonatorVoices) {
      this._post({ type: 'voices', voices: next.resonatorVoices })
    }
    const a = resonatorPatch(prev), b = resonatorPatch(next)
    if (a.structure !== b.structure || a.brightness !== b.brightness || a.damping !== b.damping || a.position !== b.position) {
      this._post({ type: 'patch', ...b })
    }
    const ea = resonatorEnvelopePatch(prev), eb = resonatorEnvelopePatch(next)
    if (Object.keys(eb).some(k => ea[k] !== eb[k])) this._post({ type: 'envelope', ...eb })
    return this
  }

  get enveloped() { return this.params.resonatorEnvelope === true }

  get() { return { ...this.params } }

  // `note` may be a note name, Hz, or an array (a merged chord lane). All notes
  // of one call share a timestamp and reach the DSP in order. With the envelope
  // on, an attack alone holds until triggerRelease.
  triggerAttack(note, time, velocity = 1) {
    return this._attack(note, time, velocity, undefined)
  }

  // With the envelope on, the note releases after `duration`; off, it rings out.
  triggerAttackRelease(note, duration, time, velocity = 1) {
    let hold
    if (this.enveloped) {
      try { hold = Tone.Time(duration).toSeconds() } catch { hold = undefined }
      if (!(hold >= 0)) hold = undefined
    }
    return this._attack(note, time, velocity, hold)
  }

  _attack(note, time, velocity, hold) {
    if (this._disposed || this.error) return this
    const t = time ?? Tone.now()
    const v = Math.max(0, Math.min(1, Number.isFinite(velocity) ? velocity : 1))
    const list = Array.isArray(note) ? note : [note]
    const notes = []
    for (const n of list) {
      const midi = toMidi(n)
      if (!Number.isFinite(midi)) continue
      const msg = { time: t, midi, velocity: v, gen: this._gen }
      if (hold !== undefined) msg.hold = hold
      notes.push(msg)
    }
    if (notes.length === 1) this._post({ type: 'note', ...notes[0] })
    else if (notes.length) this._post({ type: 'notes', notes })
    return this
  }

  // Both Tone call shapes: the engine's monophonic triggerRelease(time), which
  // releases every held note, and PolySynth's triggerRelease(notes, time). Sent
  // even with the envelope off: the DSP ignores it for voices struck without
  // one (their tails ring on), but a note held before the envelope was switched
  // off still has to end.
  triggerRelease(...args) {
    if (this._disposed || this.error) return this
    if (args.length <= 1) return this.releaseAll(args[0])
    const [note, time] = args
    const t = time ?? Tone.now()
    for (const n of Array.isArray(note) ? note : [note]) {
      const midi = toMidi(n)
      if (Number.isFinite(midi)) this._post({ type: 'release', time: t, midi, gen: this._gen })
    }
    return this
  }

  releaseAll(time) {
    if (this._disposed || this.error) return this
    this._post({ type: 'release', time: time ?? Tone.now(), midi: null, gen: this._gen })
    return this
  }

  // Drop every queued note (stop, seek, rebuild). Already-sounding tails ring on.
  cancelScheduled() {
    this._gen += 1
    this._post({ type: 'cancel', gen: this._gen })
    return this
  }

  // Cancel queued notes and fade every voice out.
  panic() {
    this._gen += 1
    this._post({ type: 'panic', gen: this._gen })
    return this
  }

  dispose() {
    if (this._disposed) return this
    this._gen += 1
    this._post({ type: 'dispose', gen: this._gen })
    this._disposed = true
    const node = this._node
    const output = this.output
    // The processor fades itself out (≈5 ms) before it stops; keep the graph
    // connected just long enough for that, then release everything.
    setTimeout(() => {
      try { node.disconnect() } catch {}
      try { node.port.onmessage = null; node.port.close() } catch {}
      try { output.dispose() } catch {}
    }, 40)
    return this
  }
}
