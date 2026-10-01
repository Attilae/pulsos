// Resolving a lane's per-stop notes for display.
//
// The engine decides what a stop *sounds* like (lib/engine.js); this decides
// what the UI *shows*, and the two must agree or the piano-roll lies. Both the
// desktop stop rail (components/DawView.jsx) and the phone lane sheet
// (components/mobile/LaneSheet.jsx) go through here so there is exactly one
// place that knows the order of operations.
//
// Order matters and mirrors TransitEngine: contour pitch map → per-stop
// diatonic offset → per-track octave shift → whole-lane chromatic transpose.
export { buildLanePitchMaps } from './lanePitch.js'

/**
 * One row per stop, ready for a vertical list. This is the touch replacement
 * for the desktop stop rail: at 8px per dot with stops 10–20px apart, finger
 * targets would overlap several neighbours, so the phone edits notes as a list.
 *
 * Velocity resolution matches the engine: an authored per-stop override wins,
 * otherwise the note plays at full level. Chance resolves the same way against
 * the lane's note chance (lib/laneGating.js); `chanceOverride` says whether the
 * stop has its own value.
 */
export function buildLaneNoteRows(route, {
  pitchMap,
  perStopSteps = null,
  stopVelocities = null,
  stopChances = null,
  laneChance = 1,
} = {}) {
  return (route?.stops ?? []).map((stop, i) => ({
    id: stop.id,
    index: i,
    name: stop.name ?? `Stop ${i + 1}`,
    note: pitchMap?.[i] ?? '?',
    steps: perStopSteps?.[stop.id] ?? 0,
    velocity: stopVelocities?.[stop.id] ?? 1,
    chance: stopChances?.[stop.id] ?? laneChance,
    chanceOverride: stopChances?.[stop.id] != null,
  }))
}
