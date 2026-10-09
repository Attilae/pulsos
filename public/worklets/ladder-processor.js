// Analog lane filter: hosts the DaisySP LadderFilter bridge (public/wasm/ladder-*.wasm,
// built by scripts/build_ladder.js) inside an AudioWorklet, as one stereo insert per
// lane. lib/laneFilter.js is the main-thread half; it owns the Classic branch, the
// bypass/model crossfades and the post-filter audibility gate. This processor only
// filters.
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/, and it has no `import`/`export` for the same reason as
// true-peak-limiter.js: standardized-audio-context re-evaluates worklet source
// inside a function body. The host logic is the LadderHost class, which has no
// globals and is unit-tested from Node (test/ladder-worklet.test.js); the processor
// at the bottom only registers inside an AudioWorklet.
//
// Signal model:
//   - The DSP runs at the context rate (the ladder oversamples 4× internally), one
//     wasm call per ≤128-frame chunk. Cutoff/resonance/drive are a-rate
//     AudioParams; their arrays are copied into wasm memory in bulk and the bridge
//     recomputes coefficients only when a value changes, so scheduled ramps land
//     on the sample they are scheduled for.
//   - A mono input is duplicated into both channels by the bridge; no input at all
//     is zeros, which still advances the filter state (a self-oscillating filter
//     keeps ringing until the main thread suspends it).
//   - `suspend` resets the DSP and outputs silence without calling into wasm, so an
//     Analog lane that is bypassed, switched to Classic or gated silent costs
//     almost nothing. `resume` picks up from a clean state with the current params.
//   - A nonfinite output resets the DSP (in the bridge) and is reported once.

const MAX_FRAMES = 128
const FLAG_STEREO = 1, FLAG_FREQ = 2, FLAG_RES = 4, FLAG_DRIVE = 8
const PROCESSOR_NAME = 'leid-ladder-filter'
const ABI_VERSION = 1

// LP24, LP12, BP24, BP12, HP24, HP12 — the bridge's mode indices.
function modeIndex(type, slope) {
  const base = type === 'highpass' ? 4 : type === 'bandpass' ? 2 : 0
  return base + (Number(slope) === 12 ? 1 : 0)
}

class LadderHost {
  // exports: the wasm instance's exports; sampleRate: the context rate.
  // opts: { mode, cutoff, resonance, drive, suspended }
  constructor(exports, sampleRate, opts = {}) {
    const abi = exports.ld_abi_version?.()
    if (abi !== ABI_VERSION) throw new Error(`ladder ABI ${abi}, expected ${ABI_VERSION}`)
    this.x = exports
    this.sampleRate = sampleRate
    this.fadeSamples = Math.max(1, Math.round(0.02 * sampleRate))
    exports.ld_init(sampleRate)
    const mem = exports.memory.buffer
    const view = (ptr) => new Float32Array(mem, ptr, MAX_FRAMES)
    this.inL = view(exports.ld_in_l())
    this.inR = view(exports.ld_in_r())
    this.outL = view(exports.ld_out_l())
    this.outR = view(exports.ld_out_r())
    this.freq = view(exports.ld_freq())
    this.res = view(exports.ld_res())
    this.drive = view(exports.ld_drive())
    this.maxCutoff = exports.ld_max_cutoff()
    exports.ld_set_mode(Number.isInteger(opts.mode) ? opts.mode : 0, 0)
    // The value each parameter holds when a quantum brings no array for it.
    this.last = { freq: opts.cutoff ?? 20000, res: opts.resonance ?? 0.2, drive: opts.drive ?? 1 }
    exports.ld_set_params(this.last.freq, this.last.res, this.last.drive)
    this.suspended = !!opts.suspended
    this.faults = 0
    this.faultReported = false
  }

