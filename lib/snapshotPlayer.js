// Play a saved preset snapshot on a TransitEngine, mirroring the exact sequence
// MixerTab uses at Start (components/tabs/MixerTab.jsx handlePlayPause):
//   applySnapshot (engine-only) → build soundMode map → engine.startMock(...)
//
// Used by the Song Chainer so a snapshot can be auditioned on a standalone
// engine without any MixerTab React state. applySnapshot's setters are all
// optional, so passing {} drives the audio graph only.

import { applySnapshot } from './songState.js'
import { normalizeSnapshotLaneAccess } from './billing/plans.js'

// Reconstruct a snapshot's duplicate-lane clone routes and merged (PolySynth)
// lanes from the base routes, the same way songState.applySnapshot does — so
// engine.startMock can build Parts for them too.
export function mergeDuplicateRoutes(routes, snapshot) {
  const s = snapshot?.state ?? snapshot ?? {}
  const allRoutes = routes ?? []
  const allIds = new Set(allRoutes.map(route => route.id))
  const requiredBaseIds = new Set()
  for (const lane of s.laneManifest ?? []) {
    if (lane?.kind === 'base' && allIds.has(lane.id)) requiredBaseIds.add(lane.id)
  }
  // Legacy snapshots predate laneManifest, but `muted` contains every selected
  // base lane because fresh sessions initialize the full disabled map.
  if (!requiredBaseIds.size) {
    for (const id of Object.keys(s.muted ?? {})) if (allIds.has(id)) requiredBaseIds.add(id)
  }
  for (const duplicate of s.duplicates ?? []) requiredBaseIds.add(duplicate.sourceId)
  for (const merge of s.merges ?? []) for (const id of merge.sourceIds ?? []) requiredBaseIds.add(id)
  for (const lanes of Object.values(s.automationCfg ?? {})) {
    for (const lane of Object.values(lanes ?? {})) if (lane?.sourceRouteId) requiredBaseIds.add(lane.sourceRouteId)
  }
  const base = requiredBaseIds.size
    ? allRoutes.filter(route => requiredBaseIds.has(route.id))
    : allRoutes
  const dupRoutes = (s.duplicates ?? [])
    .map((d) => {
      const src = base.find((r) => r.id === d.sourceId)
      return src ? { ...src, id: d.id, name: d.name, sourceId: d.sourceId, isDuplicate: true } : null
    })
    .filter(Boolean)
  const byId = new Map(base.map((r) => [r.id, r]))
  const mergeRoutes = (s.merges ?? [])
    .map((m) => {
      const srcRoutes = (m.sourceIds ?? []).map((id) => byId.get(id)).filter(Boolean)
      if (!srcRoutes.length) return null
      const first = srcRoutes[0]
      return { ...first, id: m.id, name: m.name, type: first.type, isMerged: true, sourceIds: m.sourceIds, sourceRoutes: srcRoutes }
    })
    .filter(Boolean)
  return [...base, ...dupRoutes, ...mergeRoutes]
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
