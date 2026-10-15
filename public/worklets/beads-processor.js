// Texture Mk II: hosts the Beads-derived DSP (public/wasm/beads-*.wasm, built by
// scripts/build_beads.js) inside an AudioWorklet, as an insert on a lane: the
// lane's audio comes in, the processor's full output (dry and wet) goes out.
// lib/textureVoice.js is the main-thread half.
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/, and it has no `import`/`export` for the same reason as
// true-peak-limiter.js: standardized-audio-context re-evaluates worklet source
// inside a function body. The host logic is the BeadsHost class, which has no
// globals and is unit-tested from Node (test/beads-worklet.test.js); the
// processor at the bottom only registers inside an AudioWorklet.
//
// Signal model:
//   - The DSP's rate follows the quality (24, 48, 32 or 48 kHz) and its block is
//     rate / 4000 samples (dsp/beads/bridge.cc). Input is low-passed at the
//     context rate when the DSP rate is lower (two biquads at 0.45 × the DSP
//     rate) and read at the DSP's positions with a 4-point Hermite interpolator.
//   - Each block runs as soon as its input exists. Its output is read back at
//     the context rate `latency` DSP samples late (2 blocks + 8 samples, under
//     1 ms at every quality): the smallest delay at which the next block is
//     always ready.
//   - Unlike Classic (clouds-granular-processor.js), the dry signal goes through
//     the DSP too: in its lo-fi qualities Beads degrades the dry path (mu-law in
//     Dirty tape, 12-bit in Vintage), and its dry/wet law is its own.
//   - SEED: a lane note is a gate, high at its audio-context time and low at
//     time + duration, applied at the exact DSP sample. Late gate-highs play at
//     the next block, stale ones (> STALE_SEC) are dropped; a gate-low is never
//     dropped, or a held gate would run grains forever. Every note carries a
//     generation id so `cancel` discards queued ones (and closes an open gate).
//   - Changing quality fades the output out (FADE_SEC), switches the DSP, starts
//     a new timeline at the new rate and fades back in. Queued gates keep their
//     context times, so they land correctly on the new timeline.

const IN_RING = 4096                 // context frames kept (power of 2)
const IN_MASK = IN_RING - 1
const OUT_RING = 2048                // DSP samples kept (power of 2)
const OUT_MASK = OUT_RING - 1
const MAX_BLOCK = 12
const BLOCK_RATE = 4000
const STALE_SEC = 0.05
const MAX_QUEUE = 256
const FADE_SEC = 0.005
const QUALITY_IDS = ['dirtyTape', 'cleanTape', 'vintage', 'hifi']   // bd_set_quality order
const SEED_MODES = { gates: [0, 1], clock: [2, 1], free: [2, 0] }    // [button, patched]
const PROCESSOR_NAME = 'leid-beads'

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

class BeadsHost {
  // exports: the wasm instance's exports; sampleRate: the context rate.
  // params: see setParams.
  constructor(exports, sampleRate, { seed = 1, params = null } = {}) {
    this.x = exports
    this.sampleRate = sampleRate
    this.inL = new Float32Array(IN_RING)
    this.inR = new Float32Array(IN_RING)
    this.outL = new Float32Array(OUT_RING)
    this.outR = new Float32Array(OUT_RING)
    this.queue = []                  // { frame, high, seq, gen }, sorted by frame then seq
    this.seq = 0
    this.gen = 0
    this.gateHigh = false            // the level last handed to the DSP
    this.stats = { late: 0, dropped: 0, overflow: 0, cancelled: 0, underrun: 0, switches: 0 }
    this.fade = 1                    // output gain around a quality switch
    this.fadeStep = 1 / Math.max(1, FADE_SEC * sampleRate)
    this.pendingQuality = null
    this.seedMode = 'gates'

    exports.bd_init(seed >>> 0)
    const mem = exports.memory.buffer
    this.dspInL = new Float32Array(mem, exports.bd_in_l(), MAX_BLOCK)
    this.dspInR = new Float32Array(mem, exports.bd_in_r(), MAX_BLOCK)
    this.dspOutL = new Float32Array(mem, exports.bd_out_l(), MAX_BLOCK)
    this.dspOutR = new Float32Array(mem, exports.bd_out_r(), MAX_BLOCK)
    this.quality = QUALITY_IDS[exports.bd_quality()]
    this.x.bd_set_seed(...SEED_MODES.gates)
    if (params) this.setParams(params, true)
    this._startTimeline(null)
  }

