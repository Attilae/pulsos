import * as Tone from 'tone'
import { SHAPER_SPAN, saturationCurve, clipperCurve } from './masterCurves.js'

// The shared master bus: one mastering chain every TransitEngine feeds, ahead of
// Tone's Destination.
//
//   engine A master gain ─┐
//   engine B master gain ─┴→ input ─→ [mastering chain] ─→ Destination (fader) → speakers
//
// Why here and not per engine: the Song Chainer runs two engines at once across an
// item boundary. With a limiter inside each engine the two limited signals were
// summed afterwards and could clip together during a crossfade; one bus limits the sum.
//
// Why ahead of Destination and not `Destination.chain()`: the master fader is
// `Destination.volume`, which is Destination's *input*. Chaining through it would
// put the fader in front of the compressor, so moving the fader (or a fade-out)
// would change how hard the chain works. Feeding Destination from here keeps the
// fader a pure playback level after mastering. WAV export taps Destination's output,
// so exports are mastered too.
//
// Two modes, switchable at runtime for level-matched A/B listening:
//   'master' — the chain below
//   'legacy' — the compressor + limiter the engine used before this bus existed
// Only the active path stays connected to the input, so the idle one sits silent.
//
// Console: `leidMaster.set('legacy')`, `leidMaster.set('master')`, `leidMaster.status()`.

export const MASTER_BUS_MODES = ['master', 'legacy']
const DEFAULT_MODE = 'master'
const STORAGE_KEY = 'leid-master-bus'
const SWITCH_SEC = 0.05

// Gentle "invisible" settings. The aim is 1–2 dB of glue, a little density and a
// safe ceiling — not loudness. DynamicsCompressorNode adds make-up gain on its own
// (the spec's (1/fullRangeGain)^0.6), which the output trim compensates.
export const MASTER_SETTINGS = {
  headroomDb: -3,                                    // pad the summed lanes before dynamics
  highpass:  { frequency: 25, Q: 0.707 },            // subsonic cleanup
  mudCut:    { frequency: 300, Q: 0.8, gain: -1 },   // stacked pads/bus lanes pile up here
  air:       { frequency: 10000, gain: 1 },          // high shelf
  glue:      { threshold: -24, ratio: 2, knee: 10, attack: 0.025, release: 0.2 },
  saturation: { drive: 2, mix: 0.25 },              // tanh, blended inside one curve
  outputTrimDb: -1,
  limiter:   { threshold: -3, ratio: 20, knee: 0, attack: 0.002, release: 0.1 },
  clipper:   { knee: 0.85, ceiling: 0.97 },          // linear below ~-1.4 dBFS
}

function shaper(curve, oversample) {
  const pre = new Tone.Gain(1 / SHAPER_SPAN)
  const ws = new Tone.WaveShaper(curve)
  ws.oversample = oversample
  pre.connect(ws)
  return { input: pre, output: ws, nodes: [pre, ws] }
}

function buildMasterPath(s = MASTER_SETTINGS) {
  const pad = new Tone.Gain(Tone.dbToGain(s.headroomDb))
  const hpf = new Tone.BiquadFilter({ type: 'highpass', ...s.highpass })
  const mud = new Tone.BiquadFilter({ type: 'peaking', ...s.mudCut })
  const air = new Tone.BiquadFilter({ type: 'highshelf', ...s.air })
  const glue = new Tone.Compressor(s.glue)
  const sat = shaper(saturationCurve(s.saturation), '2x')
  const trim = new Tone.Gain(Tone.dbToGain(s.outputTrimDb))
  const limiter = new Tone.Compressor(s.limiter)
  const clip = shaper(clipperCurve(s.clipper), 'none')

  pad.chain(hpf, mud, air, glue, sat.input)
  sat.output.chain(trim, limiter, clip.input)
  return {
    input: pad,
    output: clip.output,
    glue,
    limiter,
    nodes: [pad, hpf, mud, air, glue, ...sat.nodes, trim, limiter, ...clip.nodes],
  }
}

// Exactly what AlertLayer ran before the bus: Tone.Compressor(-18, 4:1) → Limiter(-1).
function buildLegacyPath() {
  const compressor = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.05, release: 0.3 })
  const limiter = new Tone.Limiter(-1)
  compressor.connect(limiter)
  return { input: compressor, output: limiter, glue: compressor, limiter, nodes: [compressor, limiter] }
}

function readStoredMode() {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY)
    return MASTER_BUS_MODES.includes(v) ? v : DEFAULT_MODE
  } catch { return DEFAULT_MODE }
}

class MasterBus {
  constructor() {
    this.input = new Tone.Gain(1)
    this._paths = { master: buildMasterPath(), legacy: buildLegacyPath() }
    this._gates = {}
    for (const [mode, path] of Object.entries(this._paths)) {
      const gate = new Tone.Gain(0)
      path.output.connect(gate)
      gate.toDestination()
      this._gates[mode] = gate
    }
    this._mode = null
    this._switchTimer = null
    this.setMode(readStoredMode(), { instant: true })
  }

  get mode() { return this._mode }

  setMode(mode, { instant = false } = {}) {
    if (!MASTER_BUS_MODES.includes(mode) || mode === this._mode) return this._mode
    const prev = this._mode
    this._mode = mode
    if (this._switchTimer) { clearTimeout(this._switchTimer); this._switchTimer = null }

    // Connect the incoming path before fading so both overlap for SWITCH_SEC.
    try { this.input.connect(this._paths[mode].input) } catch {}
    const gate = this._gates[mode].gain
    if (instant) gate.value = 1
    else gate.rampTo(1, SWITCH_SEC)

    if (prev) {
      const prevGate = this._gates[prev].gain
      if (instant) prevGate.value = 0
      else prevGate.rampTo(0, SWITCH_SEC)
      const release = () => {
        if (this._mode === prev) return
        try { this.input.disconnect(this._paths[prev].input) } catch {}
      }
      if (instant) release()
      else this._switchTimer = setTimeout(release, SWITCH_SEC * 1000 + 50)
    }

    try { globalThis.localStorage?.setItem(STORAGE_KEY, mode) } catch {}
    return mode
  }

  // Current gain reduction in dB (≤ 0) on the active path — for debugging by ear.
  status() {
    const p = this._paths[this._mode]
    const reduction = n => Math.round((n?.reduction ?? 0) * 10) / 10
    return { mode: this._mode, glueReductionDb: reduction(p.glue), limiterReductionDb: reduction(p.limiter) }
  }
}

// One bus per audio context. Tone.Offline swaps the global context for the length of
// a render, so keying on the raw context keeps an offline render from ever creating
// or reusing the live bus.
const buses = new WeakMap()

export function getMasterBus() {
  const raw = Tone.getContext().rawContext
  let bus = buses.get(raw)
  if (!bus) {
    bus = new MasterBus()
    buses.set(raw, bus)
    if (typeof window !== 'undefined') {
      window.leidMaster = {
        set: mode => bus.setMode(mode),
        status: () => bus.status(),
        modes: MASTER_BUS_MODES,
      }
    }
  }
  return bus
}
