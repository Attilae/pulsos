// Macro lane instrument: hosts the Plaits-derived DSP (public/wasm/macro-*.wasm,
// built by scripts/build_macro.js) inside an AudioWorklet. lib/macroVoice.js is
// the main-thread half.
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/, and it has no `import`/`export` for the same reason as
// true-peak-limiter.js: standardized-audio-context re-evaluates worklet source
// inside a function body. The host logic is the MacroHost class, which has no
// globals and is unit-tested from Node (test/macro-worklet.test.js); the
// processor at the bottom only registers inside an AudioWorklet.
//
// Timing model (the same as resonator-processor.js, plus a latency offset):
//   - The DSP runs at 48 kHz in fixed 12-sample blocks (upstream's cadence).
//     DSP sample n is aligned to context frame `origin + n / ratio`, where ratio
//     is 48000 / sampleRate and origin is the first frame this node rendered.
//   - Upstream reads TRIG through a delay line, so a note sounds
//     mc_trigger_latency() DSP samples (48, 1 ms) after the block it was set on.
//     Notes and releases are therefore applied that much earlier than their
//     timestamp, which puts the audible onset on the timestamp.
//   - A note maps to a DSP sample index and is applied at the nearest block
//     boundary: at most ±6 DSP samples (±0.125 ms) from the requested time.
//     Output is read with a 4-point Hermite interpolator centred on the read
//     position, so resampling adds no delay.
//   - Notes that arrive after their block was rendered play on the next block if
//     they are under STALE_SEC late, and are dropped otherwise, so a suspended
//     context never resumes into a burst of stale notes. A late release is never
//     dropped, or the note it ends would hold forever.
//   - Every note carries a generation id. `cancel`/`panic` raise the floor, and
//     queued notes from an older generation are discarded: a stop/rebuild can't
//     leak notes into whatever plays next.
//   - The DSP output is mono; both output channels carry it and the lane's
//     panner places it.

const DSP_RATE = 48000
const BLOCK = 12
const RING = 512                 // DSP samples kept for interpolation (power of 2)
const MASK = RING - 1
const STALE_SEC = 0.05
const MAX_QUEUE = 256
const PROCESSOR_NAME = 'leid-macro'

class MacroHost {
  // exports: the wasm instance's exports; sampleRate: the context rate.
  constructor(exports, sampleRate, { seed = 1, voices = 2, engine = 8, patch = null, aux = 0 } = {}) {
    this.x = exports
    this.sampleRate = sampleRate
    this.ratio = DSP_RATE / sampleRate
    this.origin = null            // context frame aligned to DSP sample 0
    this.nextBlock = 0            // next DSP block index to render
    this.ring = new Float32Array(RING)
    this.queue = []               // sorted by (block, seq)
    this.seq = 0
    this.gen = 0
    this.stats = { late: 0, dropped: 0, overflow: 0, cancelled: 0 }

    exports.mc_init(seed >>> 0)
    exports.mc_set_voices(voices)
    exports.mc_set_engine(engine, 1)
    if (patch) this.setPatch(patch, true)
    exports.mc_set_aux(aux)
    this.latency = exports.mc_trigger_latency()
    const mem = exports.memory.buffer
    this.out = new Float32Array(mem, exports.mc_out(), BLOCK)
  }

  // DSP block whose trigger edge sounds at `time` (nearest boundary). Before the
  // first render the origin isn't known yet; `frameHint` (the frame about to
  // render) stands in.
  blockForTime(time, frameHint) {
    const origin = this.origin ?? frameHint
    const dspIndex = (time * this.sampleRate - origin) * this.ratio - this.latency
    return Math.round(dspIndex / BLOCK)
  }

  // Queue a note: { time, midi, velocity, gen, hold? } — hold in seconds.
  note(msg, frameHint = 0) {
    if (!Number.isFinite(msg.midi)) return false
    const hold = Number.isFinite(msg.hold) && msg.hold >= 0
      ? Math.max(1, Math.min(0x7fffffff, Math.round(msg.hold * DSP_RATE)))
      : -1
    return this._enqueue(msg, frameHint, {
      kind: 'note',
      midi: msg.midi,
      velocity: Number.isFinite(msg.velocity) ? msg.velocity : 1,
      hold,
    })
  }

