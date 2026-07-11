import { Midi } from '@tonejs/midi'
import {
  generatePitchMap, generateVelocityMap, shiftOctaveNote, noteToMidi, randomFromScale,
  snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS, GRID_STEPS_PER_BAR,
  GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION, SCALES, transposeNoteInScale,
} from './mappings.js'

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

export function noteDurationSec(bpm, soundMode, legato, currentTime, nextTime, loopEnd) {
  if (legato) {
    if (nextTime != null) return Math.max(0.05, nextTime - currentTime)
    if (loopEnd != null) return Math.max(0.05, loopEnd - currentTime)
    return 60 / bpm
  }
  const beatSec = 60 / bpm
  return soundMode === 'percussive' ? beatSec / 2 : beatSec
}

function getLoopRegion(routeId, ctx) {
  const region = ctx.trackLoopRegions?.[routeId]
  const rawStart = region?.startCell ?? 0
  const rawEnd   = region?.endCell ?? GRID_TOTAL_CELLS
  const startCell = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, rawStart))
  const endCell   = Math.max(startCell + 1, Math.min(GRID_TOTAL_CELLS, rawEnd))
  return { startCell, endCell, regionLen: endCell - startCell }
}

function applyDurations(events, bpm, soundMode, legato, loopEnd) {
  return events.map((ev, i) => {
    const nextTime = i < events.length - 1 ? events[i + 1].time : null
    const duration = noteDurationSec(bpm, soundMode, legato, ev.time, nextTime, loopEnd)
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
  const { root = 'C', scaleType = 'major' } = scale
  const scaleIntervals = SCALES[scaleType] ?? SCALES.major
  const pitchVariety = ctx.trackPitchVariety?.[route.id]
  const pitchMap = generatePitchMap(route.stops, noteToMidi(`${root}3`), scaleIntervals, 3,
    { ...(pitchVariety ?? {}), routeId: route.id })
    .map(n => shiftOctaveNote(n, ctx.trackOctaves?.[route.id] ?? 0))
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

  const raw = gridStops.map(stop => {
    const rawNote = pitchMap[stop.originalIdx] ?? randomFromScale(root, scaleType)
    // Per-stop diatonic re-pitch (duplicate lanes) — mirrors engine.js's _buildRoutePart.
    const off     = ctx.perStopSteps?.[route.id]?.[stop.id] ?? 0
    const tuned   = off ? transposeNoteInScale(rawNote, off, root, scaleType) : rawNote
    const vel     = stopVelocities?.[stop.id] ?? velocityMap[stop.originalIdx] ?? 1
    return {
      time: ((stop.cellIdx / noteTotalCells - regionStartFrac) / (regionEndFrac - regionStartFrac)) * partLoopSec,
      midi: noteToMidi(tuned),
      velocity: DEFAULT_VELOCITY * vel,
    }
  })

  return applyDurations(raw, bpm, soundMode, legato, partLoopSec)
}

// Mock route Parts loop forever, so a live session recording would grow without
// bound and eventually freeze the tab. Cap the buffer to a recent window — mock
// playback is deterministic and loops, so this still yields a full, exportable
// arrangement while keeping memory constant over an arbitrarily long session.
const MIDI_SESSION_MAX = 20000

export class MidiSessionRecorder {
  constructor() { this._events = [] }
  start() { this._events = [] }
  clear() { this._events = [] }

  record({ routeId, note, timeSec, soundMode, legato }) {
    this._events.push({
      routeId,
      midi: noteToMidi(note),
      time: Math.max(0, timeSec),
      soundMode: soundMode ?? 'harmonic',
      legato: !!legato,
    })
    if (this._events.length > MIDI_SESSION_MAX) {
      this._events.splice(0, this._events.length - MIDI_SESSION_MAX)
    }
  }

  hasData() { return this._events.length > 0 }
  getRouteEvents(routeId) { return this._events.filter(e => e.routeId === routeId) }

  getAllEvents() {
    const byRoute = new Map()
    for (const ev of this._events) {
      if (!byRoute.has(ev.routeId)) byRoute.set(ev.routeId, [])
      byRoute.get(ev.routeId).push(ev)
    }
    return byRoute
  }
}

function sessionEventsToMidi(events, bpm) {
  if (!events.length) return []
  const sorted = [...events].sort((a, b) => a.time - b.time)
  return sorted.map((ev, i) => {
    const nextTime = i < sorted.length - 1 ? sorted[i + 1].time : null
    const duration = noteDurationSec(bpm, ev.soundMode, ev.legato, ev.time, nextTime, null)
    return { time: ev.time, midi: ev.midi, duration, velocity: DEFAULT_VELOCITY }
  })
}

export function buildMidiFile({ bpm, tracks }) {
  const midi = new Midi()
  midi.header.setTempo(bpm)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
  for (const { name, events } of tracks) {
    if (!events?.length) continue
    const track = midi.addTrack()
    if (name) track.name = name
    for (const ev of events) {
      track.addNote({ midi: ev.midi, time: ev.time, duration: ev.duration, velocity: ev.velocity ?? DEFAULT_VELOCITY })
    }
  }
  return midi
}

export function downloadMidiBlob(midi, filename) {
  const blob = new Blob([midi.toArray()], { type: 'audio/midi' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function resolveRouteEvents(route, ctx, source) {
  const recorder   = ctx.recorder
  const useSession = source === 'session' || (source === 'auto' && recorder?.hasData())
  if (useSession) {
    const raw = recorder?.getRouteEvents(route.id) ?? []
    if (raw.length) return sessionEventsToMidi(raw, ctx.bpm ?? 120)
    if (source === 'session') return []
  }
  return buildLoopMidiEvents(route, ctx)
}

export function exportRouteMidi(route, ctx, { source = 'auto' } = {}) {
  if (!isRouteExportable(route, route.id, ctx)) return false
  const events = resolveRouteEvents(route, ctx, source)
  if (!events.length) return false
  const bpm  = ctx.bpm ?? 120
  downloadMidiBlob(
    buildMidiFile({ bpm, tracks: [{ name: `${route.type} ${route.name}`, events }] }),
    `transit-${route.type}-${route.name}-${bpm}bpm.mid`,
  )
  return true
}

export function exportMixMidi(routes, ctx, { source = 'auto' } = {}) {
  const bpm = ctx.bpm ?? 120
  const recorder = ctx.recorder
  const useSession = source === 'session' || (source === 'auto' && recorder?.hasData())
  const tracks = []

  for (const route of routes ?? []) {
    if (!isRouteExportable(route, route.id, ctx)) continue
    let events
    if (useSession) {
      const raw = recorder?.getRouteEvents(route.id) ?? []
      if (!raw.length) continue
      events = sessionEventsToMidi(raw, bpm)
    } else {
      if (!isRouteAudible(route.id, ctx)) continue
      events = buildLoopMidiEvents(route, ctx)
    }
    if (events.length) tracks.push({ name: `${route.type} ${route.name}`, events })
  }

  if (!tracks.length) return false
  downloadMidiBlob(buildMidiFile({ bpm, tracks }), `transit-mix-${bpm}bpm-${Date.now()}.mid`)
  return true
}
