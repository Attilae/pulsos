// Texture: hosts the Clouds-derived granular DSP (public/wasm/clouds-granular-*.wasm,
// built by scripts/build_clouds.js) inside an AudioWorklet, as an insert on a
// lane: the lane's dry audio comes in, dry + grains go out. lib/textureVoice.js
// is the main-thread half.
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/, and it has no `import`/`export` for the same reason as
// true-peak-limiter.js: standardized-audio-context re-evaluates worklet source
// inside a function body. The host logic is the TextureHost class, which has no
// globals and is unit-tested from Node (test/clouds-granular-worklet.test.js); the
// processor at the bottom only registers inside an AudioWorklet.
//
// Signal model:
//   - Input is low-passed at the context rate (two biquads, 14.4 kHz) and read
//     at the DSP's 32 kHz positions with a 4-point Hermite interpolator, like the
//     module's codec feeding its 32 kHz processor.
//   - The DSP runs in fixed 32-sample blocks, each as soon as its input exists.
//     Its wet output is read back at the context rate LATENCY DSP samples late
//     (≈2.3 ms): the smallest delay at which the next block is always ready.
//   - The dry signal is the context-rate input itself, scaled by the DSP's dry
//     gain (the BLEND dry/wet crossfade), so the lane's own sound is never
//     resampled or delayed.
//   - TRIG: a lane note carries an audio-context time; it seeds a grain at the
//     DSP block holding the input recorded at that time. Late ones play on the
//     next block, stale ones (> STALE_SEC) are dropped, and every trigger carries
//     a generation id so `cancel` discards queued ones.

const DSP_RATE = 32000
const BLOCK = 32
const LATENCY = 2 * BLOCK + 8
const IN_RING = 2048                 // context frames kept (power of 2)
const IN_MASK = IN_RING - 1
const OUT_RING = 1024                // DSP samples kept (power of 2)
const OUT_MASK = OUT_RING - 1
const STALE_SEC = 0.05
const MAX_QUEUE = 256
const AA_CUTOFF = 14400
const PROCESSOR_NAME = 'leid-clouds-granular'

// RBJ low-pass biquad coefficients.
function lowpass(fc, q, sr) {
  const w = 2 * Math.PI * fc / sr
  const a = Math.sin(w) / (2 * q)
  const c = Math.cos(w)
  const a0 = 1 + a
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - a) / a0 }
}

class Biquad {
  constructor(k) { this.k = k; this.z1 = 0; this.z2 = 0 }
  run(x) {
    const k = this.k
    const y = k.b0 * x + this.z1
    this.z1 = k.b1 * x - k.a1 * y + this.z2
    this.z2 = k.b2 * x - k.a2 * y
    return y
  }
}

class TextureHost {
  // exports: the wasm instance's exports; sampleRate: the context rate.
  constructor(exports, sampleRate, { seed = 1, params = null } = {}) {
    this.x = exports
    this.sampleRate = sampleRate
    this.ratio = DSP_RATE / sampleRate
    this.origin = null
    this.written = 0                 // context frames written into the input ring
    this.nextBlock = 0
    this.inL = new Float32Array(IN_RING)
    this.inR = new Float32Array(IN_RING)
    this.wetL = new Float32Array(OUT_RING)
    this.wetR = new Float32Array(OUT_RING)
    this.dryGain = 1
    this.dryTarget = 1
    this.queue = []
    this.seq = 0
    this.gen = 0
    this.stats = { late: 0, dropped: 0, overflow: 0, cancelled: 0, underrun: 0 }
    const downsampling = sampleRate > DSP_RATE
    const q1 = 0.5412, q2 = 1.3066    // 4th-order Butterworth
    const mk = () => downsampling
      ? [new Biquad(lowpass(AA_CUTOFF, q1, sampleRate)), new Biquad(lowpass(AA_CUTOFF, q2, sampleRate))]
      : null
    this.aaL = mk()
    this.aaR = mk()

    exports.cg_init(seed >>> 0)
    if (params) this.setParams(params)
    const mem = exports.memory.buffer
    this.dspInL = new Float32Array(mem, exports.cg_in_l(), BLOCK)
    this.dspInR = new Float32Array(mem, exports.cg_in_r(), BLOCK)
    this.dspOutL = new Float32Array(mem, exports.cg_out_l(), BLOCK)
    this.dspOutR = new Float32Array(mem, exports.cg_out_r(), BLOCK)
  }

