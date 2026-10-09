import * as Tone from 'tone'
import {
  ANALOG_MODEL, FILTER_XFADE_SEC, FILTER_RANGES, CLASSIC_FILTER_TYPES,
  analogMaxCutoff, resolveLaneFilter,
} from './laneFilterSpec.js'
import {
  LADDER_PROCESSOR, isLadderReady, ladderProcessorOptions, prepareLadder, subscribeLadderStatus,
} from './ladderLoader.js'

// A lane's insert filter: the stable node the engine splices between routeGain and
// the weq8 EQ (lib/engine.js _createSingleRouteEntry / _ensureDrumInsert). It owns
// both models and the switching between them, so the engine never branches on the
// model:
//
//   input ─┬─ Tone.Filter (Classic) ─ classicGain ───────────────────┐
//          ├─ AudioWorkletNode (Analog, lazy) ─ analogGain ─ gate ───┼─ output
//          └─ dryGain (lazy, bypass) ────────────────────────────────┘
//
// - Classic is always built, so a lane plays the moment it exists. A lane that asks
//   for Analog keeps sounding through Classic until the DSP is ready, and stays on
//   Classic (with its Analog settings preserved) if loading fails; a later
//   successful load (retryLadder) upgrades it, because every LaneFilter listens to
//   the loader status.
// - Model and bypass changes crossfade over FILTER_XFADE_SEC with complementary
//   linear gains (correlated paths, so no equal-power bump). Analog response/slope
//   changes crossfade inside the DSP, on an exact copy of the filter state.
// - The gate after the Analog filter is the audibility control: a disabled,
//   solo-excluded or zero-volume lane has silence at its input, but a
//   self-oscillating ladder keeps ringing without input. setAudible(false) fades
//   the gate and then suspends + resets the DSP. Classic needs no gate (a biquad
//   with no input is silent), so its behaviour is unchanged.
// - Analog DSP that isn't heard (Classic selected, bypassed, or gated) is
//   suspended once its fade-out is over: it costs nothing and holds no state.
// - Parameters: cutoff/resonance/drive are the worklet's a-rate AudioParams,
//   wrapped in Tone.Params so manual edits and automation use the same rampTo
//   (cancel-and-hold, then ramp) as Classic. The latest value of each — manual or
//   automated — is kept, so a node built later starts where the lane is.

const SWITCH_SETTLE_MS = Math.round(FILTER_XFADE_SEC * 1000) + 15

// Every live LaneFilter, across engines (MixerTab's and the Song Chainer's two),
// so the panels' Retry reaches all of them without a reference to an engine.
const liveFilters = new Set()

// Try Analog again on every lane that fell back to Classic. Call after
// retryLadder() (lib/ladderLoader.js) has reloaded the DSP.
export function retryAnalogFilters() {
  for (const f of liveFilters) f.retry()
}

export class LaneFilter {
  constructor(cfg = {}, { onStatus = null, onFault = null } = {}) {
    this._ctx = Tone.getContext()
    this._cfg = resolveLaneFilter(cfg)
    // The values each param is heading to right now (manual or automated).
    this._live = { frequency: this._cfg.frequency, Q: this._cfg.Q, resonance: this._cfg.resonance, drive: this._cfg.drive }
    this._onStatus = onStatus
    this._onFault = onFault
    this._disposed = false
    this._audible = true
    this._dspRunning = false
    this._buildToken = 0
    this._suspendTimer = null
    this._faultReported = false
    this._analogFailed = false   // a node failed on this lane: wait for retry()
    this.status = 'classic'      // 'classic' | 'pending' | 'ready' | 'error'
    this.error = null

    this.input = new Tone.Gain(1)
    this.output = new Tone.Gain(1)
    this.classic = new Tone.Filter({
      type: CLASSIC_FILTER_TYPES.includes(this._cfg.type) ? this._cfg.type : 'lowpass',
      frequency: this._cfg.frequency,
      Q: this._cfg.Q,
    })
    this._classicGain = new Tone.Gain(1)
    this.input.connect(this.classic)
    this.classic.connect(this._classicGain)
    this._classicGain.connect(this.output)

    this._dryGain = null
    this._node = null
    this._params = null
    this._analogGain = null
    this._gate = null

    liveFilters.add(this)
    this._unsubscribe = subscribeLadderStatus((s) => this._onLoaderStatus(s))
    this._route(true)
  }

  get model() { return this._cfg.model }
  get analogActive() { return !!this._node && this._wantsAnalog() }
  get maxCutoff() { return analogMaxCutoff(this._ctx.sampleRate) }

  connect(dest) {
    this.output.connect(dest)
    return this
  }

  disconnect(dest) {
    try { this.output.disconnect(dest) } catch {}
    return this
  }

