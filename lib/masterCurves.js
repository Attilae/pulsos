// Pure transfer curves for the master bus WaveShapers (lib/masterBus.js). Kept out
// of that module so they can be tested without Tone.js.

// The shapers take input in ±1; anything beyond clamps to the curve's end. They are
// fed through a ×0.5 pre-gain so the curve spans ±2 (+6 dBFS) and overshoots are
// shaped rather than hard-clamped.
export const SHAPER_SPAN = 2
export const SHAPER_LEN = 4096

// Saturation: y = (1-m)·x + m·tanh(k·x)/k. Unity gain at low levels (tanh(kx)/k ≈ x),
// so only peaks change. Blending inside a single curve rather than as a parallel
// dry/wet pair matters: the oversampled WaveShaper adds a few samples of latency,
// and a dry path beside it would comb-filter the top end.
export function saturationCurve({ drive, mix }, len = SHAPER_LEN) {
  const curve = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const x = ((i / (len - 1)) * 2 - 1) * SHAPER_SPAN
    curve[i] = (1 - mix) * x + mix * (Math.tanh(drive * x) / drive)
  }
  return curve
}

// Soft clipper: linear up to `knee`, then eases towards `ceiling` with tanh. The
// last line of defence behind the limiter, which (being a DynamicsCompressorNode)
// can't guarantee a ceiling on fast transients.
export function clipperCurve({ knee, ceiling }, len = SHAPER_LEN) {
  const curve = new Float32Array(len)
  const room = ceiling - knee
  for (let i = 0; i < len; i++) {
    const x = ((i / (len - 1)) * 2 - 1) * SHAPER_SPAN
    const a = Math.abs(x)
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room)
    curve[i] = Math.sign(x) * y
  }
  return curve
}
