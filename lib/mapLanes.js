// Pure map-lane model: which lanes the map lists, which physical route lines
// each one draws on, and the visual focus / stop-detail rules for phase 2.
// Kept out of MapView.jsx so it can be tested without Leaflet, React or the DOM.
//
// A *lane* is what the DAW shows and the engine plays: a base route, a
// duplicate (chord copy of a base route, `sourceId`) or a merged lane (several
// base routes stacked into chords, `sourceIds`). The map draws *geometry*: each
// base route's polylines once. Several lanes can share one line, and one lane
// can cover several lines, so focus is keyed by lane id and resolved to
// geometry ids here. Synthetic ids (`~dup~`, `merge~`) are never parsed.

import { isRouteActive } from './mapVisualPolicy.js'

export const STOP_DETAIL_MIN_ZOOM = 13   // below this, no passive stop markers
export const STOP_CAP = { desktop: 80, phone: 24 }

/**
 * Map lane descriptors from the DAW's visible instrument lanes (MixerTab's
 * `visibleInstrumentRoutes`: base, duplicate and merged lanes, with merge
 * sources, automation sources and drums already removed).
 * → [{ id, name, type, color, desc, kind: 'route'|'duplicate'|'merged', geometryIds }]
 */
export function buildMapLanes(lanes) {
  const out = []
  for (const l of lanes ?? []) {
    if (!l?.id) continue
    let kind = 'route', geometryIds = [l.id]
    if (l.isMerged) {
      kind = 'merged'
      geometryIds = (l.sourceRoutes?.map(r => r.id) ?? l.sourceIds ?? []).filter(Boolean)
    } else if (l.isDuplicate) {
      kind = 'duplicate'
      geometryIds = l.sourceId ? [l.sourceId] : []
    }
    out.push({ id: l.id, name: l.name ?? l.id, type: l.type, color: l.color, desc: l.desc ?? '', kind, geometryIds })
  }
  return out
}

/** Base route ids drawn as audible: any listed lane that uses them is audible. */
export function activeGeometryIds(mapLanes, disabled, soloRoutes) {
  const ids = new Set()
  for (const lane of mapLanes ?? []) {
    if (!isRouteActive(lane, disabled, soloRoutes)) continue
    for (const g of lane.geometryIds) ids.add(g)
  }
  return ids
}

/**
 * The lane a click on route line `routeId` focuses. A lane already focused
 * that uses this line stays focused (shared geography); otherwise the first
 * listed lane on it. null when no listed lane draws this line (a merge or
 * automation source shown only as a preview).
 */
export function laneForRouteClick(routeId, mapLanes, focusedId) {
  const lanes = mapLanes ?? []
  const current = lanes.find(l => l.id === focusedId)
  if (current?.geometryIds.includes(routeId)) return current.id
  return lanes.find(l => l.geometryIds.includes(routeId))?.id ?? null
}

/** Pressing a lane's focus button: toggles off when it's already focused. */
export function toggleFocus(focusedId, laneId) {
  return focusedId === laneId ? null : laneId
}

/** Keeps focus only while the lane still exists (removal clears it; disabling doesn't). */
export function reconcileFocus(focusedId, mapLanes) {
  if (focusedId == null) return null
  return (mapLanes ?? []).some(l => l.id === focusedId) ? focusedId : null
}

/** The other lanes that draw on the same lines as `lane` (shown in the details). */
export function sharedGeometryLanes(lane, mapLanes) {
  if (!lane) return []
  const g = new Set(lane.geometryIds)
  return (mapLanes ?? []).filter(l => l.id !== lane.id && l.geometryIds.some(id => g.has(id)))
}

/** Text state of a lane, shown with the focus details so it isn't colour-only. */
export function laneState(lane, disabled, soloRoutes) {
  if (disabled?.[lane.id]) return 'Off'
  if (soloRoutes?.has(lane.id)) return 'Solo'
  if (soloRoutes?.size > 0) return 'Muted by solo'
  return 'On'
}

/**
 * Ordered stops of a focused lane across its geometry routes, each carrying
 * its route id. Merged lanes list each source's stops in source order.
 * Stops without coordinates are dropped. `key` is unique per entry.
 */
export function laneStops(lane, routesById) {
  const out = []
  for (const rid of lane?.geometryIds ?? []) {
    const route = routesById.get(rid)
    ;(route?.stops ?? []).forEach((s, i) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return
      out.push({ key: `${rid}:${s.id}:${i}`, routeId: rid, id: s.id, name: s.name ?? String(s.id), lat: s.lat, lon: s.lon, index: i, last: i === route.stops.length - 1 })
    })
  }
  return out
}

const inBounds = (s, b) => s.lat >= b.south && s.lat <= b.north && s.lon >= b.west && s.lon <= b.east

/**
 * Passive stop markers for the focused lane: none below STOP_DETAIL_MIN_ZOOM;
 * otherwise the stops inside `bounds` ({south, west, north, east}), sampled
 * evenly by stop order down to `cap`. The selected stop and each route's
 * endpoints that are in view always survive sampling.
 */
export function visibleStopMarkers(stops, { zoom, bounds, cap, selectedKey = null }) {
  if (!(zoom >= STOP_DETAIL_MIN_ZOOM) || !bounds) return []
  const inView = stops.filter(s => inBounds(s, bounds))
  if (inView.length <= cap) return inView
  const must = inView.filter(s => s.key === selectedKey || s.index === 0 || s.last)
  const rest = inView.filter(s => !must.includes(s))
  const room = Math.max(0, cap - must.length)
  const picked = new Set(must)
  if (room > 0) {
    const step = rest.length / room
    for (let i = 0; i < room; i++) picked.add(rest[Math.floor(i * step)])
  }
  return inView.filter(s => picked.has(s))   // keep stop order
}

/** Is a stop inside the current map bounds? */
export function stopInView(stop, bounds) {
  return !!(stop && bounds && inBounds(stop, bounds))
}
