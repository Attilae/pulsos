// Lookahead true-peak brickwall limiter for the master bus (lib/masterBus.js).
//
// Served as-is from /worklets/ and loaded with audioWorklet.addModule, so it can't
// import from lib/. The DSP is the TruePeakLimiter class, which has no globals and
// is unit-tested from Node (test/true-peak-limiter.test.js); the processor at the
// bottom only registers when running inside an AudioWorklet.
//
// No `export`/`import` here: Tone's context is a standardized-audio-context, which
// fetches the source and re-evaluates it wrapped inside a function body, where a
// top-level `export` is a syntax error and the module never registers. The test
// evaluates it the same way.
//
// Algorithm (per sample, stereo-linked):
//   1. True-peak detect: max |x| over the sample itself and three interpolated
//      points between it and the next one (4× oversampling, windowed-sinc FIR).
//      A plain sample-peak limiter lets inter-sample peaks through, and those
//      clip later in the DAC or in a lossy encoder.
//   2. Required gain g = min(1, ceiling / peak).
//   3. Hold: minimum of g over the last L samples (monotonic deque, O(1)).
//   4. Release: recover towards the held value with a one-pole curve; attack is
//      instant here because step 5 smooths it.
//   5. Smooth: moving average over L samples.
//   6. Output the input delayed by L-1 samples, times the smoothed gain.
// Why it can't overshoot: for a peak detected at index p, every held value in
// [p, p+L-1] is ≤ g[p], so the average that lands on x[p] at output time is too.
// The gain ramps down over the L samples *before* the peak, not after it.

const PHASES = [0.25, 0.5, 0.75]

// Windowed-sinc fractional-delay taps. HALF taps either side of the interpolated
// point; normalised to unity DC gain.
function interpolationKernels(half) {
  return PHASES.map(frac => {
    const taps = new Float64Array(2 * half)
    let sum = 0
    for (let j = 0; j < 2 * half; j++) {
      const t = j - (half - 1) - frac          // distance from the interpolated point
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
      const w = 0.5 * (1 + Math.cos((Math.PI * t) / half))  // Hann over ±half
      taps[j] = sinc * w
      sum += taps[j]
    }
    for (let j = 0; j < taps.length; j++) taps[j] /= sum
    return taps
  })
}

class TruePeakLimiter {
  constructor({ sampleRate, channels = 2, ceilingDb = -1, lookaheadMs = 5, releaseMs = 80, firHalf = 8 }) {
    this.channels = channels
    this.half = firHalf
    this.kernels = interpolationKernels(firHalf)
    this.lookahead = Math.max(2, Math.round((lookaheadMs / 1000) * sampleRate))
    // Samples between an input arriving and it leaving: the FIR needs `half` future
    // samples before it can judge a point, then the lookahead window.
    this.latency = this.half + this.lookahead - 1

    let size = 1
    while (size < this.latency + 2 * this.half + 2) size <<= 1
    this.mask = size - 1
    this.hist = Array.from({ length: channels }, () => new Float32Array(size))
    this.n = 0                                   // input samples consumed

    const L = this.lookahead
    this.dqVal = new Float64Array(L + 1)
    this.dqIdx = new Float64Array(L + 1)
    this.dqHead = 0
    this.dqLen = 0
    this.box = new Float64Array(L).fill(1)
    this.boxPos = 0
    this.boxSum = L
    this.env = 1

    this.setCeilingDb(ceilingDb)
    this.setReleaseMs(releaseMs, sampleRate)
    this.minGain = 1                             // lowest gain since the last read
  }

  setCeilingDb(db) {
    this.ceiling = Math.pow(10, db / 20)
  }

  setReleaseMs(ms, sampleRate) {
    this.releaseCoef = 1 - Math.exp(-1 / Math.max(1e-6, (ms / 1000) * sampleRate))
  }

  // Lowest applied gain since the previous call, in dB (≤ 0).
  takeReductionDb() {
    const g = this.minGain
    this.minGain = 1
    return 20 * Math.log10(Math.max(g, 1e-6))
  }

