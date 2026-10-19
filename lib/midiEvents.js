// Pure loop note events; shared with the browser MIDI writer and numerical tests.
import { buildLanePitchMaps, buildMergedPitchCells } from './lanePitch.js'
import {
  generateVelocityMap, noteToMidi, buildArpSequence, buildChordArpSequence,
  snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS, GRID_STEPS_PER_BAR,
  GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION,
} from './mappings.js'
import { resolveNoteChance } from './laneGating.js'
import { noteLengthBeats } from './noteLength.js'
import { stopNoteLengthStatus, resolveStopHold, stopDemand } from './stopNoteLength.js'

const LOOP_BEATS = 16
const DEFAULT_VELOCITY = 0.8
const MIN_NOTE_SEC = 0.01

// Arp step length in beats (quarter notes) — mirrors Tone.Time(cfg.rate) in
// engine.js's _triggerArp, which can't be used here (no Tone in pure modules).
const ARP_RATE_BEATS = { '4n': 1, '8n': 0.5, '8t': 1 / 3, '16n': 0.25, '16t': 1 / 6, '32n': 0.125 }

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

// Stop-driven note length (lib/stopNoteLength.js): the mapping config when it
// drives this lane's notes, else null. Same eligibility as the engine; the arp
// and drone paths never reach the caller, so only legato and the instrument
// are checked here.
function activeStopNoteLength(routeId, ctx, merged) {
  const cfg = ctx.trackStopNoteLengths?.[routeId]
  const { active } = stopNoteLengthStatus({
    cfg, synthType: ctx.trackSynthTypes?.[routeId], legato: !!ctx.trackLegatos?.[routeId], merged,
  })
  return active ? cfg : null
}

// Requested hold in seconds for a mapped stop/chord, or undefined to keep the
// lane's fixed gate (applyDurations fills it). fitToLoop later applies the
// export's own clip-at-loop-end and same-pitch rules.
function mappedDurationSec(cfg, demand, bpm) {
  if (!cfg) return undefined
  const hold = resolveStopHold(cfg, demand)
  return hold.fallback ? undefined : hold.beats * 60 / bpm
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
    const duration = ev.duration ?? noteDurationSec(bpm, soundMode, legato, ev.time, nextTime, loopEnd, noteLength)
    return { time: ev.time, midi: ev.midi, duration, velocity: ev.velocity ?? DEFAULT_VELOCITY }
  })
}

// Expand each stop event into its arp steps, exactly as _triggerArp /
// _triggerChordArp schedule them. Steps carry their own (gated) duration.
function expandArp(events, arp, bpm, scale, chord) {
  const stepSec = (ARP_RATE_BEATS[arp.rate ?? '16n'] ?? 0.25) * 60 / bpm
  const dur = stepSec * (arp.gate ?? 0.5)
  return events.flatMap(ev => {
    const seq = chord
      ? buildChordArpSequence(ev.notes, arp)
      : buildArpSequence(ev.notes[0], arp, scale.scaleType ?? 'major', scale.root ?? 'C')
    return seq.map((note, i) => ({
      time: ev.time + i * stepSec, midi: noteToMidi(note), duration: dur,
      velocity: chord ? DEFAULT_VELOCITY : ev.velocity,
    }))
  })
}

// Make the events one clean, self-contained clip of the loop: nothing starts
// at or after the loop end, nothing rings past it, exact duplicates are merged,
// and a note never overlaps the next note of the same pitch (overlapping
// same-pitch notes import into a DAW as stuck or chopped notes).
function fitToLoop(events, loopSec) {
  const sorted = events
    .filter(ev => Number.isFinite(ev.midi) && ev.time >= 0 && ev.time < loopSec - 1e-6)
    .sort((a, b) => a.time - b.time || a.midi - b.midi)
  const out = []
  const seen = new Set()
  for (const ev of sorted) {
    const key = `${ev.midi}@${ev.time.toFixed(6)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...ev })
  }
  return out.map((ev, i) => {
    let end = Math.min(ev.time + ev.duration, loopSec)
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].midi === ev.midi && out[j].time > ev.time) { end = Math.min(end, out[j].time); break }
    }
    return { ...ev, duration: Math.max(MIN_NOTE_SEC, end - ev.time) }
  })
}

/** Length in seconds of one pass of a lane's loop (its loop window at its speed). */
export function loopLengthSec(route, ctx) {
  const bpm   = ctx.bpm ?? 120
  const speed = ctx.trackSpeeds?.[route.id] ?? 1
  const { regionLen } = getLoopRegion(route.id, ctx)
  return (regionLen / GRID_TOTAL_CELLS) * ((LOOP_BEATS / bpm) * 60) / speed
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
  const arp = ctx.trackArps?.[route.id]?.enabled ? ctx.trackArps[route.id] : null
  if (route.isMerged) {
    if (resolveNoteChance(ctx.trackNoteChances?.[route.id]) <= 0) return []
    const cells = buildMergedPitchCells(route, pitchOptions).map(cell => ({
      time: ((cell.cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
      notes: cell.notes,
      demand: cell.demand,
    }))
    if (arp) return fitToLoop(expandArp(cells, arp, bpm, scale, true), partLoopSec)
    const mapping = activeStopNoteLength(route.id, ctx, true)
    const raw = cells.flatMap(cell => {
      const duration = mappedDurationSec(mapping, cell.demand, bpm)
      return cell.notes.map(note => ({
        time: cell.time, midi: noteToMidi(note), velocity: DEFAULT_VELOCITY, duration,
      }))
    })
    // Merged chord playback ignores legato and uses the lane's ordinary gate.
    return fitToLoop(applyDurations(raw, bpm, 'harmonic', false, partLoopSec, ctx.trackNoteLengths?.[route.id]), partLoopSec)
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

  const stopEvents = audibleStops.map(stop => {
    const vel     = stopVelocities?.[stop.id] ?? velocityMap[stop.originalIdx] ?? 1
    return {
      time: ((stop.cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
      notes: [pitchMap[stop.originalIdx]],
      velocity: DEFAULT_VELOCITY * vel,
      demand: stopDemand(stop),
    }
  })
  // The arpeggiator replaces the stop note with its sequence (and wins over legato).
  if (arp) return fitToLoop(expandArp(stopEvents, arp, bpm, scale, false), partLoopSec)

  const mapping = activeStopNoteLength(route.id, ctx, false)
  const raw = stopEvents.map(ev => ({
    time: ev.time, midi: noteToMidi(ev.notes[0]), velocity: ev.velocity,
    duration: mappedDurationSec(mapping, ev.demand, bpm),
  }))
  return fitToLoop(applyDurations(raw, bpm, soundMode, legato, partLoopSec, ctx.trackNoteLengths?.[route.id]), partLoopSec)
}