  get latency() { return 2 * this.block + 8 }

  // A new DSP timeline at the current quality's rate, anchored at context frame
  // `origin` (null: the first processed quantum).
  _startTimeline(origin) {
    this.dspRate = this.x.bd_sample_rate()
    this.block = this.x.bd_block_size()
    this.ratio = this.dspRate / this.sampleRate
    this.origin = origin
    this.written = 0                 // context frames written since origin
    this.nextSample = 0              // DSP samples rendered since origin
    this.inL.fill(0); this.inR.fill(0)
    this.outL.fill(0); this.outR.fill(0)
    const downsampling = this.sampleRate > this.dspRate
    const fc = 0.45 * this.dspRate
    const q1 = 0.5412, q2 = 1.3066    // 4th-order Butterworth
    const mk = () => downsampling
      ? [new Biquad(lowpass(fc, q1, this.sampleRate)), new Biquad(lowpass(fc, q2, this.sampleRate))]
      : null
    this.aaL = mk()
    this.aaR = mk()
  }

  // p: { time, size, shape, pitch, timeAmt, sizeAmt, shapeAmt, pitchAmt, density,
  //      feedback, dryWet, reverb, inGain, freeze, quality, seedMode }. Knobs are
  // 0..1 panel positions (attenuverters and pitch centred at 0.5), inGain is
  // linear, quality is one of QUALITY_IDS and seedMode one of SEED_MODES.
  setParams(p, immediate = false) {
    this.x.bd_set_params(
      p.time, p.size, p.shape, p.pitch,
      p.timeAmt, p.sizeAmt, p.shapeAmt, p.pitchAmt,
      p.density, p.feedback, p.dryWet, p.reverb, p.inGain, p.freeze ? 1 : 0,
    )
    if (p.seedMode in SEED_MODES && p.seedMode !== this.seedMode) {
      this.seedMode = p.seedMode
      this.x.bd_set_seed(...SEED_MODES[p.seedMode])
    }
    const q = QUALITY_IDS.indexOf(p.quality)
    if (q >= 0) {
      if (immediate) { this.x.bd_set_quality(q); this.quality = p.quality; this.pendingQuality = null }
      else if (p.quality !== (this.pendingQuality ?? this.quality)) this.pendingQuality = p.quality
    }
  }

  reset() {
    this.x.bd_reset()
    this.queue = []
    this.gateHigh = false
  }

  // Queue a lane note: { time, dur, gen } in audio-context seconds. Its gate is
  // high from `time` to `time + dur`.
  note(msg) {
    if ((msg.gen ?? 0) < this.gen) { this.stats.cancelled++; return false }
    if (!Number.isFinite(msg.time)) return false
    if (this.queue.length + 2 > MAX_QUEUE) { this.stats.overflow++; return false }
    const dur = Number.isFinite(msg.dur) && msg.dur > 0 ? msg.dur : 0.01
    const gen = msg.gen ?? 0
    this._insert({ frame: msg.time * this.sampleRate, high: true, seq: this.seq++, gen })
    this._insert({ frame: (msg.time + dur) * this.sampleRate, high: false, seq: this.seq++, gen })
    return true
  }

