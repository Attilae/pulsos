import { hashStopValue, snapStopsToGrid, GRID_BARS, GRID_STEPS_PER_BAR, GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION, GRID_TOTAL_CELLS } from './mappings.js'
import { normalizeLoopRegion } from './loopRegionEdit.js'

export const clampAutoValue = value => Math.max(0, Math.min(1, value))
export const autoValueToY = value => (0.1 + (1 - value) * 0.8) * 100
export const autoYToValue = fraction => clampAutoValue(1 - (fraction - 0.1) / 0.8)
export const nudgeAutoValue = (value, delta) => clampAutoValue(Math.round((value + delta) * 1e6) / 1e6)
export const automationPointPatch = (points, id, value) => ({ points: { ...points, [id]: clampAutoValue(value) } })

export function automationKeyValue(value, key, shift = false) {
  const fine = shift ? .01 : .05
  const delta = { ArrowUp: fine, ArrowRight: fine, ArrowDown: -fine, ArrowLeft: -fine, PageUp: .25, PageDown: -.25 }[key]
  if (key === 'Home') return 0
  if (key === 'End') return 1
  return delta == null ? null : nudgeAutoValue(value, delta)
}

export function automationPoints(route, laneId, points, resolution) {
  if (!route?.stops?.length) return []
  const steps = GRID_RESOLUTION_STEPS_PER_BAR[resolution ?? DEFAULT_GRID_RESOLUTION] ?? GRID_STEPS_PER_BAR
  const total = GRID_BARS * steps
  return snapStopsToGrid(route.stops, route.totalDist, total, steps).map(stop => {
    const value = typeof points?.[stop.id] === 'number' ? clampAutoValue(points[stop.id]) : hashStopValue(laneId, stop.id)
    return { id: stop.id, name: stop.name, x: stop.cellIdx / total * 100, y: autoValueToY(value), value }
  })
}

// Midpoints give every stop its own column; ties at the same grid cell remain
// reachable through the selected-stop picker rather than overlapping tiny dots.
export function automationPointAt(points, x) {
  if (!points.length) return -1
  let nearest = 0
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i].x - x) < Math.abs(points[nearest].x - x)) nearest = i
  return nearest
}

export function automationPlayPosition(seconds, bpm, speed, region) {
  const { startCell, endCell } = normalizeLoopRegion(region)
  const duration = (endCell - startCell) / GRID_TOTAL_CELLS * 16 / (bpm || 120) * 60 / (speed || 1)
  const local = ((seconds % duration) + duration) % duration / duration
  return (startCell + local * (endCell - startCell)) / GRID_TOTAL_CELLS * 100
}

export function activeAutomationPoint(points, position, region) {
  const { startCell, endCell } = normalizeLoopRegion(region)
  let active = -1
  for (let i = 0; i < points.length; i++) {
    const x = points[i].x
    if (x >= startCell / GRID_TOTAL_CELLS * 100 && x < endCell / GRID_TOTAL_CELLS * 100 && x <= position) active = i
  }
  return active
}
