// Play a saved preset snapshot on a TransitEngine, mirroring the exact sequence
// MixerTab uses at Start (components/tabs/MixerTab.jsx handlePlayPause):
//   applySnapshot (engine-only) → build soundMode map → engine.startMock(...)
//
// Used by the Song Chainer so a snapshot can be auditioned on a standalone
// engine without any MixerTab React state. applySnapshot's setters are all
// optional, so passing {} drives the audio graph only.

import { applySnapshot } from './songState.js'
import { normalizeSnapshotLaneAccess } from './billing/plans.js'
import { resolveSnapshotLanes } from './songLanes.js'
import { sampleUrlsForSynth } from './engine.js'
import { warmSamples } from './sampleCache.js'

// Download + decode every sample a snapshot's lanes will need, so the Samplers
// built by the next playSnapshotOnEngine are audible from their first note
// instead of dropping notes until their zone maps finish loading. Idempotent and
// cheap once warm; resolves when everything is cached (failures are swallowed —
// an unreachable sample just falls back to the old load-at-build-time path).
export function prefetchSnapshotSamples(snapshot) {
  const s = snapshot?.state ?? snapshot
  if (!s) return Promise.resolve()

  const urls = []
  for (const [routeId, synthType] of Object.entries(s.trackSynthTypes ?? {})) {
    urls.push(...sampleUrlsForSynth(synthType, s.trackADSRs?.[routeId] ?? {}))
  }
  return warmSamples(urls)
}

// Reconstruct a snapshot's base selection plus its duplicate-lane clone routes
// and merged (PolySynth) lanes, so engine.startMock can build Parts for them too.
// Thin wrapper over the shared resolver (lib/songLanes.js) — kept as an export
// because songChainPlayer.js calls it.
export function mergeDuplicateRoutes(routes, snapshot) {
  return resolveSnapshotLanes(routes, snapshot).lanes
}

// Configure `engine` fully from `snapshot`, then start mock playback at `bpm`
// (falls back to the snapshot's own bpm). Returns the merged routes actually
// played (base + duplicate-lane clones) for any caller that needs them.
// `startAt` is forwarded to engine.startMock as the Transport anchor for every Part
// it builds, so a snapshot can be fully built *before* the moment it should start
// sounding (see SongChainPlayer's A/B handoff).
export function playSnapshotOnEngine(engine, snapshot, routes, { bpm, activeLaneLimit = null, startAt = 0 } = {}) {
  if (!engine || !snapshot) return []
  const normalized = normalizeSnapshotLaneAccess(snapshot, routes, activeLaneLimit)
  const s = normalized.state ?? normalized

  // 1. Push the whole preset into the engine's config maps (engine-only).
  applySnapshot(s, {}, engine, routes)

  // 2. Build the per-route sound-mode map (mode + scale), as MixerTab does.
  const smMap = {}
  for (const [rid, m] of Object.entries(s.trackSoundModes ?? {})) {
    smMap[rid] = { mode: m, scale: s.trackScales?.[rid] ?? { root: 'C', scaleType: 'major' } }
  }

  // 3. Start mock playback over base + duplicate routes.
  const merged = mergeDuplicateRoutes(routes, s)
  engine.startMock(
    merged,
    smMap,
    bpm ?? s.bpm ?? 120,
    s.trackSynthTypes ?? {},
    s.trackADSRs ?? {},
    {},
    { startAt },
  )
  return merged
}
