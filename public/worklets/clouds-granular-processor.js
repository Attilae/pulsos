// Clouds granular layer: hosts the Clouds-derived grain DSP (public/wasm/
// clouds-granular-*.wasm, built by scripts/build_clouds.js) inside an
// AudioWorklet. lib/cloudsGranularVoice.js is the main-thread half.
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/, and it has no `import`/`export` for the same reason as
// true-peak-limiter.js: standardized-audio-context re-evaluates worklet source
// inside a function body. The host logic is the CloudsHost class, which has no
// globals and is unit-tested from Node (test/clouds-granular-worklet.test.js); the
// processor at the bottom only registers inside an AudioWorklet.
//
// Timing model (same shape as resonator-processor.js):
//   - The DSP runs at 32 kHz in fixed 32-sample blocks (upstream's rate and
//     kMaxBlockSize). DSP sample n is aligned to context frame
//     `origin + n / ratio`, where ratio is 32000 / sampleRate.
//   - A note carries an audio-context time. At the nearest block boundary
//     (±16 DSP samples, ±0.5 ms) it sets the grain pitch and seeds a grain, so
//     the cloud's onset lines up with the lane's envelope, which is scheduled on
//     the main thread against the same clock.
//   - Output is read through a centred 4-point Hermite interpolator, so
//     resampling adds no delay.
//   - Late notes (< STALE_SEC) apply on the next block; older ones are dropped.
//     Every note carries a generation id; `cancel`/`panic` discard older ones.
//   - A new source (already resampled to 32 kHz mono on the main thread) is
//     copied into the module's staging area; the DSP fades the old cloud out,
//     swaps, and fades back in. The copy is bounded (≤ 4 s of samples).

const DSP_RATE = 32000
const BLOCK = 32
const RING = 512                 // DSP samples kept for interpolation (power of 2)
const MASK = RING - 1
const STALE_SEC = 0.05
const MAX_QUEUE = 256
const PROCESSOR_NAME = 'leid-clouds-granular'

class CloudsHost {
  // exports: the wasm instance's exports; sampleRate: the context rate.
  constructor(exports, sampleRate, { seed = 1, params = null, pitch = 0 } = {}) {
    this.x = exports
    this.sampleRate = sampleRate
    this.ratio = DSP_RATE / sampleRate
    this.origin = null
    this.nextBlock = 0
    this.ringL = new Float32Array(RING)
    this.ringR = new Float32Array(RING)
    this.queue = []
    this.seq = 0
    this.gen = 0
    this.stats = { late: 0, dropped: 0, overflow: 0, cancelled: 0 }

    exports.cg_init(seed >>> 0)
    if (params) this.setParams(params)
    exports.cg_set_pitch(pitch)
    const mem = exports.memory.buffer
    this.maxSource = exports.cg_max_source()
    this.staging = new Float32Array(mem, exports.cg_staging(), this.maxSource)
    this.outL = new Float32Array(mem, exports.cg_out_l(), BLOCK)
    this.outR = new Float32Array(mem, exports.cg_out_r(), BLOCK)
  }

  blockForTime(time, frameHint) {
    const origin = this.origin ?? frameHint
    const dspIndex = (time * this.sampleRate - origin) * this.ratio
    return Math.round(dspIndex / BLOCK)
  }

  // Queue a note: { time, semis, gen }.
  note(msg, frameHint = 0) {
    if ((msg.gen ?? 0) < this.gen) { this.stats.cancelled++; return false }
    if (!Number.isFinite(msg.time) || !Number.isFinite(msg.semis)) return false
    if (this.queue.length >= MAX_QUEUE) { this.stats.overflow++; return false }
    const ev = { block: this.blockForTime(msg.time, frameHint), seq: this.seq++, semis: msg.semis, gen: msg.gen ?? 0 }
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
    this.x.cg_panic()
  }

  // Retune immediately (drone root changes), without seeding a grain.
  setPitch(semis) {
    if (Number.isFinite(semis)) this.x.cg_set_pitch(semis)
  }

  setParams(p) {
    this.x.cg_set_params(
      p.size, p.density, p.scanRate, p.winStart, p.winEnd,
      p.jitter, p.windowShape, p.spread, p.reverse ? 1 : 0,
    )
  }

  // samples: Float32Array at 32 kHz, mono. Returns the length actually loaded.
  loadSource(samples, immediate = false) {
    const len = Math.min(samples.length, this.maxSource)
    this.staging.set(len === samples.length ? samples : samples.subarray(0, len))
    this.x.cg_load(len, immediate ? 1 : 0)
    return { len, cropped: samples.length > len }
  }

  _renderBlock() {
    const block = this.nextBlock
    const staleBlocks = (STALE_SEC * DSP_RATE) / BLOCK
    while (this.queue.length && this.queue[0].block <= block) {
      const ev = this.queue.shift()
      if (ev.block < block) {
        if (block - ev.block > staleBlocks) { this.stats.dropped++; continue }
        this.stats.late++
      }
      this.x.cg_set_pitch(ev.semis)
      this.x.cg_trigger()
    }
    this.x.cg_render()
    const base = block * BLOCK
    for (let i = 0; i < BLOCK; i++) {
      this.ringL[(base + i) & MASK] = this.outL[i]
      this.ringR[(base + i) & MASK] = this.outR[i]
    }
    this.nextBlock++
  }

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
  const modules = new Map()
  const DISPOSE_TAIL_BLOCKS = 8    // let the in-DSP fade finish (≥ 5 ms)

  class CloudsGranularProcessor extends AudioWorkletProcessor {
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
        this.host = new CloudsHost(instance.exports, sampleRate, o)
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
        case 'pitch':  h.setPitch(m.semis); break
        case 'params': h.setParams(m.params); break
        case 'source': {
          const r = h.loadSource(m.samples, !!m.immediate)
          this.port.postMessage({ type: 'source', id: m.id, ...r })
          break
        }
        case 'cancel': h.cancel(m.gen); break
        case 'panic':  h.panic(m.gen); break
        case 'dispose':
          h.panic(m.gen)
          this.disposing = DISPOSE_TAIL_BLOCKS
          break
        case 'stats':
          this.port.postMessage({ type: 'stats', stats: { ...h.stats, faults: h.x.cg_fault_count(), grains: h.x.cg_active_grains() } })
          break
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

  registerProcessor(PROCESSOR_NAME, CloudsGranularProcessor)
}
