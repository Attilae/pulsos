// Resolve a saved snapshot's *lanes* (which transit routes a song plays) from a
// city's full route list. This is the single source of truth for that question —
// it used to be answered three different ways (songState.applySnapshot rebuilt
// duplicates/merges inline, snapshotPlayer.mergeDuplicateRoutes derived a base
// set from laneManifest, and billing/plans.normalizeSnapshotLaneAccess had its
// own ordering heuristic), which let the Mixer and the Song Chainer disagree
// about the same snapshot.
//
// Pure and dependency-free on purpose: billing/plans.js imports this and is
// reached from server route handlers, so nothing here may pull in tone/engine.

// Reserved pseudo-route for the drum lane (mirrors DRUMS_ROUTE_ID in engine.js,
// which can't be imported here — it would drag Tone.js into the server bundle).
const DRUMS_ROUTE_ID = '__drums__'

const _unwrap = (snapshot) => snapshot?.state ?? snapshot ?? {}

/**
 * The ordered, deduped list of *base* route ids a snapshot selected.
 *
 * Modern snapshots (schemaVersion ≥ 3) store `routeIds` explicitly. Older ones
 * never recorded the lane list at all, so recover it best-effort from whatever
 * carries route ids, most authoritative first:
 *   laneManifest base lanes → duplicate sources → merge sources →
 *   automation sources → remaining `muted` keys
 * `laneManifest` alone is never enough: it is built from visibleInstrumentRoutes,
 * which excludes merge-consumed and automation-source lanes.
 */
export function snapshotBaseRouteIds(snapshot) {
  const s = _unwrap(snapshot)
  if (Array.isArray(s.routeIds) && s.routeIds.length) return [...new Set(s.routeIds.filter(Boolean))]

  // Synthetic lane ids (duplicates/merges) are not base routes and must never
  // leak into the selection. Match them by descriptor id rather than by sniffing
  // the '~dup~' id format, which is an engine implementation detail.
  const synthetic = new Set([
    ...(s.duplicates ?? []).map(d => d?.id),
    ...(s.merges ?? []).map(m => m?.id),
    DRUMS_ROUTE_ID,
  ])

  const ids = new Set()
  const add = (id) => { if (id && !synthetic.has(id)) ids.add(id) }

  for (const lane of s.laneManifest ?? []) if (lane?.kind === 'base') add(lane.id)
  for (const d of s.duplicates ?? []) add(d?.sourceId)
  for (const m of s.merges ?? []) for (const id of m?.sourceIds ?? []) add(id)
  for (const lanes of Object.values(s.automationCfg ?? {})) {
    for (const lane of Object.values(lanes ?? {})) add(lane?.sourceRouteId)
  }
  // Fresh sessions initialize a full disabled map, so `muted` holds every lane
  // a legacy snapshot selected — the broadest fallback, hence last.
  for (const id of Object.keys(s.muted ?? {})) add(id)

  return [...ids]
}

/**
 * Match a snapshot's base route ids against a city's full route list.
 *
 * @returns {{ base: Array, missingIds: string[] }} `base` in the snapshot's own
 *   order; `missingIds` are ids the city's route data no longer has (a
 *   re-preprocessed lines.json can drop ids, and a snapshot from another city
 *   matches nothing).
 */
export function resolveSnapshotRoutes(allRoutes, snapshot) {
  const all = allRoutes ?? []
  const ids = snapshotBaseRouteIds(snapshot)
  // No recoverable ids at all (a very old or hand-written snapshot): fall back to
  // the whole route list rather than playing silence.
  if (!ids.length) return { base: all, missingIds: [] }

  const byId = new Map(all.map(r => [r.id, r]))
  const base = []
  const missingIds = []
  for (const id of ids) {
    const route = byId.get(id)
    if (route) base.push(route)
    else missingIds.push(id)
  }
  return { base, missingIds }
}

/**
 * Rebuild the synthetic lanes a snapshot describes: duplicate-lane clones (a
 * base route under a new id, for chord voicing) and merged PolySynth lanes
 * (several base routes folded into one chord lane). Descriptors whose sources
 * are gone resolve to nothing rather than dangling.
 */
export function buildSyntheticLanes(base, snapshot) {
  const s = _unwrap(snapshot)
  const byId = new Map((base ?? []).map(r => [r.id, r]))

  const dupRoutes = (s.duplicates ?? [])
    .map((d) => {
      const src = byId.get(d?.sourceId)
      return src ? { ...src, id: d.id, name: d.name, sourceId: d.sourceId, isDuplicate: true } : null
    })
    .filter(Boolean)

  const mergeRoutes = (s.merges ?? [])
    .map((m) => {
      const srcRoutes = (m?.sourceIds ?? []).map(id => byId.get(id)).filter(Boolean)
      if (!srcRoutes.length) return null
      const first = srcRoutes[0]
      return {
        ...first, id: m.id, name: m.name, type: first.type,
        isMerged: true, sourceIds: m.sourceIds, sourceRoutes: srcRoutes,
      }
    })
    .filter(Boolean)

  return { dupRoutes, mergeRoutes }
}

/**
 * The full lane set a snapshot plays: base routes plus every synthetic lane.
 *
 * @returns {{ base: Array, lanes: Array, dupRoutes: Array, mergeRoutes: Array, missingIds: string[] }}
 *   `base` is what MixerTab stores as `routes`; `lanes` is what the engine acts on.
 */
export function resolveSnapshotLanes(allRoutes, snapshot) {
  const { base, missingIds } = resolveSnapshotRoutes(allRoutes, snapshot)
  const { dupRoutes, mergeRoutes } = buildSyntheticLanes(base, snapshot)
  return { base, dupRoutes, mergeRoutes, lanes: [...base, ...dupRoutes, ...mergeRoutes], missingIds }
}

/**
 * A *complete* { laneId → disabled } map covering every lane, so React state and
 * the engine can never disagree about which lanes are audible.
 *
 * Absent ids default to `true` (disabled). A lane the snapshot says nothing about
 * must be silent-and-shown-silent; the old wholesale `setDisabledRoutes(s.muted)`
 * left such lanes `undefined` — rendered active while the engine kept them at
 * gain 0, which is why a loaded preset looked live and played nothing.
 */
export function snapshotLaneDisabledMap(lanes, snapshot) {
  const muted = _unwrap(snapshot).muted ?? {}
  const out = {}
  for (const lane of lanes ?? []) {
    if (!lane?.id) continue
    out[lane.id] = muted[lane.id] != null ? !!muted[lane.id] : true
  }
  // The drum pseudo-lane isn't in the route list but does carry a disabled flag.
  if (muted[DRUMS_ROUTE_ID] != null) out[DRUMS_ROUTE_ID] = !!muted[DRUMS_ROUTE_ID]
  return out
}

/**
 * Clamp a restored playback mode to what the target city can actually do. A song
 * saved in 'live' must not restore into a mock-only city (liveWsUrl null): the
 * Live toggle isn't even rendered there, so the session would be stuck calling
 * startLive against a feed that doesn't exist — silence with no way back.
 */
export function clampMode(mode, cityEntry) {
  return cityEntry?.liveWsUrl ? (mode ?? 'mock') : 'mock'
}
