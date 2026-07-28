// Resolving a lane's per-stop notes for display.
//
// The engine decides what a stop *sounds* like (lib/engine.js); this decides
// what the UI *shows*, and the two must agree or the piano-roll lies. Both the
// desktop stop rail (components/DawView.jsx) and the phone lane sheet
// (components/mobile/LaneSheet.jsx) go through here so there is exactly one
// place that knows the order of operations.
//
// Order matters and mirrors TransitEngine: geographic pitch map → per-stop
// diatonic offset → per-track octave shift → whole-lane chromatic transpose.
import {
  generatePitchMap, shiftOctaveNote, shiftSemitones, transposeNoteInScale, SCALES,
  noteToMidi,
} from './mappings.js'

/**
 * @returns {{ pitchMap: string[], geoDisplayMap: string[] }}
 *   pitchMap      — what actually plays, per stop index
 *   geoDisplayMap — the geographic base note, octave-shifted but offset-free.
 *                   The stop editor steps diatonically from this, because a
 *                   user's ±1 should move from the geography, not from the
 *                   already-transposed result.
 */
export function buildLanePitchMaps(route, {
  scale,                 // { root, scaleType }
  pitchVariety = null,
  perStopSteps = null,
  octaveShift = 0,
  semitoneShift = 0,
} = {}) {
  const stops = route?.stops ?? []
  if (!stops.length) return { pitchMap: [], geoDisplayMap: [] }

  const scaleIntervals = SCALES[scale?.scaleType] ?? SCALES.major
  const rootMidi = noteToMidi(`${scale?.root ?? 'C'}3`)

  const baseMap = generatePitchMap(stops, rootMidi, scaleIntervals, 3, {
    ...(pitchVariety ?? {}),
    routeId: route.id,
  })

  const pitchMap = baseMap.map((note, i) => {
    const offset = perStopSteps?.[stops[i]?.id] ?? 0
    const tuned = offset
      ? transposeNoteInScale(note, offset, scale?.root ?? 'C', scale?.scaleType ?? 'major')
      : note
    return shiftSemitones(shiftOctaveNote(tuned, octaveShift), semitoneShift)
  })

  return { pitchMap, geoDisplayMap: baseMap.map(n => shiftOctaveNote(n, octaveShift)) }
}

/**
 * One row per stop, ready for a vertical list. This is the touch replacement
 * for the desktop stop rail: at 8px per dot with stops 10–20px apart, finger
 * targets would overlap several neighbours, so the phone edits notes as a list.
 *
 * Velocity resolution matches the engine: an authored per-stop override wins,
 * otherwise the note plays at full level.
 */
export function buildLaneNoteRows(route, {
  pitchMap,
  perStopSteps = null,
  stopVelocities = null,
} = {}) {
  return (route?.stops ?? []).map((stop, i) => ({
    id: stop.id,
    index: i,
    name: stop.name ?? `Stop ${i + 1}`,
    note: pitchMap?.[i] ?? '—',
    steps: perStopSteps?.[stop.id] ?? 0,
    velocity: stopVelocities?.[stop.id] ?? 1,
  }))
}
