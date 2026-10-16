import { Midi } from '@tonejs/midi'
import { buildLoopMidiEvents, noteDurationSec, isRouteExportable, isRouteAudible } from './midiEvents.js'
export { buildLoopMidiEvents, noteDurationSec, isRouteExportable, isRouteAudible } from './midiEvents.js'

const DEFAULT_VELOCITY = 0.8
// Browsers throttle (or prompt about) a burst of downloads; spacing them out
// keeps every per-lane file of a mix export.
const MULTI_DOWNLOAD_GAP_MS = 350

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
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function fileSafe(text) {
  return String(text ?? '').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'lane'
}

function laneTrackName(route, ctx) {
  return ctx.trackLabels?.[route.id]?.text?.trim() || `${route.type} ${route.name}`
}

// Exports are always one pass of the lane's pattern as you see it in the lane:
// its loop window (so a shortened loop exports only the shortened part), speed,
// grid, pitch edits, note length and arpeggiator — starting at 0, ready to drop
// into a DAW clip.
function laneMidi(route, ctx) {
  const events = buildLoopMidiEvents(route, ctx)
  if (!events.length) return null
  const bpm = ctx.bpm ?? 120
  return {
    midi: buildMidiFile({ bpm, tracks: [{ name: laneTrackName(route, ctx), events }] }),
    filename: `leid-${fileSafe(route.type)}-${fileSafe(laneTrackName(route, ctx))}-${bpm}bpm.mid`,
  }
}

export function exportRouteMidi(route, ctx) {
  if (!isRouteExportable(route, route.id, ctx)) return false
  const file = laneMidi(route, ctx)
  if (!file) return false
  downloadMidiBlob(file.midi, file.filename)
  return true
}

/** Lanes the mix export would write: exportable, audible, and with notes. */
export function exportableMixRoutes(routes, ctx) {
  return (routes ?? []).filter(route =>
    isRouteExportable(route, route.id, ctx) && isRouteAudible(route.id, ctx) &&
    buildLoopMidiEvents(route, ctx).length > 0)
}

// One .mid file per active lane, downloaded one after another.
export async function exportMixMidi(routes, ctx) {
  const files = exportableMixRoutes(routes, ctx).map(route => laneMidi(route, ctx)).filter(Boolean)
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, MULTI_DOWNLOAD_GAP_MS))
    downloadMidiBlob(files[i].midi, files[i].filename)
  }
  return files.length
}
