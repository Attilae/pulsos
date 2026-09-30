// Resonator lane instrument: hosts the Rings-derived DSP (public/wasm/
// resonator-*.wasm, built by scripts/build_resonator.js) inside an AudioWorklet.
// lib/resonatorVoice.js is the main-thread half.
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/, and it has no `import`/`export` for the same reason as
// true-peak-limiter.js: standardized-audio-context re-evaluates worklet source
// inside a function body. The host logic is the ResonatorHost class, which has no
// globals and is unit-tested from Node (test/resonator-worklet.test.js); the
// processor at the bottom only registers inside an AudioWorklet.
//
// Timing model:
//   - The DSP runs at 48 kHz in fixed 24-sample blocks (upstream's cadence).
//     DSP sample n is aligned to context frame `origin + n / ratio`, where ratio
//     is 48000 / sampleRate and origin is the first frame this node rendered.
//   - A note carries an audio-context time. It maps to a DSP sample index and is
//     applied at the nearest block boundary: at most ±12 DSP samples (±0.25 ms)
//     from the requested time. Output is read with a 4-point Hermite
//     interpolator that is centred on the read position, so resampling adds no
//     delay — only enough DSP look-ahead (2 samples + a block) has to exist.
//   - Notes that arrive after their block was rendered play on the next block if
//     they are under STALE_SEC late, and are dropped otherwise, so a suspended
//     context never resumes into a burst of stale strikes.
//   - Every note carries a generation id. `cancel`/`panic` raise the floor, and
//     queued notes from an older generation are discarded — a stop/rebuild can't
//     leak notes into whatever plays next.

const DSP_RATE = 48000
const BLOCK = 24
const RING = 512                 // DSP samples kept for interpolation (power of 2)
const MASK = RING - 1
const STALE_SEC = 0.05
const MAX_QUEUE = 256
const PROCESSOR_NAME = 'leid-resonator'

class ResonatorHost {
  // exports: the wasm instance's exports; sampleRate: the context rate.
  constructor(exports, sampleRate, { seed = 1, voices = 2, model = 0, patch = null } = {}) {
    this.x = exports
    this.sampleRate = sampleRate
    this.ratio = DSP_RATE / sampleRate
    this.origin = null            // context frame aligned to DSP sample 0
    this.nextBlock = 0            // next DSP block index to render
    this.ringL = new Float32Array(RING)
    this.ringR = new Float32Array(RING)
    this.queue = []               // sorted by (block, seq)
    this.seq = 0
    this.gen = 0
    this.stats = { late: 0, dropped: 0, overflow: 0, cancelled: 0 }

    exports.rs_init(seed >>> 0)
    exports.rs_set_voices(voices)
    exports.rs_set_model(model, 1)
    if (patch) exports.rs_set_patch(patch.structure, patch.brightness, patch.damping, patch.position, 1)
    const mem = exports.memory.buffer
    this.outL = new Float32Array(mem, exports.rs_out_l(), BLOCK)
    this.outR = new Float32Array(mem, exports.rs_out_r(), BLOCK)
  }

  // DSP block a context time lands on (nearest boundary). Before the first render
  // the origin isn't known yet; `frameHint` (the frame about to render) stands in.
  blockForTime(time, frameHint) {
    const origin = this.origin ?? frameHint
    const dspIndex = (time * this.sampleRate - origin) * this.ratio
    return Math.round(dspIndex / BLOCK)
  }