  _insert(ev) {
    let lo = 0, hi = this.queue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const q = this.queue[mid]
      if (q.frame < ev.frame || (q.frame === ev.frame && q.seq < ev.seq)) lo = mid + 1
      else hi = mid
    }
    this.queue.splice(lo, 0, ev)
  }

  // Drop every queued note from an older generation. Grains already sounding
  // ring out; an open gate closes at the next block.
  cancel(gen) {
    if (gen > this.gen) this.gen = gen
    const before = this.queue.length
    this.queue = this.queue.filter(e => e.gen >= this.gen)
    this.stats.cancelled += before - this.queue.length
    // The note holding the gate open may just have lost its gate-low.
    if (this.gateHigh) this._insert({ frame: -Infinity, high: false, seq: this.seq++, gen: this.gen })
  }

  _readInput(ring, pos) {
    const i = Math.floor(pos)
    return hermite(ring, i, pos - i, IN_MASK)
  }

  _renderBlock() {
    const n = this.block
    const start = this.nextSample
    const staleSamples = STALE_SEC * this.dspRate
    let lastHigh = -1
    while (this.queue.length) {
      const ev = this.queue[0]
      const at = (ev.frame - this.origin) * this.ratio     // DSP sample on this timeline
      if (at >= start + n) break
      this.queue.shift()
      let offset = Math.floor(at - start)
      if (offset < 0) {
        if (ev.high && start - at > staleSamples) { this.stats.dropped++; continue }
        if (ev.high && Number.isFinite(at)) this.stats.late++
        offset = 0
      }
      if (!ev.high && offset <= lastHigh) {
        // Closes a gate opened in this same block: keep it open one sample at
        // least, or upstream never sees the rising edge.
        if (lastHigh + 1 < n) offset = lastHigh + 1
        else { this.queue.unshift({ ...ev, frame: this.origin + (start + n) / this.ratio }); break }
      }
      if (ev.high) lastHigh = offset
      this.x.bd_gate(offset, ev.high ? 1 : 0)
      this.gateHigh = ev.high
    }
    for (let i = 0; i < n; i++) {
      const pos = (start + i) / this.ratio
      this.dspInL[i] = this._readInput(this.inL, pos)
      this.dspInR[i] = this._readInput(this.inR, pos)
    }
    this.x.bd_render()
    for (let i = 0; i < n; i++) {
      this.outL[(start + i) & OUT_MASK] = this.dspOutL[i]
      this.outR[(start + i) & OUT_MASK] = this.dspOutR[i]
    }
    this.nextSample = start + n
  }

  // One render quantum. `inL`/`inR` may be null (nothing connected: silence).
  process(inL, inR, outL, outR, frames, startFrame) {
    if (this.origin === null) this.origin = startFrame
    if (this.pendingQuality !== null && this.fade <= 0) {
      // Faded out: switch the DSP and start a new timeline at its rate.
      this.x.bd_set_quality(QUALITY_IDS.indexOf(this.pendingQuality))
      this.quality = this.pendingQuality
      this.pendingQuality = null
      this.stats.switches++
      this._startTimeline(startFrame)
    }
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
    while (((this.nextSample + this.block - 1) / this.ratio) + 2 < this.written) this._renderBlock()
    // 3. Output, `latency` DSP samples late, faded around quality switches.
    const rendered = this.nextSample
    const latency = this.latency
    const fadeTarget = this.pendingQuality !== null ? 0 : 1
    for (let j = 0; j < frames; j++) {
      if (this.fade !== fadeTarget) {
        this.fade = fadeTarget > this.fade
          ? Math.min(fadeTarget, this.fade + this.fadeStep)
          : Math.max(fadeTarget, this.fade - this.fadeStep)
      }
      const p = (rel0 + j) * this.ratio - latency
      let l = 0, r = 0
      if (p >= 1) {
        const i = Math.floor(p)
        if (i + 2 < rendered) {
          const t = p - i
          l = hermite(this.outL, i, t, OUT_MASK)
          r = hermite(this.outR, i, t, OUT_MASK)
        } else {
          this.stats.underrun++
        }
      }
      outL[j] = l * this.fade
      if (outR) outR[j] = r * this.fade
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

  class BeadsProcessor extends AudioWorkletProcessor {
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
        this.host = new BeadsHost(instance.exports, sampleRate, o)
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
        case 'note':   h.note(m); break
        case 'params': h.setParams(m.params); break
        case 'cancel': h.cancel(m.gen); break
        case 'reset':  h.reset(); break
        case 'stats':
          this.port.postMessage({ type: 'stats', stats: { ...h.stats, faults: h.x.bd_fault_count(), quality: h.quality } })
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
      // At most one warning a second: under overload every block can count a
      // fault, and a message per block would load the main thread further.
      if ((s.overflow > this.reported.overflow || s.dropped > this.reported.dropped || s.underrun > this.reported.underrun) && currentFrame >= (this.nextWarnFrame ?? 0)) {
        this.reported = { overflow: s.overflow, dropped: s.dropped, underrun: s.underrun }
        this.nextWarnFrame = currentFrame + sampleRate
        this.port.postMessage({ type: 'warning', stats: { ...s } })
      }
      return true
    }
  }

  registerProcessor(PROCESSOR_NAME, BeadsProcessor)
}
