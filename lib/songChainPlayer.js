// SongChainPlayer — walks an ordered chain of preset snapshots, playing each for a
// fixed number of bars then advancing.
//
// Timing model: ONE continuously-running Tone.Transport, and TWO TransitEngines
// handed off A→B→A across item boundaries.
//
// Why two engines. A section costs ~120 ms of blocking work to build (measured:
// ~55 ms of FX buses, ~25 ms of synths, ~11 ms of Parts, plus teardown). Done *at*
// the boundary — which is what a single engine forces, since it must tear its graph
// down before it can build the next one — that is 120 ms of dead air every time,
// on top of whatever fades bracket it. Instead each section is built on the idle
// engine one PREPARE_LEAD ahead of its boundary and its Parts are anchored to the
// boundary's Transport time (engine.startMock's `startAt`), so they are already
// scheduled and simply begin sounding when the transport arrives. Nothing blocking
// happens at the boundary at all; the outgoing engine is torn down *after* it, under
// the incoming one, so its tail rings out instead of being cut.
//
// Two engine invariants this leans on, both opt-in so MixerTab is unaffected:
//   - stopMock({keepTransport:true}) — a plain stopMock() calls Transport.cancel(),
//     which would wipe the *other* engine's already-scheduled Parts.
//   - startMock(..., {startAt}) — Parts loop from that anchor, so a section still
//     starts at its own loop origin wherever the shared transport happens to be.
//
// Boundaries are still driven by wall-clock setTimeout rather than
// Tone.Transport.schedule: they only sequence bookkeeping (prepare the next engine,
// retire the old one), never anything that has to be sample-accurate.
//
// Transitions (per item, applied as the item is entered):
//   'cut'       → the outgoing engine declicks out under the incoming one
//   'crossfade' → the outgoing engine fades over the incoming item's crossfade
//                 window while the incoming one plays through it — a real
//                 overlapping crossfade, not the master dip this used to do.

import * as Tone from 'tone'
import { playSnapshotOnEngine, prefetchSnapshotSamples } from './snapshotPlayer.js'

const DECLICK_SEC = 0.04

// How far ahead of a boundary the next section is built. Long enough that the
// build's main-thread cost lands nowhere near the boundary, short enough that a
// chain edit mid-playback is still picked up for all but the imminent section.
const PREPARE_LEAD_SEC = 1.5

// Lead-in for section 0 only. It is the one section with nothing already playing
// to be built behind, so the transport has to be given enough runway to still be
// short of its anchor once the build finishes — comfortably over the ~120ms a
// section costs to build, or section 0 starts partway into its own loop.
const FIRST_SECTION_LEAD_SEC = 0.35

export class SongChainPlayer {
  // engines: [engineA, engineB] — two TransitEngines to hand off between. A single
  // engine is accepted for compatibility but gives up gapless swapping.
  // loadSnapshot: async (presetId) => snapshot | null   (caller caches)
  constructor(engines, routes, loadSnapshot) {
    this._engines = Array.isArray(engines) ? engines.filter(Boolean) : [engines].filter(Boolean)
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
    this._live = []               // engines currently holding a scheduled/sounding section
    this._nextEngineIdx = 0
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
  // decoded — and it has to be resolved before the section is *built*, which now
  // happens PREPARE_LEAD_SEC before the boundary rather than at it.

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

  // ── Transport ─────────────────────────────────────────────────────────────

  async play() {
    if (!this._engines.length || !this.items.length) return
    this.stop()
    this._stopped = false
    await this._engines[0].start?.()     // resume AudioContext (Tone.start)
    if (this._stopped) return

    Tone.Transport.bpm.value = this.bpm
    Tone.Transport.position = 0
    Tone.Transport.start()
    this._nextEngineIdx = 0

    this._startProgressLoop()
    await this._enter(0, Tone.Transport.seconds + FIRST_SECTION_LEAD_SEC)
  }

  stop() {
    this._stopped = true
    this._playing = false
    for (const t of this._timers) clearTimeout(t)
    this._timers = []
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0 }
    for (const engine of this._engines) {
      try { engine?.getMasterGain?.()?.gain.cancelScheduledValues(Tone.now()) } catch {}
      try { engine?.stopMock?.() } catch {}
      try { engine?.getMasterGain?.()?.gain.setValueAtTime(1, Tone.now()) } catch {}
    }
    this._live = []
    this.onProgress?.(0)
  }

  // How long the outgoing engine keeps sounding past a boundary before it's torn
  // down: a declick for a cut, the incoming item's window for a crossfade.
  _tailSec(incomingItem) {
    if (incomingItem && incomingItem.transition === 'crossfade') {
      const bars = incomingItem.crossfadeBars ?? 1
      return Math.max(0.05, (bars * 4 * 60) / this.bpm)
    }
    return DECLICK_SEC
  }