  setParams(p) {
    this.x.cg_set_params(
      p.position, p.size, p.pitch, p.density, p.texture,
      p.dryWet, p.spread, p.feedback, p.reverb, p.inGain, p.freeze ? 1 : 0,
    )
  }

  reset() {
    this.x.cg_reset()
    this.queue = []
  }

  // DSP block holding the input recorded at context time `time`.
  blockForTime(time, frameHint) {
    const origin = this.origin ?? frameHint
    return Math.round(((time * this.sampleRate - origin) * this.ratio) / BLOCK)
  }

  // Queue a TRIG: { time, gen }.
  trig(msg, frameHint = 0) {
    if ((msg.gen ?? 0) < this.gen) { this.stats.cancelled++; return false }
    if (!Number.isFinite(msg.time)) return false
    if (this.queue.length >= MAX_QUEUE) { this.stats.overflow++; return false }
    const ev = { block: this.blockForTime(msg.time, frameHint), seq: this.seq++, gen: msg.gen ?? 0 }
    let lo = 0, hi = this.queue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const q = this.queue[mid]
      if (q.block < ev.block || (q.block === ev.block && q.seq < ev.seq)) lo = mid + 1
      else hi = mid
    }
    this.queue.splice(lo, 0, ev)
    return true
  }

  cancel(gen) {
    if (gen > this.gen) this.gen = gen
    const before = this.queue.length
    this.queue = this.queue.filter(e => e.gen >= this.gen)
    this.stats.cancelled += before - this.queue.length
  }

  _readInput(ring, pos) {
    const i = Math.floor(pos)
    if (this.ratio === 1) return ring[i & IN_MASK]
    return hermite(ring, i, pos - i, IN_MASK)
  }

  _renderBlock() {
    const block = this.nextBlock
    const staleBlocks = (STALE_SEC * DSP_RATE) / BLOCK
    let trigger = false
    while (this.queue.length && this.queue[0].block <= block) {
      const ev = this.queue.shift()
      if (ev.block < block) {
        if (block - ev.block > staleBlocks) { this.stats.dropped++; continue }
        this.stats.late++
      }
      trigger = true
    }
    if (trigger) this.x.cg_trigger()
    const base = block * BLOCK
    for (let i = 0; i < BLOCK; i++) {
      const pos = (base + i) / this.ratio
      this.dspInL[i] = this._readInput(this.inL, pos)
      this.dspInR[i] = this._readInput(this.inR, pos)
    }
    this.x.cg_render()
    for (let i = 0; i < BLOCK; i++) {
      this.wetL[(base + i) & OUT_MASK] = this.dspOutL[i]
      this.wetR[(base + i) & OUT_MASK] = this.dspOutR[i]
    }
    // √2 × 0.7071 lands a float32 ulp off 1 (and off 0 at the other end); snap,
    // so a fully dry Texture passes the lane through bit-exact.
    const g = this.x.cg_dry_gain()
    this.dryTarget = Math.abs(g - 1) < 1e-5 ? 1 : (g < 1e-5 ? 0 : g)
    this.nextBlock++
  }

  // One render quantum. `inL`/`inR` may be null (nothing connected: silence).
  process(inL, inR, outL, outR, frames, startFrame) {
    if (this.origin === null) this.origin = startFrame
    const rel0 = startFrame - this.origin
    // 1. Record this quantum's (anti-aliased) input.
    for (let j = 0; j < frames; j++) {
      let l = inL ? inL[j] : 0
      let r = inR ? inR[j] : l
      if (this.aaL) {
        l = this.aaL[1].run(this.aaL[0].run(l))
        r = this.aaR[1].run(this.aaR[0].run(r))
      }
      this.inL[(rel0 + j) & IN_MASK] = l
      this.inR[(rel0 + j) & IN_MASK] = r
    }
    this.written = rel0 + frames
    // 2. Render every DSP block whose input (incl. Hermite look-ahead) exists.
    while ((((this.nextBlock + 1) * BLOCK - 1) / this.ratio) + 2 < this.written) this._renderBlock()
    // 3. Output: dry now, wet LATENCY DSP samples late.
    const rendered = this.nextBlock * BLOCK
    for (let j = 0; j < frames; j++) {
      this.dryGain += 0.002 * (this.dryTarget - this.dryGain)
      const dryL = inL ? inL[j] : 0
      const dryR = inR ? inR[j] : dryL
      const p = (rel0 + j) * this.ratio - LATENCY
      let wl = 0, wr = 0
      if (p >= 1) {
        const i = Math.floor(p)
        if (i + 2 < rendered) {
          const t = p - i
          wl = hermite(this.wetL, i, t, OUT_MASK)
          wr = hermite(this.wetR, i, t, OUT_MASK)
        } else {
          this.stats.underrun++
        }
      }
      outL[j] = dryL * this.dryGain + wl
      if (outR) outR[j] = dryR * this.dryGain + wr
    }
  }
}