  // ── Manual settings ────────────────────────────────────────────────────────
  // A partial filter object (UI edit, song load, plan). Ramps match the legacy
  // Classic insert: 50 ms for frequency and Q, an immediate type change.
  set(params = {}) {
    if (this._disposed) return this
    const prev = this._cfg
    const next = resolveLaneFilter({ ...prev, ...params })
    this._cfg = next
    if (params.type != null && next.type !== prev.type && CLASSIC_FILTER_TYPES.includes(next.type)) {
      this.classic.type = next.type
    }
    if (params.frequency != null) this._ramp('frequency', next.frequency, 0.05)
    if (params.Q != null)         this._ramp('Q', next.Q, 0.05)
    if (params.resonance != null) this._ramp('resonance', next.resonance, 0.05)
    if (params.drive != null)     this._ramp('drive', next.drive, 0.05)
    if ((next.type !== prev.type || next.slope !== prev.slope) && this._node) {
      this._post({ type: 'mode', filterType: next.type, slope: next.slope })
    }
    if (next.model !== prev.model || next.bypass !== prev.bypass) this._route(false)
    return this
  }

  // ── Automation ─────────────────────────────────────────────────────────────
  // `param` is the filter.* target suffix. A target for the other model only moves
  // that model's (silent) branch, so a stale Q lane can never touch resonance.
  automate(param, value, rampSec) {
    if (this._disposed || !Number.isFinite(value)) return
    this._ramp(param, value, rampSec)
  }

  // Hand a param back to its manual value (an automation lane let go of it).
  restore(param) {
    if (this._disposed) return
    if (param in this._live) this._ramp(param, this._cfg[param], 0.05)
  }

  _ramp(param, value, rampSec) {
    const range = FILTER_RANGES[param]
    if (!range) return
    const v = Math.min(range.max, Math.max(range.min, value))
    this._live[param] = v
    if (param === 'frequency') {
      this.classic.frequency.rampTo(v, rampSec)
      this._params?.cutoff.rampTo(Math.min(v, this.maxCutoff), rampSec)
    } else if (param === 'Q') {
      this.classic.Q.rampTo(v, rampSec)
    } else {
      this._params?.[param]?.rampTo(v, rampSec)
    }
  }

  // ── Audibility ─────────────────────────────────────────────────────────────
  // The engine's view of whether this lane can be heard (not disabled, not
  // solo-excluded, volume above zero). Only the Analog branch is gated.
  setAudible(audible) {
    audible = !!audible
    if (this._disposed || audible === this._audible) return
    this._audible = audible
    this._gate?.gain.rampTo(audible ? 1 : 0, FILTER_XFADE_SEC)
    this._syncDsp()
  }

  // ── Routing ────────────────────────────────────────────────────────────────

  _wantsAnalog() { return this._cfg.model === ANALOG_MODEL }

  _route(immediate) {
    // May build the node synchronously (DSP already loaded); it never routes itself.
    if (this._wantsAnalog() && !this._node) this._requestAnalog()
    const bypass = this._cfg.bypass
    const analog = !bypass && this._wantsAnalog() && !!this._node
    const classic = !bypass && !analog
    if (bypass) this._ensureDry()
    const set = (gain, v) => {
      if (!gain) return
      if (immediate) gain.gain.value = v
      else gain.gain.rampTo(v, FILTER_XFADE_SEC)
    }
    set(this._classicGain, classic ? 1 : 0)
    set(this._analogGain, analog ? 1 : 0)
    set(this._dryGain, bypass ? 1 : 0)
    this._analogHeard = analog
    this._syncDsp()
  }

  _ensureDry() {
    if (this._dryGain) return
    this._dryGain = new Tone.Gain(0)
    this.input.connect(this._dryGain)
    this._dryGain.connect(this.output)
  }

  // Run the DSP only while it can be heard. Turning on is immediate (the fade-in
  // starts from a clean state); turning off waits for the fade-out to finish.
  _syncDsp() {
    if (!this._node) return
    const run = this._analogHeard && this._audible
    clearTimeout(this._suspendTimer)
    this._suspendTimer = null
    if (run) {
      if (!this._dspRunning) { this._post({ type: 'resume' }); this._dspRunning = true }
    } else if (this._dspRunning) {
      this._suspendTimer = setTimeout(() => {
        this._suspendTimer = null
        if (this._disposed || (this._analogHeard && this._audible)) return
        this._post({ type: 'suspend' })
        this._dspRunning = false
      }, SWITCH_SETTLE_MS)
    }
  }

  // ── Analog lifecycle ───────────────────────────────────────────────────────

