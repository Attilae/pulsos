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
export function playSnapshotOnEngine(engine, snapshot, routes, { bpm, activeLaneLimit = null } = {}) {
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
  )
  return merged
}
