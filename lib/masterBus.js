import * as Tone from 'tone'
import { SHAPER_SPAN, saturationCurve, clipperCurve } from './masterCurves.js'
import { MASTER_CHAIN_DEFAULTS, normalizeMasterChain } from './masterChain.js'

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
// The Mastering card's on/off switch is this mode (off = legacy, which still keeps a
// limiter on the output); its sliders are `setSettings` (lib/masterChain.js).
//
// The master path's limiter is a lookahead true-peak brickwall running in an
// AudioWorklet (public/worklets/true-peak-limiter.js). The module loads
// asynchronously, so the path starts on a native stand-in (DynamicsCompressorNode
// limiter → soft clipper) and swaps the worklet in once it's ready — in practice
// before the first Play. If the worklet can't load (old browser, insecure origin)
// the stand-in simply stays.
//
// Console: `leidMaster.set('legacy')`, `leidMaster.set('master')`, `leidMaster.status()`,
// `leidMaster.settings()`.

export const MASTER_BUS_MODES = ['master', 'legacy']
const SWITCH_SEC = 0.05
const PARAM_RAMP_SEC = 0.05
const TRUE_PEAK_URL = '/worklets/true-peak-limiter.js'
const TRUE_PEAK_PROCESSOR = 'leid-true-peak-limiter'   // PROCESSOR_NAME in that file

// Fixed internals. The user-adjustable values (cutoff, EQ gains, glue threshold and
// ratio, warmth, drive, ceiling) come from lib/masterChain.js; the defaults there
// are the gentle "invisible" chain — 1–2 dB of glue, a little density and a safe
// ceiling, not loudness. DynamicsCompressorNode adds make-up gain on its own (the
// spec's (1/fullRangeGain)^0.6), which the output trim compensates.
export const MASTER_SETTINGS = {
  headroomDb: -3,                                    // pad the summed lanes before dynamics
  highpassQ: 0.707,                                  // subsonic cleanup
  lowMid: { frequency: 300, Q: 0.8 },                // stacked pads/bus lanes pile up here
  airHz: 10000,                                      // high shelf
  glue:      { knee: 10, attack: 0.025, release: 0.2 },
  saturationDrive: 2,                                // tanh, blended inside one curve
  outputTrimDb: -1,
  // Native stand-in, used until the worklet loads (or if it can't). Its threshold
  // tracks the ceiling: 2 dB under it, which its make-up gain roughly restores.
  limiter:   { ratio: 20, knee: 0, attack: 0.002, release: 0.1 },
  standInBelowCeilingDb: 2,
  clipper:   { knee: 0.85, ceiling: 0.97 },          // linear below ~-1.4 dBFS
  truePeak: {
    lookaheadMs: 5,
    releaseMs: 80,
    // The stand-in compressor adds ~+1.7 dB of automatic make-up gain at these
    // settings ((2.85 dB)·0.6, from the spec's formula). The worklet has none, so
    // this restores the level the chain was tuned by ear at. Computed, not measured.
    makeupDb: 1.7,
  },
}

function shaper(curve, oversample) {
  const pre = new Tone.Gain(1 / SHAPER_SPAN)
  const ws = new Tone.WaveShaper(curve)
  ws.oversample = oversample
  pre.connect(ws)
  return { input: pre, output: ws, nodes: [pre, ws] }
}

function buildMasterPath(c = MASTER_CHAIN_DEFAULTS, s = MASTER_SETTINGS) {
  const pad = new Tone.Gain(Tone.dbToGain(s.headroomDb))
  const hpf = new Tone.BiquadFilter({ type: 'highpass', frequency: c.lowCutHz, Q: s.highpassQ })
  const mud = new Tone.BiquadFilter({ type: 'peaking', ...s.lowMid, gain: c.lowMidDb })
  const air = new Tone.BiquadFilter({ type: 'highshelf', frequency: s.airHz, gain: c.airDb })
  const glue = new Tone.Compressor({ ...s.glue, threshold: c.glueThresholdDb, ratio: c.glueRatio })
  const sat = shaper(saturationCurve({ drive: s.saturationDrive, mix: c.warmth }), '2x')
  const trim = new Tone.Gain(Tone.dbToGain(s.outputTrimDb + c.driveDb))
  const limiter = new Tone.Compressor({ ...s.limiter, threshold: c.ceilingDb - s.standInBelowCeilingDb })
  const clip = shaper(clipperCurve(s.clipper), 'none')
  const out = new Tone.Gain(1)

  pad.chain(hpf, mud, air, glue, sat.input)
  sat.output.chain(trim, limiter, clip.input)
  clip.output.connect(out)
  return {
    input: pad,
    output: out,
    hpf,
    mud,
    air,
    glue,
    saturator: sat.output,
    limiter,
    trim,
    clipOutput: clip.output,
    nodes: [pad, hpf, mud, air, glue, ...sat.nodes, trim, limiter, ...clip.nodes, out],
  }
}

// Exactly what AlertLayer ran before the bus: Tone.Compressor(-18, 4:1) → Limiter(-1).
function buildLegacyPath() {
  const compressor = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.05, release: 0.3 })
  const limiter = new Tone.Limiter(-1)
  compressor.connect(limiter)
  return { input: compressor, output: limiter, glue: compressor, limiter, nodes: [compressor, limiter] }
}

