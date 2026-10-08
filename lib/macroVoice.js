// Main-thread half of the Macro lane instrument: a Tone-compatible voice that the
// engine drives like any other synth (connect / set / trigger* / dispose), backed
// by one AudioWorkletNode running the Plaits-derived DSP
// (public/worklets/macro-processor.js).
//
// Construction is synchronous but requires prepareMacro() (lib/macroLoader.js) to
// have resolved for the context — the engine checks that before building lanes,
// so a missing asset is reported instead of producing a silent lane.
//
// Behaviour differences from Tone synths, all deliberate:
//   - a note is the module's TRIG held high for the note's `duration` (or until
//     triggerRelease); the low-pass gate and decay envelope shape it, there is
//     no ADSR. Self-enveloped engines (drums, string, modal, 6-op FM) may ring
//     past the note, and only the 6-op FM engines sustain while it is held;
//   - there's no portamento or frequency signal to automate;
//   - notes are sent as audio-context timestamps, never Transport positions, so
//     they line up with every other lane's scheduled events.

import * as Tone from 'tone'
import {
  MACRO_PROCESSOR, MacroUnavailableError, isMacroReady, macroProcessorOptions,
} from './macroLoader.js'
import { normalizeMacroParams, macroEngineIndex, macroPatch } from './macroSpecs.js'

// Lines a Macro lane up with the other instruments at the engine's default
// -18 dB. Measured (Phase 6, docs/plaits-macro-plan.md): per-note RMS of every
// engine at its default patch against a default Synth lane, 4n notes. The
// median engine needs +4.9 dB; the middle half +2.9..+10.3. Engines differ by
// design (sustained 6-op FM and chiptune run loud, plucked strings quiet), as
// they do on the module, so this is one gain, not a per-engine table.
const MAKEUP_DB = 5

let nextSeed = 1

// Fractional MIDI pitch. Not Tone.Frequency().toMidi(), which rounds: Hz-valued
// notes (harmony transpositions) must keep their exact tuning.
function toMidi(note) {
  try {
    const hz = typeof note === 'number' ? note : Tone.Frequency(note).toFrequency()
    return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : NaN
  } catch { return NaN }
}

const samePatch = (a, b) => Object.keys(b).every(k => a[k] === b[k])

export class MacroVoice {
  constructor(params = {}, { volume = -18, context } = {}) {
    const ctx = context ?? Tone.getContext()
    if (!isMacroReady(ctx)) {
      throw new MacroUnavailableError('The Macro instrument is still loading.')
    }
    this.name = 'MacroVoice'
    this.params = normalizeMacroParams(params)
    this._gen = 1
    this._disposed = false
    this.ready = false
    this.error = null
    this.onError = null

    this.output = new Tone.Volume(volume + MAKEUP_DB)
    this.volume = this.output.volume

    const n = this.params
    this._node = ctx.createAudioWorkletNode(MACRO_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        ...macroProcessorOptions(),
        seed: nextSeed++,
        voices: n.macroVoices,
        engine: macroEngineIndex(n.macroEngine),
        patch: macroPatch(n),
        aux: n.macroAux,
      },
    })
    this._node.port.onmessage = ({ data }) => this._onMessage(data)
    this._node.onprocessorerror = () => this._fail(new MacroUnavailableError('The Macro instrument stopped unexpectedly.'))
    Tone.connect(this._node, this.output)
  }

  // Tone synths expose `loaded` for sample-backed voices; the engine only gates
  // Sampler/Drums on it, but keep it truthful for anyone who asks.
  get loaded() { return !this._disposed && !this.error }

  _onMessage(data) {
    if (!data) return
    if (data.type === 'ready') this.ready = true
    else if (data.type === 'error') this._fail(new MacroUnavailableError('The Macro instrument could not start.', new Error(data.message)))
    else if (data.type === 'warning') console.warn('[macro] scheduling warning', data.stats)
  }

  _fail(err) {
    if (this.error) return
    this.error = err
    console.warn('[macro]', err.message, err.cause ?? '')
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

  // Accepts the lane's flat param map (any subset). Engine changes are applied
  // by the DSP with a declick; patch values are smoothed per block.
  set(params = {}) {
    const next = normalizeMacroParams({ ...this.params, ...params })
    const prev = this.params
    this.params = next
    if (next.macroEngine !== prev.macroEngine) {
      this._post({ type: 'engine', engine: macroEngineIndex(next.macroEngine) })
    }
    if (next.macroVoices !== prev.macroVoices) this._post({ type: 'voices', voices: next.macroVoices })
    if (next.macroAux !== prev.macroAux) this._post({ type: 'aux', aux: next.macroAux })
    const a = macroPatch(prev), b = macroPatch(next)
    if (!samePatch(a, b)) this._post({ type: 'patch', ...b })
    return this
  }

  get() { return { ...this.params } }

  // `note` may be a note name, Hz, or an array (a merged chord lane). All notes
  // of one call share a timestamp and reach the DSP in order. An attack alone
  // holds the trigger until triggerRelease.
  triggerAttack(note, time, velocity = 1) {
    return this._attack(note, time, velocity, undefined)
  }

  // The trigger is held for `duration`, like a gate from a sequencer.
  triggerAttackRelease(note, duration, time, velocity = 1) {
    let hold
    try { hold = Tone.Time(duration).toSeconds() } catch { hold = undefined }
    if (!(hold >= 0)) hold = undefined
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
  // releases every held note, and PolySynth's triggerRelease(notes, time).
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

  // Drop every queued note (stop, seek, rebuild). Already-sounding notes ring on.
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
