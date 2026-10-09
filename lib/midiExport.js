import { Midi } from '@tonejs/midi'
import { noteToMidi } from './mappings.js'
import { buildLoopMidiEvents, noteDurationSec, isRouteExportable, isRouteAudible } from './midiEvents.js'
export { buildLoopMidiEvents, noteDurationSec, isRouteExportable, isRouteAudible } from './midiEvents.js'

const DEFAULT_VELOCITY = 0.8

// Mock route Parts loop forever, so a live session recording would grow without
// bound and eventually freeze the tab. Cap the buffer to a recent window — mock
// playback is deterministic and loops, so this still yields a full, exportable
// arrangement while keeping memory constant over an arbitrarily long session.
const MIDI_SESSION_MAX = 20000

export class MidiSessionRecorder {
  constructor() { this._events = [] }
  start() { this._events = [] }
  clear() { this._events = [] }

  record({ routeId, note, timeSec, soundMode, legato, noteLength }) {
    this._events.push({
      routeId,
      midi: noteToMidi(note),
      time: Math.max(0, timeSec),
      soundMode: soundMode ?? 'harmonic',
      legato: !!legato,
      noteLength: noteLength ?? null,
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
    const duration = noteDurationSec(bpm, ev.soundMode, ev.legato, ev.time, nextTime, null, ev.noteLength)
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
