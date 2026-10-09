// Pure pitch contract shared by the engine, note displays, Live callback, and
// MIDI export. No Tone/React dependencies: saved Song playback uses it too.
import {
  generatePitchMap, noteToMidi, SCALES, shiftOctaveNote, shiftSemitones,
  transposeNoteInScale, snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS,
  GRID_STEPS_PER_BAR, GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION,
} from './mappings.js'

export function buildRouteSoundModes(routes, soundModes = {}, scales = {}) {
  return Object.fromEntries((routes ?? []).map(route => [route.id, {
    mode: soundModes?.[route.id] ?? 'harmonic',
    scale: scales?.[route.id] ?? { root: 'C', scaleType: 'major' },
  }]))
}

export function laneGridStops(route, { gridResolution, loopRegion } = {}) {
  const stepsPerBar = GRID_RESOLUTION_STEPS_PER_BAR[gridResolution ?? DEFAULT_GRID_RESOLUTION] ?? GRID_STEPS_PER_BAR
  const cells = GRID_BARS * stepsPerBar
  const start = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, loopRegion?.startCell ?? 0))
  const end = Math.max(start + 1, Math.min(GRID_TOTAL_CELLS, loopRegion?.endCell ?? GRID_TOTAL_CELLS))
  const total = route?.totalDist || route?.stops?.at(-1)?.dist || 1
  return snapStopsToGrid(route?.stops, total, cells, stepsPerBar)
    .filter(stop => stop.cellIdx / cells >= start / GRID_TOTAL_CELLS && stop.cellIdx / cells < end / GRID_TOTAL_CELLS)
}

export function buildBasePitchMap(route, { scale, pitchVariety, gridResolution, loopRegion } = {}) {
  return generatePitchMap(route?.stops, noteToMidi(`${scale?.root ?? 'C'}3`),
    SCALES[scale?.scaleType] ?? SCALES.major, 3, {
      ...(pitchVariety ?? {}), routeId: route?.id,
      // Bound the notes that actually survive grid snapping and loop trimming,
      // including their closing edge. Changing a constrained loop can reshape it.
      sequenceIndices: pitchVariety?.maxLeap > 0
        ? laneGridStops(route, { gridResolution, loopRegion }).map(s => s.originalIdx) : undefined,
    })
}

export function resolveStopPitch(baseNote, { scale, degrees = 0, octaveShift = 0, semitoneShift = 0 } = {}) {
  const tuned = degrees
    ? transposeNoteInScale(baseNote, degrees, scale?.root ?? 'C', scale?.scaleType ?? 'major')
    : baseNote
  return shiftSemitones(shiftOctaveNote(tuned, octaveShift), semitoneShift)
}

export function buildLanePitchMaps(route, options = {}) {
  const baseMap = buildBasePitchMap(route, options)
  const pitchMap = baseMap.map((note, i) => resolveStopPitch(note, {
    ...options, degrees: options.perStopSteps?.[route.stops[i]?.id] ?? 0,
  }))
  return { pitchMap, geoDisplayMap: baseMap.map(n => shiftOctaveNote(n, options.octaveShift ?? 0)) }
}

export function buildMergedPitchCells(route, options = {}) {
  const cells = new Map()
  for (const source of route?.sourceRoutes ?? []) {
    if (!source?.stops?.length || !source.totalDist) continue
    const { pitchMap } = buildLanePitchMaps(source, { ...options, perStopSteps: null })
    for (const stop of laneGridStops(source, options)) {
      let cell = cells.get(stop.cellIdx)
      if (!cell) { cell = { cellIdx: stop.cellIdx, name: stop.name, notes: new Set() }; cells.set(stop.cellIdx, cell) }
      cell.notes.add(pitchMap[stop.originalIdx])
    }
  }
  return [...cells.values()].sort((a, b) => a.cellIdx - b.cellIdx)
    .map(cell => ({ ...cell, notes: [...cell.notes] }))
}
