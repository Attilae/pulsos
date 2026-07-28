// Browser-only platform detection. Kept deliberately small: layout decisions go
// through useViewport.js (media queries), and this file answers only the
// questions a media query genuinely cannot — "is this WebKit on iOS?" (which
// changes how we have to unlock audio) and "roughly what kind of device is
// this?" (for analytics).
//
// Replaces the old lib/shared/isMobileDevice.js, which existed to gate touch
// devices out of the app entirely.

export function isTouchDevice() {
  if (typeof navigator === 'undefined') return false
  if (navigator.maxTouchPoints > 0) return true
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(pointer: coarse)').matches
}

/**
 * iOS/iPadOS Safari (and every iOS browser, since they all run WebKit).
 * Matters because iOS routes Web Audio through an "ambient" audio session that
 * the hardware ring/silent switch mutes — see lib/audioSession.js.
 */
export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac — distinguish by touch points.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
}

/** 'phone' | 'tablet' | 'desktop' — coarse, for analytics dimensions only. */
export function formFactor() {
  if (typeof window === 'undefined') return 'desktop'
  const w = window.innerWidth
  if (w < 768) return 'phone'
  if (isTouchDevice() && w < 1280) return 'tablet'
  return 'desktop'
}
