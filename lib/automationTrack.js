import { hashStopValue } from './mappings.js'

// An automation lane is a hand-authored, per-stop envelope keyed to a "source" line's
// stops. Each stop's value defaults to a deterministic hashStopValue(laneId, stopId)
// (a wide, stable spread) and can be overridden by the user dragging the point. The
// chosen line provides the *timeline*: when it crosses a stop during playback, this
// lane emits that stop's value to its target audio param (wired by the engine).
export class AutomationTrack {
  constructor() {
    this._laneId  = ''
    this._points  = {}     // reference to the lane cfg's { stopId: 0..1 } overrides
    this._onValue = null   // callback (value: 0–1) => void, set by the engine

    // stopId → stopIdx, for ordering in getCurve()
    this._order = new Map()
  }

  setLaneId(id) { this._laneId = id ?? '' }

  // Hold a reference to the lane cfg's overrides object so live drags take effect
  // without re-wiring. Missing/undefined falls back to an empty map.
  setPoints(pointsRef) { this._points = pointsRef ?? {} }

  // Caller provides a callback; engine sets this up per-lane with the right target wiring.
  setTarget(callback) { this._onValue = callback }

  // Record the source line's stop order (from lines.json). stops: [{ id, ... }]
  buildStaticCurve(stops) {
    this._order.clear()
    ;(stops ?? []).forEach((s, i) => this._order.set(s.id, i))
  }

  // Resolve a stop's authored value: explicit override, else deterministic default.
  valueAt(stopId) {
    const v = this._points?.[stopId]
    return (typeof v === 'number') ? v : hashStopValue(this._laneId, stopId)
  }

  // Called from the engine on each live or mock stop crossing of the source line.
  onStopEvent(stopId) {
    const value = this.valueAt(stopId)
    if (this._onValue) this._onValue(value)
  }

  // Return curve as array sorted by stopIdx for UI rendering.
  getCurve() {
    return [...this._order.entries()]
      .map(([stopId, stopIdx]) => ({ stopId, stopIdx, value: this.valueAt(stopId) }))
      .sort((a, b) => a.stopIdx - b.stopIdx)
  }

  dispose() {
    this._order.clear()
    this._points  = {}
    this._onValue = null
  }
}
