// Opt-in preprocessing for feeds that encode timetable variants as routes.
// Logical IDs depend on agency, mode and public line name, not timetable IDs.
export function groupRouteVariants(rows, cityId) {
  const groups = new Map()
  const routeIdMap = new Map()
  for (const row of rows) {
    const name = row.route_short_name?.trim()
    // Unnamed routes cannot safely be collapsed into one line.
    const id = [cityId, row.agency_id ?? '', row.route_type, name || row.route_id]
      .map(value => encodeURIComponent(value)).join(':')
    routeIdMap.set(row.route_id, id)
    if (!groups.has(id)) groups.set(id, { ...row, route_id: id, sourceRouteIds: [] })
    groups.get(id).sourceRouteIds.push(row.route_id)
  }
  return { rows: [...groups.values()], routeIdMap }
}

// Aggregate scheduled runs across every variant of the same shape. First-trip
// selection can otherwise pick a one-off diversion ahead of the everyday route.
// Whole-feed weights keep regeneration reproducible and include weekend service.
export function createVariantTripSelector(serviceWeights, frequencyMultipliers = new Map()) {
  const patterns = new Map()
  return {
    add(row, routeId) {
      const weight = (serviceWeights.get(row.service_id) ?? 0) *
        (frequencyMultipliers.get(row.trip_id) ?? 1)
      if (!(weight > 0) || !row.shape_id) return
      const dir = Number(row.direction_id || 0)
      const key = `${routeId}_${dir}`
      if (!patterns.has(key)) patterns.set(key, new Map())
      const shapes = patterns.get(key)
      if (!shapes.has(row.shape_id)) shapes.set(row.shape_id, {
        tripId: row.trip_id, shapeId: row.shape_id, dir, weight: 0,
      })
      const pattern = shapes.get(row.shape_id)
      pattern.weight += weight
      if (row.trip_id < pattern.tripId) pattern.tripId = row.trip_id
    },
    finalize() {
      return Object.fromEntries([...patterns].map(([key, shapes]) => {
        const best = [...shapes.values()].sort((a, b) =>
          b.weight - a.weight || a.shapeId.localeCompare(b.shapeId, 'en'))[0]
        const { weight, ...trip } = best
        return [key, trip]
      }))
    },
  }
}
