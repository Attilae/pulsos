// Browser-only mobile/tablet detection for the mobile gate. The DAW is a
// desktop instrument (heavy Web Audio graph, ~22 MB per-city route data,
// hover-driven UI), so all touch devices — phones AND tablets — are gated.
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac — distinguish by touch points
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true
  // fallback: coarse-pointer-only devices (Android tablets with odd UAs)
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(pointer: coarse)').matches
    && !window.matchMedia?.('(pointer: fine)').matches
}
