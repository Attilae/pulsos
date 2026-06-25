// Play a saved preset snapshot on a TransitEngine, mirroring the exact sequence
// MixerTab uses at Start (components/tabs/MixerTab.jsx handlePlayPause):
//   applySnapshot (engine-only) → build soundMode map → engine.startMock(...)
//
// Used by the Song Chainer so a snapshot can be auditioned on a standalone
// engine without any MixerTab React state. applySnapshot's setters are all
// optional, so passing {} drives the audio graph only.

import { applySnapshot } from './songState.js'

// Reconstruct a snapshot's duplicate-lane clone routes from the base routes, the
// same way songState.applySnapshot does internally — so engine.startMock can
// build Parts for them too.
export function mergeDuplicateRoutes(routes, snapshot) {
  const s = snapshot?.state ?? snapshot ?? {}
  const base = routes ?? []
  const dupRoutes = (s.duplicates ?? [])
    .map((d) => {
      const src = base.find((r) => r.id === d.sourceId)
      return src ? { ...src, id: d.id, name: d.name, sourceId: d.sourceId, isDuplicate: true } : null
    })
    .filter(Boolean)
  return [...base, ...dupRoutes]
}

// Configure `engine` fully from `snapshot`, then start mock playback at `bpm`
// (falls back to the snapshot's own bpm). Returns the merged routes actually
// played (base + duplicate-lane clones) for any caller that needs them.
export function playSnapshotOnEngine(engine, snapshot, routes, { bpm } = {}) {
  if (!engine || !snapshot) return []
  const s = snapshot.state ?? snapshot

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
