// Float → 16-bit PCM conversion for WAV export (lib/audioExport.js). Pure, so it's
// testable without the browser.
//
// TPDF dither: add the difference of two uniform randoms (a triangular ±1 LSB
// distribution) before rounding. Plain truncation turns the quantisation error
// into distortion correlated with the signal, audible on reverb tails and fades;
// dither swaps it for a constant, far quieter noise floor (~-96 dBFS).
export function floatToPcm16(sample, rand = Math.random) {
  const s = Math.max(-1, Math.min(1, sample))
  const v = Math.round(s * 32767 + (rand() - rand()))
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v
}