  // Queue a note: { time, midi, velocity, gen }.
  note(msg, frameHint = 0) {
    if ((msg.gen ?? 0) < this.gen) { this.stats.cancelled++; return false }
    if (!Number.isFinite(msg.time) || !Number.isFinite(msg.midi)) return false
    if (this.queue.length >= MAX_QUEUE) { this.stats.overflow++; return false }
    const ev = {
      block: this.blockForTime(msg.time, frameHint),
      seq: this.seq++,
      midi: msg.midi,
      velocity: Number.isFinite(msg.velocity) ? msg.velocity : 1,
      gen: msg.gen ?? 0,
    }
    // Binary insert keeps (block, seq) order; simultaneous notes keep arrival order.
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

  panic(gen) {
    this.cancel(gen ?? this.gen + 1)
    this.x.rs_panic()
  }

  setPatch(p, immediate = false) {
    this.x.rs_set_patch(p.structure, p.brightness, p.damping, p.position, immediate ? 1 : 0)
  }

  setModel(model, immediate = false) { this.x.rs_set_model(model, immediate ? 1 : 0) }
  setVoices(n) { this.x.rs_set_voices(n) }

  _renderBlock() {
    const block = this.nextBlock
    const staleBlocks = (STALE_SEC * DSP_RATE) / BLOCK
    while (this.queue.length && this.queue[0].block <= block) {
      const ev = this.queue.shift()
      if (ev.block < block) {
        if (block - ev.block > staleBlocks) { this.stats.dropped++; continue }
        this.stats.late++
      }
      this.x.rs_trigger(ev.midi, ev.velocity)
    }
    this.x.rs_render()
    const base = block * BLOCK
    for (let i = 0; i < BLOCK; i++) {
      this.ringL[(base + i) & MASK] = this.outL[i]
      this.ringR[(base + i) & MASK] = this.outR[i]
    }
    this.nextBlock++
  }

  // Fill `frames` samples of outL/outR starting at context frame `startFrame`.
  render(outL, outR, frames, startFrame) {
    if (this.origin === null) this.origin = startFrame
    const ratio = this.ratio
    const exact = ratio === 1
    for (let j = 0; j < frames; j++) {
      const p = (startFrame + j - this.origin) * ratio
      const i = Math.floor(p)
      const need = exact ? i : i + 2
      while (this.nextBlock * BLOCK <= need) this._renderBlock()
      if (exact) {
        outL[j] = this.ringL[i & MASK]
        if (outR) outR[j] = this.ringR[i & MASK]
        continue
      }
      const t = p - i
      outL[j] = hermite(this.ringL, i, t)
      if (outR) outR[j] = hermite(this.ringR, i, t)
    }
  }
}

// 4-point, 3rd-order Hermite interpolation of ring[i + t], 0 ≤ t < 1. Before the
// first rendered sample the ring is still zeroed, which reads as silence.
function hermite(ring, i, t) {
  const xm1 = ring[(i - 1) & MASK]
  const x0 = ring[i & MASK]
  const x1 = ring[(i + 1) & MASK]
  const x2 = ring[(i + 2) & MASK]
  const c1 = 0.5 * (x1 - xm1)
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
  return ((c3 * t + c2) * t + c1) * t + x0
}

if (typeof registerProcessor === 'function') {
  // One compiled module per AudioWorkletGlobalScope (= per audio context), keyed
  // by content hash. Every lane gets its own Instance, so its own memory.
  const modules = new Map()
  const DISPOSE_TAIL_BLOCKS = 8    // let the in-DSP panic fade finish (≥ 5 ms)

  class ResonatorProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super()
      const o = options?.processorOptions ?? {}
      this.host = null
      this.disposing = -1
      this.reported = { overflow: 0, dropped: 0 }
      this.port.onmessage = ({ data }) => this.onMessage(data)
      try {
        let mod = modules.get(o.sha256)
        if (!mod) {
          mod = o.module instanceof WebAssembly.Module ? o.module : new WebAssembly.Module(o.bytes)
          modules.set(o.sha256, mod)
        }
        const instance = new WebAssembly.Instance(mod, {})
        this.host = new ResonatorHost(instance.exports, sampleRate, o)
        this.port.postMessage({ type: 'ready' })
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err?.message ?? err) })
      }
    }

    onMessage(m) {
      const h = this.host
      if (!h || !m) return
      switch (m.type) {
        case 'note':   h.note(m, currentFrame); break
        case 'notes':  for (const n of m.notes) h.note(n, currentFrame); break
        case 'patch':  h.setPatch(m, m.immediate); break
        case 'model':  h.setModel(m.model, m.immediate); break
        case 'voices': h.setVoices(m.voices); break
        case 'cancel': h.cancel(m.gen); break
        case 'panic':  h.panic(m.gen); break
        case 'dispose':
          h.panic(m.gen)
          this.disposing = DISPOSE_TAIL_BLOCKS
          break
        case 'stats':  this.port.postMessage({ type: 'stats', stats: { ...h.stats, faults: h.x.rs_fault_count() } }); break
      }
    }

    process(_inputs, outputs) {
      const out = outputs[0]
      if (!this.host || !out?.[0]) return this.disposing !== 0
      this.host.render(out[0], out[1] ?? null, out[0].length, currentFrame)
      const s = this.host.stats
      if (s.overflow > this.reported.overflow || s.dropped > this.reported.dropped) {
        this.reported = { overflow: s.overflow, dropped: s.dropped }
        this.port.postMessage({ type: 'warning', stats: { ...s } })
      }
      if (this.disposing > 0) this.disposing--
      return this.disposing !== 0
    }
  }

  registerProcessor(PROCESSOR_NAME, ResonatorProcessor)
}
