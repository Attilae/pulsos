// Pure map-motion policy (phase 3): note-ring timing and caps, attack
// coalescing, ring-slot assignment and the reduced-motion rules. No Leaflet,
// React or DOM, so the limits are testable.
//
// Every limit here is visual only. Musical events and the event log are never
// dropped or delayed by it.

export const RING = {
  lifeMs: 220,
  fromPx: 12,
  toPx: 28,
  opacity: 0.65,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',   // scale; opacity is linear
}
export const RING_CAP = { desktop: 8, phone: 4 }
// Attacks that reach the screen later than this (a throttled tab, a long task)
// are dropped rather than drawn as history.
export const RING_MAX_LATE_MS = RING.lifeMs
// Reduced motion: the current-stop markers change at most twice a second.
export const CURRENT_STOP_INTERVAL_MS = 500
export const FIT_DURATION_S = 0.25

/** Effective reduction: the OS setting or the user's opt-in. The user can't
 *  turn motion back on over a system "reduce". */
export function effectiveReducedMotion(osReduced, userReduced) {
  return !!(osReduced || userReduced)
}

/** Peak ring opacity for a note velocity (0–1): louder notes read stronger. */
export function ringOpacity(velocity) {
  const v = Number.isFinite(velocity) ? Math.max(0, Math.min(1, velocity)) : 1
  return +(RING.opacity * (0.6 + 0.4 * v)).toFixed(3)
}

/**
 * One flush of note events → at most one ring per lane+stop, at the loudest
 * velocity among them. `locate(ev)` returns `{ stop, color }` for an event with
 * real map geometry, or null (drums, merged chords, unknown stops: no ring;
 * a location is never guessed from a stop name). Keeps first-seen order.
 */
export function coalesceAttacks(events, locate) {
  const byKey = new Map()
  for (const ev of events ?? []) {
    if (ev?.stopId == null || !ev.routeId) continue
    const hit = locate(ev)
    if (!hit?.stop || !Number.isFinite(hit.stop.lat) || !Number.isFinite(hit.stop.lon)) continue
    const key = `${ev.routeId}|${ev.stopId}`
    const velocity = Number.isFinite(ev.velocity) ? ev.velocity : 1
    const prev = byKey.get(key)
    if (prev) prev.velocity = Math.max(prev.velocity, velocity)
    else byKey.set(key, { key, stop: hit.stop, color: hit.color, velocity })
  }
  return [...byKey.values()]
}

/**
 * A fixed pool of ring slots. `take(key, now)` returns the slot to (re)use:
 * the slot already showing this lane+stop if it's still live (one effect per
 * lane+stop), else a free slot, else the oldest live one (replace the oldest
 * visual effect at capacity).
 */
export class RingSlots {
  constructor(capacity, lifeMs = RING.lifeMs) {
    this.capacity = capacity
    this.lifeMs = lifeMs
    this.slots = Array.from({ length: capacity }, () => ({ key: null, startedAt: -Infinity }))
  }
  live(now) {
    return this.slots.filter(s => now - s.startedAt < this.lifeMs).length
  }
  take(key, now) {
    let i = this.slots.findIndex(s => s.key === key && now - s.startedAt < this.lifeMs)
    if (i < 0) i = this.slots.findIndex(s => now - s.startedAt >= this.lifeMs)
    if (i < 0) {
      i = 0
      for (let j = 1; j < this.slots.length; j++) if (this.slots[j].startedAt < this.slots[i].startedAt) i = j
    }
    this.slots[i] = { key, startedAt: now }
    return i
  }
  clear() {
    for (const s of this.slots) { s.key = null; s.startedAt = -Infinity }
  }
}

/** Delay before the next current-stop flush, so changes land ≤ 2 per second. */
export function nextFlushDelay(now, lastFlushAt, interval = CURRENT_STOP_INTERVAL_MS) {
  return Math.max(0, lastFlushAt + interval - now)
}