  // Queue a note-off: { time, midi, gen } — midi null/absent releases every voice.
  release(msg, frameHint = 0) {
    return this._enqueue(msg, frameHint, {
      kind: 'release',
      midi: Number.isFinite(msg.midi) ? msg.midi : -1,
    })
  }

  _enqueue(msg, frameHint, fields) {
    if ((msg.gen ?? 0) < this.gen) { this.stats.cancelled++; return false }
    if (!Number.isFinite(msg.time)) return false
    if (this.queue.length >= MAX_QUEUE) { this.stats.overflow++; return false }
    const ev = {
      block: this.blockForTime(msg.time, frameHint),
      seq: this.seq++,
      gen: msg.gen ?? 0,
      ...fields,
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
    this.x.mc_panic()
  }

  // { harmonics, timbre, morph, fmAmount, timbreAmount, morphAmount, decay,
  //   colour, transpose } — see macroPatch() in lib/macroSpecs.js.
  setPatch(p, immediate = false) {
    this.x.mc_set_patch(
      +p.harmonics, +p.timbre, +p.morph, +p.fmAmount, +p.timbreAmount, +p.morphAmount,
      +p.decay, +p.colour, +p.transpose, immediate ? 1 : 0,
    )
  }

  setEngine(engine, immediate = false) { this.x.mc_set_engine(engine, immediate ? 1 : 0) }
  setVoices(n) { this.x.mc_set_voices(n) }
  setAux(mix) { this.x.mc_set_aux(+mix) }

  _renderBlock() {
    const block = this.nextBlock
    const staleBlocks = (STALE_SEC * DSP_RATE) / BLOCK
    while (this.queue.length && this.queue[0].block <= block) {
      const ev = this.queue.shift()
      if (ev.block < block) {
        if (ev.kind !== 'release' && block - ev.block > staleBlocks) { this.stats.dropped++; continue }
        this.stats.late++
      }
      if (ev.kind === 'release') this.x.mc_release(ev.midi)
      else this.x.mc_trigger_held(ev.midi, ev.velocity, ev.hold)
    }
    this.x.mc_render()
    const base = block * BLOCK
    for (let i = 0; i < BLOCK; i++) this.ring[(base + i) & MASK] = this.out[i]
    this.nextBlock++
  }

  // Fill `frames` samples of outL (and outR, the same signal) starting at
  // context frame `startFrame`.
  render(outL, outR, frames, startFrame) {
    if (this.origin === null) this.origin = startFrame
    const ratio = this.ratio
    const exact = ratio === 1
    for (let j = 0; j < frames; j++) {
      const p = (startFrame + j - this.origin) * ratio
      const i = Math.floor(p)
      const need = exact ? i : i + 2
      while (this.nextBlock * BLOCK <= need) this._renderBlock()
      outL[j] = exact ? this.ring[i & MASK] : hermite(this.ring, i, p - i)
    }
    if (outR) outR.set(outL.subarray(0, frames))
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

  class MacroProcessor extends AudioWorkletProcessor {
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
        this.host = new MacroHost(instance.exports, sampleRate, o)
        this.port.postMessage({ type: 'ready' })
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String(err?.message ?? err) })
      }
    }

    onMessage(m) {
      const h = this.host
      if (!h || !m) return
      switch (m.type) {
        case 'note':    h.note(m, currentFrame); break
        case 'notes':   for (const n of m.notes) h.note(n, currentFrame); break
        case 'release': h.release(m, currentFrame); break
        case 'patch':   h.setPatch(m, m.immediate); break
        case 'engine':  h.setEngine(m.engine, m.immediate); break
        case 'voices':  h.setVoices(m.voices); break
        case 'aux':     h.setAux(m.aux); break
        case 'cancel':  h.cancel(m.gen); break
        case 'panic':   h.panic(m.gen); break
        case 'dispose':
          h.panic(m.gen)
          this.disposing = DISPOSE_TAIL_BLOCKS
          break
        case 'stats':   this.port.postMessage({ type: 'stats', stats: { ...h.stats, faults: h.x.mc_fault_count() } }); break
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

  registerProcessor(PROCESSOR_NAME, MacroProcessor)
}
