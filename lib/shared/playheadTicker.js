// One requestAnimationFrame loop shared by every on-screen playhead.
//
// Each lane's stop rail, automation rail and the drum lane used to run its own
// rAF, so a 12-lane song paid for 15-20 callbacks per frame. Subscribers are
// called in insertion order from a single frame callback, and the loop stops
// itself when the last subscriber leaves.
//
// Subscribers should only touch the DOM (refs, classList, style.transform),
// never React state: a setState here re-renders at display rate.

const subscribers = new Set()
let rafId = 0

function frame(now) {
  rafId = requestAnimationFrame(frame)
  for (const fn of subscribers) {
    try { fn(now) } catch (err) { console.error('[playheadTicker]', err) }
  }
}

/** Register a per-frame callback; returns an unsubscribe function. */
export function subscribePlayhead(fn) {
  subscribers.add(fn)
  if (!rafId) rafId = requestAnimationFrame(frame)
  return () => {
    subscribers.delete(fn)
    if (!subscribers.size && rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }
}