  _setStatus(status, error = null) {
    if (this.status === status && this.error === error) return
    this.status = status
    this.error = error
    try { this._onStatus?.(status, error) } catch {}
  }

  _requestAnalog() {
    if (this._node || this._disposed || this._analogFailed) return
    if (isLadderReady(this._ctx)) { this._buildAnalog(); return }
    this._setStatus('pending')
    const token = ++this._buildToken
    prepareLadder(this._ctx).then(
      () => { if (token === this._buildToken && this._buildAnalog()) this._route(false) },
      (err) => { if (token === this._buildToken && !this._disposed && this._wantsAnalog()) this._setStatus('error', err) },
    )
  }

  _onLoaderStatus(s) {
    if (this._disposed || !this._wantsAnalog() || this._node || this._analogFailed) return
    if (s === 'ready' && isLadderReady(this._ctx)) { if (this._buildAnalog()) this._route(false) }
    else if (s === 'loading') this._setStatus('pending')
  }

  // Returns true when it attached a node; the caller re-routes.
  _buildAnalog() {
    // An obsolete readiness callback (lane switched back to Classic, or deleted)
    // must not attach a node.
    if (this._disposed || this._node || !this._wantsAnalog()) return false
    const cfg = this._cfg
    let node
    try {
      node = this._ctx.createAudioWorkletNode(LADDER_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        outputChannelCount: [2],
        processorOptions: {
          ...ladderProcessorOptions(),
          type: cfg.type, slope: cfg.slope,
          cutoff: Math.min(this._live.frequency, this.maxCutoff),
          resonance: this._live.resonance, drive: this._live.drive,
          suspended: true,
        },
      })
    } catch (err) {
      this._fail(err)
      return false
    }
    node.port.onmessage = ({ data }) => {
      if (data?.type === 'error') this._fail(new Error(data.message))
      else if (data?.type === 'fault' && !this._faultReported) {
        this._faultReported = true
        console.warn('[analog filter] nonfinite output, the filter was reset')
        try { this._onFault?.() } catch {}
      }
    }
    node.onprocessorerror = () => this._fail(new Error('Analog filter processor error'))

    const param = (name, units) => new Tone.Param({ context: this._ctx, param: node.parameters.get(name), units })
    this._params = {
      cutoff: param('cutoff', 'frequency'),
      resonance: param('resonance', 'number'),
      drive: param('drive', 'number'),
    }
    this._params.cutoff.value = Math.min(this._live.frequency, this.maxCutoff)
    this._params.resonance.value = this._live.resonance
    this._params.drive.value = this._live.drive

    this._analogGain = new Tone.Gain(0)
    this._gate = new Tone.Gain(this._audible ? 1 : 0)
    Tone.connect(this.input, node)
    Tone.connect(node, this._analogGain)
    this._analogGain.connect(this._gate)
    this._gate.connect(this.output)
    this._node = node
    this._dspRunning = false
    this._setStatus('ready')
    return true
  }

  // Recoverable: the lane keeps (or goes back to) Classic; settings are kept.
  _fail(err) {
    if (this._disposed) return
    console.warn('[analog filter] unavailable, the lane uses Classic:', err?.message ?? err)
    this._analogFailed = true
    this._teardownAnalog()
    this._setStatus('error', err)
    this._route(false)
  }

  // The UI's Retry (after lib/ladderLoader.js retryLadder): try Analog again on a
  // lane that fell back to Classic. A no-op for lanes that are fine.
  retry() {
    if (this._disposed || this._node || !this._wantsAnalog()) return
    this._analogFailed = false
    this._route(false)
  }

  _teardownAnalog() {
    const node = this._node, gain = this._analogGain, gate = this._gate, params = this._params
    this._node = null; this._analogGain = null; this._gate = null; this._params = null
    this._dspRunning = false
    clearTimeout(this._suspendTimer)
    if (!node) return
    try { node.port.postMessage({ type: 'dispose' }) } catch {}
    try { this.input.disconnect(node) } catch {}
    setTimeout(() => {
      try { node.disconnect() } catch {}
      try { node.port.onmessage = null; node.port.close() } catch {}
      for (const p of Object.values(params ?? {})) try { p.dispose() } catch {}
      try { gain?.dispose() } catch {}
      try { gate?.dispose() } catch {}
    }, 40)
  }

  _post(msg) {
    if (this._disposed || !this._node) return
    try { this._node.port.postMessage(msg) } catch {}
  }

  dispose() {
    if (this._disposed) return this
    liveFilters.delete(this)
    this._unsubscribe?.()
    this._buildToken++
    this._teardownAnalog()
    this._disposed = true
    for (const n of [this.input, this.classic, this._classicGain, this._dryGain, this.output]) {
      try { n?.dispose() } catch {}
    }
    return this
  }
}
