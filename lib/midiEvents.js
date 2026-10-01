// Pure loop note events; shared with the browser MIDI writer and numerical tests.
import { buildLanePitchMaps, buildMergedPitchCells } from './lanePitch.js'
import {
  generateVelocityMap, noteToMidi,
  snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS, GRID_STEPS_PER_BAR,
  GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION,
} from './mappings.js'
import { resolveNoteChance } from './laneGating.js'
import { noteLengthBeats } from './noteLength.js'

const LOOP_BEATS = 16
const DEFAULT_VELOCITY = 0.8

export function isRouteExportable(route, routeId, ctx) {
  if (!route?.stops?.length) return false
  if (ctx.automationSourceIds?.has(routeId)) return false
  if (ctx.trackDroneModes?.[routeId]) return false
  return true
}

export function isRouteAudible(routeId, ctx) {
  if (ctx.disabled?.[routeId]) return false
  if (ctx.soloRoutes?.size > 0 && !ctx.soloRoutes.has(routeId)) return false
  if (ctx.trackDroneModes?.[routeId]) return false
  if (ctx.automationSourceIds?.has(routeId)) return false
  return true
}

// `noteLength` is the lane's note length (lib/noteLength.js), null for the
// legacy gate — mirrors the engine's `_noteLengths[id] ?? noteDur`.
export function noteDurationSec(bpm, soundMode, legato, currentTime, nextTime, loopEnd, noteLength = null) {
  if (legato) {
    if (nextTime != null) return Math.max(0.05, nextTime - currentTime)
    if (loopEnd != null) return Math.max(0.05, loopEnd - currentTime)
    return 60 / bpm
  }
  const beatSec = 60 / bpm
  return beatSec * noteLengthBeats(noteLength, soundMode === 'percussive' ? 0.5 : 1)
}

function getLoopRegion(routeId, ctx) {
  const region = ctx.trackLoopRegions?.[routeId]
  const rawStart = region?.startCell ?? 0
  const rawEnd   = region?.endCell ?? GRID_TOTAL_CELLS
  const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, rawStart))
  const endCell   = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, rawEnd))
  return { startCell, endCell, regionLen: endCell - startCell }
}

function applyDurations(events, bpm, soundMode, legato, loopEnd, noteLength) {
  return events.map((ev, i) => {
    const nextTime = i < events.length - 1 ? events[i + 1].time : null
    const duration = noteDurationSec(bpm, soundMode, legato, ev.time, nextTime, loopEnd, noteLength)
    return { time: ev.time, midi: ev.midi, duration, velocity: ev.velocity ?? DEFAULT_VELOCITY }
  })
}

export function buildLoopMidiEvents(route, ctx) {
  if (!route?.stops?.length || !route?.totalDist) return []

  const bpm   = ctx.bpm ?? 120
  const speed = ctx.trackSpeeds?.[route.id] ?? 1
  const { startCell, endCell, regionLen } = getLoopRegion(route.id, ctx)
  const loopSec     = (LOOP_BEATS / bpm) * 60
  const partLoopSec = (regionLen / GRID_TOTAL_CELLS) * loopSec / speed
  const regionStartFrac = startCell / GRID_TOTAL_CELLS
  const regionEndFrac   = endCell   / GRID_TOTAL_CELLS

  // Note quantization grid is independent of the loop-region's fixed 64-cell space —
  // mirrors engine.js's _buildRoutePart.
  const rate          = ctx.trackGridResolutions?.[route.id] ?? DEFAULT_GRID_RESOLUTION
  const stepsPerBar   = GRID_RESOLUTION_STEPS_PER_BAR[rate] ?? GRID_STEPS_PER_BAR
  const noteTotalCells = GRID_BARS * stepsPerBar

  const scale = ctx.trackScales?.[route.id] ?? { root: 'C', scaleType: 'major' }
  const pitchVariety = ctx.trackPitchVariety?.[route.id]
  const pitchOptions = {
    scale, pitchVariety, gridResolution: rate, loopRegion: { startCell, endCell },
    perStopSteps: ctx.perStopSteps?.[route.id],
    octaveShift: ctx.trackOctaves?.[route.id] ?? 0,
    semitoneShift: ctx.trackSemitones?.[route.id] ?? 0,
  }
  if (route.isMerged) {
    if (resolveNoteChance(ctx.trackNoteChances?.[route.id]) <= 0) return []
    const raw = buildMergedPitchCells(route, pitchOptions).flatMap(cell => cell.notes.map(note => ({
      time: ((cell.cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
      midi: noteToMidi(note), velocity: DEFAULT_VELOCITY,
    })))
    // Merged chord playback ignores legato and uses the lane's ordinary gate.
    return applyDurations(raw, bpm, 'harmonic', false, partLoopSec, ctx.trackNoteLengths?.[route.id])
  }
  const { pitchMap } = buildLanePitchMaps(route, pitchOptions)
  // Same velocity resolution as the engine: authored per-stop value (Alt+drag)
  // overrides the variety-derived map, scaled onto the export's 0.8 baseline.
  const velocityMap    = generateVelocityMap(route.stops, pitchVariety?.variety ?? 0)
  const stopVelocities = ctx.trackStopVelocities?.[route.id]

  const gridStops = snapStopsToGrid(route.stops, route.totalDist, noteTotalCells, stepsPerBar)
    .filter(s => {
      const frac = s.cellIdx / noteTotalCells
      return frac >= regionStartFrac && frac < regionEndFrac
    })

  const soundMode = ctx.trackSoundModes?.[route.id] ?? 'harmonic'
  const legato    = !!ctx.trackLegatos?.[route.id]

  // Note chance (lib/laneGating.js): one exported loop can't express "plays 40%
  // of the time", so probabilistic notes stay in — only a stop that can never
  // fire is left out. The session-recorder export captures what actually played.
  const laneChance  = ctx.trackNoteChances?.[route.id]
  const stopChances = ctx.trackStopChances?.[route.id]
  const audibleStops = gridStops.filter(stop => resolveNoteChance(laneChance, stopChances?.[stop.id]) > 0)

  const raw = audibleStops.map(stop => {
    const vel     = stopVelocities?.[stop.id] ?? velocityMap[stop.originalIdx] ?? 1
    return {
      time: ((stop.cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
      midi: noteToMidi(pitchMap[stop.originalIdx]),
      velocity: DEFAULT_VELOCITY * vel,
    }
  })

  return applyDurations(raw, bpm, soundMode, legato, partLoopSec, ctx.trackNoteLengths?.[route.id])
}