  _peakAt(c) {
    const { hist, mask, half, kernels } = this
    let peak = 0
    for (let ch = 0; ch < this.channels; ch++) {
      const h = hist[ch]
      const s = Math.abs(h[c & mask])
      if (s > peak) peak = s
      for (let k = 0; k < kernels.length; k++) {
        const taps = kernels[k]
        let acc = 0
        const base = c - (half - 1)
        for (let j = 0; j < taps.length; j++) acc += taps[j] * h[(base + j) & mask]
        const a = Math.abs(acc)
        if (a > peak) peak = a
      }
    }
    return peak
  }

  // inputs/outputs: arrays of per-channel Float32Array of length `frames`. A
  // missing input channel is treated as silence (mono sources are upmixed by the
  // node's channelCountMode before they get here).
  process(inputs, outputs, frames) {
    const { hist, mask, half, lookahead: L, channels } = this
    for (let i = 0; i < frames; i++) {
      const n = this.n
      for (let ch = 0; ch < channels; ch++) hist[ch][n & mask] = inputs[ch] ? inputs[ch][i] : 0

      // 1–2. Judge the point `half` samples back, now that its future is known.
      const c = n - half
      const peak = this._peakAt(c)
      const g = peak > this.ceiling ? this.ceiling / peak : 1

      // 3. Sliding-window minimum over [c-L+1, c].
      while (this.dqLen > 0) {
        const last = (this.dqHead + this.dqLen - 1) % (L + 1)
        if (this.dqVal[last] >= g) this.dqLen--
        else break
      }
      const tail = (this.dqHead + this.dqLen) % (L + 1)
      this.dqVal[tail] = g
      this.dqIdx[tail] = c
      this.dqLen++
      if (this.dqIdx[this.dqHead] <= c - L) { this.dqHead = (this.dqHead + 1) % (L + 1); this.dqLen-- }
      const held = this.dqVal[this.dqHead]

      // 4. Instant attack, one-pole release.
      this.env = held < this.env ? held : this.env + (held - this.env) * this.releaseCoef

      // 5. Moving average over L. Rebuilt once per lap so float error can't drift.
      this.boxSum += this.env - this.box[this.boxPos]
      this.box[this.boxPos] = this.env
      this.boxPos++
      if (this.boxPos === L) {
        this.boxPos = 0
        let s = 0
        for (let j = 0; j < L; j++) s += this.box[j]
        this.boxSum = s
      }
      const gain = this.boxSum / L
      if (gain < this.minGain) this.minGain = gain

      // 6. Delayed output, with a final clamp against rounding.
      const out = n - this.latency
      const ceil = this.ceiling
      for (let ch = 0; ch < channels; ch++) {
        if (!outputs[ch]) continue
        let y = hist[ch][out & mask] * gain
        if (y > ceil) y = ceil
        else if (y < -ceil) y = -ceil
        outputs[ch][i] = y
      }
      this.n = n + 1
    }
  }
}

const PROCESSOR_NAME = 'leid-true-peak-limiter'

if (typeof registerProcessor === 'function') {
  const REPORT_SEC = 0.1

  class TruePeakLimiterProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super()
      const o = options?.processorOptions ?? {}
      this.limiter = new TruePeakLimiter({ sampleRate, channels: 2, ...o })
      this.sinceReport = 0
      this.port.onmessage = ({ data }) => {
        if (data?.ceilingDb != null) this.limiter.setCeilingDb(data.ceilingDb)
        if (data?.releaseMs != null) this.limiter.setReleaseMs(data.releaseMs, sampleRate)
      }
      this.port.postMessage({ latency: this.limiter.latency })
    }

    process(inputs, outputs) {
      const out = outputs[0]
      const frames = out[0]?.length ?? 128
      this.limiter.process(inputs[0] ?? [], out, frames)
      this.sinceReport += frames
      if (this.sinceReport >= REPORT_SEC * sampleRate) {
        this.sinceReport = 0
        this.port.postMessage({ reductionDb: this.limiter.takeReductionDb() })
      }
      return true
    }
  }

  registerProcessor(PROCESSOR_NAME, TruePeakLimiterProcessor)
}