// 4-point, 3rd-order Hermite interpolation of ring[i + t], 0 ≤ t < 1.
function hermite(ring, i, t, mask) {
  const xm1 = ring[(i - 1) & mask]
  const x0 = ring[i & mask]
  const x1 = ring[(i + 1) & mask]
  const x2 = ring[(i + 2) & mask]
  const c1 = 0.5 * (x1 - xm1)
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
  return ((c3 * t + c2) * t + c1) * t + x0
}

if (typeof registerProcessor === 'function') {
  const modules = new Map()

  class TextureProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super()
      const o = options?.processorOptions ?? {}
      this.host = null
      this.stopped = false
      this.reported = { overflow: 0, dropped: 0, underrun: 0 }
      this.port.onmessage = ({ data }) => this.onMessage(data)
      try {
        let mod = modules.get(o.sha256)
        if (!mod) {
          mod = o.module instanceof WebAssembly.Module ? o.module : new WebAssembly.Module(o.bytes)
          modules.set(o.sha256, mod)
        }
        const instance = new WebAssembly.Instance(mod, {})
        this.host = new TextureHost(instance.exports, sampleRate, o)
        this.port.postMessage({ type: 'ready' })
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
        case 'trig':   h.trig(m, currentFrame); break
        case 'params': h.setParams(m.params); break
        case 'cancel': h.cancel(m.gen); break
        case 'reset':  h.reset(); break
        case 'stats':
          this.port.postMessage({ type: 'stats', stats: { ...h.stats, faults: h.x.cg_fault_count() } })
          break
      }
    }

    process(inputs, outputs) {
      if (this.stopped) return false
      const out = outputs[0]
      if (!out?.[0]) return true
      const input = inputs[0]
      const inL = input?.[0] ?? null
      const inR = input?.[1] ?? inL
      if (!this.host) {
        // No DSP (failed to start): pass the lane through untouched.
        out[0].set(inL ?? new Float32Array(out[0].length))
        if (out[1]) out[1].set(inR ?? new Float32Array(out[1].length))
        return true
      }
      this.host.process(inL, inR, out[0], out[1] ?? null, out[0].length, currentFrame)
      const s = this.host.stats
      if (s.overflow > this.reported.overflow || s.dropped > this.reported.dropped || s.underrun > this.reported.underrun) {
        this.reported = { overflow: s.overflow, dropped: s.dropped, underrun: s.underrun }
        this.port.postMessage({ type: 'warning', stats: { ...s } })
      }
      return true
    }
  }

  registerProcessor(PROCESSOR_NAME, TextureProcessor)
}