  setMode(mode, fade = this.fadeSamples) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 5) return
    // A suspended filter has no sound to crossfade.
    this.x.ld_set_mode(mode, this.suspended ? 0 : fade)
  }

  reset() { this.x.ld_reset() }

  suspend() {
    if (this.suspended) return
    this.suspended = true
    this.x.ld_reset()
  }

  resume() { this.suspended = false }

  // One render quantum. inL/inR may be null (nothing connected / mono input).
  // params: { cutoff, resonance, drive } Float32Arrays of length 1 or `frames`.
  // Returns true the first time a nonfinite output forced a reset.
  process(inL, inR, outL, outR, frames, params) {
    if (this.suspended) {
      outL.fill(0, 0, frames)
      if (outR) outR.fill(0, 0, frames)
      return false
    }
    const x = this.x
    for (let off = 0; off < frames; off += MAX_FRAMES) {
      const n = Math.min(MAX_FRAMES, frames - off)
      let flags = 0
      if (inL) this.inL.set(inL.subarray(off, off + n))
      else this.inL.fill(0, 0, n)
      if (inL && inR && inR !== inL) { this.inR.set(inR.subarray(off, off + n)); flags |= FLAG_STEREO }
      flags |= this._param('freq', params?.cutoff, off, n, FLAG_FREQ)
      flags |= this._param('res', params?.resonance, off, n, FLAG_RES)
      flags |= this._param('drive', params?.drive, off, n, FLAG_DRIVE)
      x.ld_process(n, flags)
      outL.set(this.outL.subarray(0, n), off)
      if (outR) outR.set(this.outR.subarray(0, n), off)
    }
    const faults = x.ld_fault_count()
    if (faults > this.faults) {
      this.faults = faults
      if (!this.faultReported) { this.faultReported = true; return true }
    }
    return false
  }

  // Copy one parameter's array into wasm memory. A constant (length-1 array, or
  // none at all) is passed as index 0 without the per-sample flag.
  _param(key, src, off, n, flag) {
    const dst = this[key]
    if (!src || src.length === 0) { dst[0] = this.last[key]; return 0 }
    if (src.length === 1) { dst[0] = this.last[key] = src[0]; return 0 }
    dst.set(src.subarray(off, off + n))
    this.last[key] = src[off + n - 1]
    return flag
  }
}

if (typeof registerProcessor === 'function') {
  const modules = new Map()

  class LadderProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'cutoff', defaultValue: 20000, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
        { name: 'resonance', defaultValue: 0.2, minValue: 0, maxValue: 1.8, automationRate: 'a-rate' },
        { name: 'drive', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'a-rate' },
      ]
    }

    constructor(options) {
      super()
      const o = options?.processorOptions ?? {}
      this.host = null
      this.stopped = false
      this.params = { cutoff: null, resonance: null, drive: null }
      this.port.onmessage = ({ data }) => this.onMessage(data)
      try {
        let mod = modules.get(o.sha256)
        if (!mod) {
          mod = o.module instanceof WebAssembly.Module ? o.module : new WebAssembly.Module(o.bytes)
          modules.set(o.sha256, mod)
        }
        const instance = new WebAssembly.Instance(mod, {})
        this.host = new LadderHost(instance.exports, sampleRate, {
          mode: modeIndex(o.type, o.slope),
          cutoff: o.cutoff, resonance: o.resonance, drive: o.drive, suspended: o.suspended,
        })
        this.port.postMessage({ type: 'ready', maxCutoff: this.host.maxCutoff })
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err?.message ?? err) })
      }
    }

    onMessage(m) {
      if (!m) return
      if (m.type === 'dispose') { this.stopped = true; return }
      const h = this.host
      if (!h) return
      switch (m.type) {
        case 'mode':    h.setMode(modeIndex(m.filterType, m.slope)); break
        case 'suspend': h.suspend(); break
        case 'resume':  h.resume(); break
        case 'reset':   h.reset(); break
      }
    }

    process(inputs, outputs, parameters) {
      if (this.stopped) return false
      const out = outputs[0]
      if (!out?.[0]) return true
      if (!this.host) { out[0].fill(0); out[1]?.fill(0); return true }
      const input = inputs[0]
      const inL = input?.[0] ?? null
      const inR = input?.[1] ?? null
      const p = this.params
      p.cutoff = parameters.cutoff; p.resonance = parameters.resonance; p.drive = parameters.drive
      if (this.host.process(inL, inR, out[0], out[1] ?? null, out[0].length, p)) {
        this.port.postMessage({ type: 'fault', faults: this.host.faults })
      }
      return true
    }
  }

  registerProcessor(PROCESSOR_NAME, LadderProcessor)
}