class MasterBus {
  constructor() {
    this.input = new Tone.Gain(1)
    this._settings = normalizeMasterChain(null)
    this._paths = { master: buildMasterPath(this._settings), legacy: buildLegacyPath() }
    this._gates = {}
    for (const [mode, path] of Object.entries(this._paths)) {
      const gate = new Tone.Gain(0)
      path.output.connect(gate)
      gate.toDestination()
      this._gates[mode] = gate
    }
    this._mode = null
    this._switchTimer = null
    this._truePeak = null            // { node, reductionDb } once the worklet is in
    this.setMode('master', { instant: true })
    this._installTruePeak()
  }

  get settings() { return this._settings }

  // Apply the Mastering card's settings (lib/masterChain.js) to the live nodes.
  // Idempotent and cheap for unchanged values, so callers can push the whole object.
  setSettings(raw) {
    const next = normalizeMasterChain(raw)
    const prev = this._settings
    const p = this._paths.master
    const s = MASTER_SETTINGS
    const ramp = (param, value) => param.rampTo(value, PARAM_RAMP_SEC)

    if (next.lowCutHz !== prev.lowCutHz) ramp(p.hpf.frequency, next.lowCutHz)
    if (next.lowMidDb !== prev.lowMidDb) ramp(p.mud.gain, next.lowMidDb)
    if (next.airDb !== prev.airDb) ramp(p.air.gain, next.airDb)
    if (next.glueThresholdDb !== prev.glueThresholdDb) ramp(p.glue.threshold, next.glueThresholdDb)
    if (next.glueRatio !== prev.glueRatio) ramp(p.glue.ratio, next.glueRatio)
    // A curve swap can't be ramped; at these blend amounts the step is inaudible.
    if (next.warmth !== prev.warmth) {
      p.saturator.curve = saturationCurve({ drive: s.saturationDrive, mix: next.warmth })
    }
    if (next.driveDb !== prev.driveDb) ramp(p.trim.gain, Tone.dbToGain(s.outputTrimDb + next.driveDb))
    if (next.ceilingDb !== prev.ceilingDb) {
      ramp(p.limiter.threshold, next.ceilingDb - s.standInBelowCeilingDb)
      this._truePeak?.node.port.postMessage({ ceilingDb: next.ceilingDb })
    }

    this._settings = next
    this.setMode(next.enabled ? 'master' : 'legacy')
    return next
  }

  // Swap the master path's native limiter + clipper for the worklet limiter:
  //   trim → limiter → clipper → out   becomes   trim → drive → worklet → out
  async _installTruePeak() {
    const ctx = Tone.getContext()
    // Not ctx.addAudioWorkletModule: Tone caches the first module it's handed and
    // returns that same promise for every later URL, so ours would never load if a
    // Tone worklet effect got there first.
    const worklet = ctx.rawContext.audioWorklet
    if (!worklet) return
    try {
      await worklet.addModule(TRUE_PEAK_URL)
      const { lookaheadMs, releaseMs, makeupDb } = MASTER_SETTINGS.truePeak
      // Read at install time, so a setSettings that raced the module load still lands.
      const { ceilingDb } = this._settings
      const node = ctx.createAudioWorkletNode(TRUE_PEAK_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        processorOptions: { ceilingDb, lookaheadMs, releaseMs },
      })
      const tp = { node, reductionDb: 0, latency: null }
      node.port.onmessage = ({ data }) => {
        if (data?.reductionDb != null) tp.reductionDb = data.reductionDb
        if (data?.latency != null) tp.latency = data.latency
      }

      const p = this._paths.master
      const drive = new Tone.Gain(Tone.dbToGain(makeupDb))
      p.trim.connect(drive)
      Tone.connect(drive, node)
      Tone.connect(node, p.output)
      p.trim.disconnect(p.limiter)
      p.clipOutput.disconnect(p.output)
      p.nodes.push(drive)
      this._truePeak = tp
    } catch (err) {
      console.warn('[masterBus] true-peak limiter unavailable; keeping the native limiter', err)
    }
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

    return mode
  }

  // Current gain reduction in dB (≤ 0) on the active path — polled by the card's meters.
  status() {
    const p = this._paths[this._mode]
    const round = db => Math.round(db * 10) / 10
    const tp = this._mode === 'master' ? this._truePeak : null
    return {
      mode: this._mode,
      limiter: tp ? 'true-peak worklet' : 'native',
      glueReductionDb: round(p.glue.reduction ?? 0),
      // The worklet reports its deepest reduction over the last ~100 ms.
      limiterReductionDb: round(tp ? tp.reductionDb : (p.limiter.reduction ?? 0)),
      ...(tp?.latency != null && { limiterLatencySamples: tp.latency }),
    }
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
        set: mode => bus.setMode(mode),   // A/B only; the card re-applies its own on/off
        status: () => bus.status(),
        settings: () => ({ ...bus.settings }),
        modes: MASTER_BUS_MODES,
      }
    }
  }
  return bus
}
