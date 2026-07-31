// SongChainPlayer — walks an ordered chain of preset snapshots on a single
// TransitEngine, playing each for a fixed number of bars then advancing.
//
// Timing model: each section configures the engine from its preset snapshot and
// calls engine.startMock (which resets + restarts Tone.Transport at 0), so the
// "section" is just "play this snapshot for `bars` bars, then swap to the next".
// Boundaries are driven by wall-clock timers — NOT Tone.Transport.schedule —
// because engine.stopMock() calls Tone.Transport.cancel(), which would drop any
// transport-scheduled callbacks.
//
// Transitions (per item, applied as the item is entered):
//   'cut'       → instant swap with a tiny declick fade
//   'crossfade' → master "dip": fade the outgoing tail to silence over the
//                 incoming item's crossfade window, swap, then fade back in.
//                 (A true overlapping crossfade would need per-engine master
//                  gains + a second engine — left as a follow-up.)

import * as Tone from 'tone'
import { playSnapshotOnEngine, prefetchSnapshotSamples } from './snapshotPlayer.js'

const DECLICK_SEC = 0.04

export class SongChainPlayer {
  // loadSnapshot: async (presetId) => snapshot | null   (caller caches)
  constructor(engine, routes, loadSnapshot) {
    this.engine = engine
    this.routes = routes
    this.loadSnapshot = loadSnapshot
    this.items = []
    this.bpm = 120
    this._loop = false
    this.activeLaneLimit = null

    this._timers = []
    this._raf = 0
    this._preloaded = new Set()   // presetIds already warmed (snapshot + samples)
    this._stopped = true
    this._playing = false
    this._sectionSec = 0
    this._sectionStartMs = 0

    this.onAdvance = null   // (itemIndex) — itemIndex -1 when playback ends
    this.onProgress = null  // (fraction 0..1 within the current section)
  }

  setChain(items, bpm) {
    this.items = Array.isArray(items) ? items : []
    if (typeof bpm === 'number') this.bpm = bpm
  }

  setRoutes(routes) { this.routes = routes }
  setActiveLaneLimit(limit) { this.activeLaneLimit = limit }
  setLoop(on) { this._loop = !!on }

  get playing() { return this._playing }

  // ── Preloading ────────────────────────────────────────────────────────────
  // An item costs two loads before it can make a sound: its snapshot JSON (the
  // caller's cache) and the samples its Sampler/Drums lanes need. Only the second
  // one is audible — Tone.Sampler silently drops notes until its zone map is
  // decoded, and every item boundary rebuilds the whole audio graph from scratch.
  // Warming both ahead of the boundary is what makes the swap gapless.

  // Warm one item. Safe to call repeatedly; both layers de-duplicate.
  preload(presetId) {
    if (!presetId || this._preloaded.has(presetId)) return Promise.resolve()
    this._preloaded.add(presetId)
    return this.loadSnapshot(presetId)
      .then(snap => (snap ? prefetchSnapshotSamples(snap) : null))
      .catch(() => { this._preloaded.delete(presetId) })
  }

  // Warm the whole chain, one item at a time so the item about to play gets the
  // bandwidth first. Call when the chain changes — that's the idle time, and it's
  // the only way the *first* section is warm too (play() enters it immediately).
  preloadChain() {
    return this.items.reduce(
      (p, item) => p.then(() => this.preload(item.presetId)),
      Promise.resolve(),
    )
  }

  async play() {
    if (!this.engine || !this.items.length) return
    this.stop()
    this._stopped = false
    await this.engine.start?.()          // resume AudioContext (Tone.start)
    if (this._stopped) return
    this._startProgressLoop()
    await this._enter(0)
  }

  stop() {
    this._stopped = true
    this._playing = false
    for (const t of this._timers) clearTimeout(t)
    this._timers = []
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0 }
    try { Tone.getDestination().volume.rampTo(-80, 0.08) } catch {}
    try { this.engine?.stopMock?.() } catch {}
    this.onProgress?.(0)
  }

  // Fade used when entering an item (also the fade-out window for the tail
  // preceding it): crossfade items use their bar-based window, cuts declick.
  _enterFadeSec(item) {
    if (item && item.transition === 'crossfade') {
      const bars = item.crossfadeBars ?? 1
      return Math.max(0.05, (bars * 4 * 60) / this.bpm)
    }
    return DECLICK_SEC
  }

  async _enter(i) {
    const item = this.items[i]
    if (!item) { this._end(); return }

    const snap = await this.loadSnapshot(item.presetId).catch(() => null)
    if (this._stopped) return
    if (!snap) {                          // missing preset → skip ahead
      this._advanceFrom(i)
      return
    }

    if (this._playing) { try { this.engine.stopMock() } catch {} }
    const s = snap.state ?? snap
    const target = s.masterVolume ?? 0

    playSnapshotOnEngine(this.engine, snap, this.routes, { bpm: this.bpm, activeLaneLimit: this.activeLaneLimit })
    this._playing = true

    const fade = this._enterFadeSec(item)
    try {
      Tone.getDestination().volume.value = -80
      Tone.getDestination().volume.rampTo(target, fade)
    } catch {}

    this._sectionSec = (item.bars * 4 * 60) / this.bpm
    this._sectionStartMs = performance.now()
    this.onAdvance?.(i)
    this._scheduleBoundary(i)
  }

  _scheduleBoundary(i) {
    const next = i + 1
    const isLast = next >= this.items.length
    const nextItem = isLast ? (this._loop ? this.items[0] : null) : this.items[next]

    // Preload the upcoming item during this section — both its snapshot JSON and
    // its samples. The samples are the part that used to be audible: a fresh
    // Tone.Sampler drops every note until its zone map finishes downloading, so
    // an un-warmed sampler lane starts its section silent. See lib/sampleCache.js.
    if (nextItem) this.preload(nextItem.presetId)

    const sectionMs = this._sectionSec * 1000
    const fadeOutSec = nextItem ? this._enterFadeSec(nextItem) : 0.12

    // Begin the tail fade so it lands on the boundary.
    const fadeStartMs = Math.max(0, sectionMs - fadeOutSec * 1000)
    this._timers.push(setTimeout(() => {
      if (this._stopped) return
      try { Tone.getDestination().volume.rampTo(-80, fadeOutSec) } catch {}
    }, fadeStartMs))

    // At the boundary, advance (or end).
    this._timers.push(setTimeout(() => {
      if (this._stopped) return
      this._advanceFrom(i)
    }, sectionMs))
  }

  _advanceFrom(i) {
    const next = i + 1
    if (next < this.items.length) { this._enter(next); return }
    if (this._loop && this.items.length) { this._enter(0); return }
    this._end()
  }

  _end() {
    this.stop()
    this.onAdvance?.(-1)
  }

  _startProgressLoop() {
    const tick = () => {
      if (this._stopped) return
      const elapsed = performance.now() - this._sectionStartMs
      const frac = this._sectionSec > 0 ? Math.min(1, elapsed / (this._sectionSec * 1000)) : 0
      this.onProgress?.(frac)
      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }
}