  // Build item `i` on the idle engine, anchored to Transport time `startAt`, and
  // schedule everything that has to happen around its boundary. Returns once the
  // section is scheduled — it does not wait for it to start sounding.
  async _enter(i, startAt) {
    const item = this.items[i]
    if (!item) { this._end(); return }

    const snap = await this.loadSnapshot(item.presetId).catch(() => null)
    if (this._stopped) return
    if (!snap) {                          // missing preset → skip ahead
      this._advanceFrom(i, startAt)
      return
    }
    // The build below reads decoded samples straight out of the cache; without this
    // its Samplers would come up empty and the section would open silent.
    await prefetchSnapshotSamples(snap)
    if (this._stopped) return

    const engine = this._takeEngine()
    const s = snap.state ?? snap
    const gain = engine.getMasterGain?.()
    if (gain) {
      try {
        gain.gain.cancelScheduledValues(Tone.now())
        gain.gain.setValueAtTime(1, Tone.now())
      } catch {}
    }

    playSnapshotOnEngine(engine, snap, this.routes, {
      bpm: this.bpm, activeLaneLimit: this.activeLaneLimit, startAt,
    })
    // Master volume is the snapshot's own; the per-engine gain stays a pure fader.
    this._live.push({ engine, index: i })
    this._playing = true

    // Section length is per-item, and this runs while the *previous* section is
    // still on the air — so it can't be written to shared progress state until the
    // section actually starts. Same for _sectionStartMs.
    const sectionSec = (item.bars * 4 * 60) / this.bpm
    const boundaryAt = startAt + sectionSec

    // Wall-clock offsets are measured from *now* against the transport's clock, so
    // a section prepared early still lines its bookkeeping up with its own start.
    const msUntil = (transportSec) => Math.max(0, (transportSec - Tone.Transport.seconds) * 1000)

    // The section becomes "current" (progress bar, highlighted row) when it starts.
    this._timers.push(setTimeout(() => {
      if (this._stopped) return
      this._sectionSec = sectionSec
      this._sectionStartMs = performance.now()
      this.onAdvance?.(i)
    }, msUntil(startAt)))

    this._scheduleBoundary(i, boundaryAt)
  }

  // How far ahead of its boundary a section is built. Zero without a spare engine:
  // preparing early on the only engine would tear down the section still playing.
  _prepareLead() {
    return this._engines.length > 1 ? PREPARE_LEAD_SEC : 0
  }

  // Hand back the engine that isn't currently sounding, guaranteed clean. Very short
  // sections can come back round to an engine whose tail hasn't been retired yet, and
  // building over a live graph would orphan its still-scheduled Parts.
  _takeEngine() {
    const engine = this._engines[this._nextEngineIdx % this._engines.length]
    this._nextEngineIdx += 1
    this._live = this._live.filter(e => e.engine !== engine)
    try { engine.stopMock({ keepTransport: true }) } catch {}
    return engine
  }

  _scheduleBoundary(i, boundaryAt) {
    const next = i + 1
    const isLast = next >= this.items.length
    const nextItem = isLast ? (this._loop ? this.items[0] : null) : this.items[next]
    const msUntil = (transportSec) => Math.max(0, (transportSec - Tone.Transport.seconds) * 1000)

    if (nextItem) {
      // Build the next section ahead of the boundary, anchored *to* the boundary.
      // This is the whole point of the A/B split: by the time the transport gets
      // there its Parts are already scheduled, so the swap costs nothing.
      this._timers.push(setTimeout(() => {
        if (this._stopped) return
        this._advanceFrom(i, boundaryAt)
      }, msUntil(boundaryAt - this._prepareLead())))
    }

    // Retire the outgoing engine after the boundary so it rings out underneath the
    // incoming one. With no next item this is the end of playback instead.
    const tail = this._tailSec(nextItem)
    this._timers.push(setTimeout(() => {
      if (this._stopped) return
      this._retire(i, tail)
      if (nextItem) return
      // Last section: let the same fade run, then end once it's silent.
      this._timers.push(setTimeout(() => this._end(), tail * 1000 + 60))
    }, msUntil(boundaryAt)))
  }

  // Fade the engine that played item `i` out over `tail` and tear it down. Uses the
  // engine's OWN master gain — the shared Destination carries the incoming section too.
  _retire(index, tail) {
    const entry = this._live.find(e => e.index === index)
    if (!entry) return
    this._live = this._live.filter(e => e !== entry)
    const { engine } = entry
    const gain = engine.getMasterGain?.()
    try { gain?.gain.cancelScheduledValues(Tone.now()) } catch {}
    try { gain?.gain.rampTo(0, tail) } catch {}
    this._timers.push(setTimeout(() => {
      // keepTransport: the incoming engine is riding this same Transport, and a
      // plain stopMock() would cancel() its Parts out from under it.
      try { engine.stopMock({ keepTransport: true }) } catch {}
      try { gain?.gain.setValueAtTime(1, Tone.now()) } catch {}
    }, tail * 1000 + 50))
  }

  _advanceFrom(i, startAt) {
    const next = i + 1
    if (next < this.items.length) { this._enter(next, startAt); return }
    if (this._loop && this.items.length) { this._enter(0, startAt); return }
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
