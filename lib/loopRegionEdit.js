// Loop windows use canonical sixteenth cells, independently of the note grid.
import { GRID_TOTAL_CELLS, GRID_STEPS_PER_BAR, GRID_BARS, GRID_RESOLUTION_STEPS_PER_BAR, DEFAULT_GRID_RESOLUTION } from './mappings.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback
export function normalizeLoopRegion(region) {
  const startCell = clamp(Math.round(finite(region?.startCell, 0)), 0, GRID_TOTAL_CELLS - 1)
  const endCell = clamp(Math.round(finite(region?.endCell, GRID_TOTAL_CELLS)), startCell + 1, GRID_TOTAL_CELLS)
  return { startCell, endCell }
}
export function editLoopEdge(region, edge, cell) {
  const r = normalizeLoopRegion(region)
  if (!Number.isFinite(cell)) return r
  return edge === 'start'
    ? { startCell: clamp(Math.round(cell), 0, r.endCell - 1), endCell: r.endCell }
    : { startCell: r.startCell, endCell: clamp(Math.round(cell), r.startCell + 1, GRID_TOTAL_CELLS) }
}
export function loopCellAtPointer(clientX, left, width) {
  if (![clientX, left, width].every(Number.isFinite) || width <= 0) return null
  return Math.round(clamp((clientX - left) / width, 0, 1) * GRID_TOTAL_CELLS)
}
export function loopKeyCell(region, edge, key, shift = false) {
  const r = normalizeLoopRegion(region)
  const start = edge === 'start'
  const value = start ? r.startCell : r.endCell
  const small = shift ? GRID_STEPS_PER_BAR / 4 : 1
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return value - small
    case 'ArrowRight': case 'ArrowUp': return value + small
    case 'PageDown': return value - GRID_STEPS_PER_BAR
    case 'PageUp': return value + GRID_STEPS_PER_BAR
    case 'Home': return start ? 0 : r.startCell + 1
    case 'End': return start ? r.endCell - 1 : GRID_TOTAL_CELLS
    default: return null
  }
}
export function loopGridSize(resolution = DEFAULT_GRID_RESOLUTION) {
  return GRID_BARS * (GRID_RESOLUTION_STEPS_PER_BAR[resolution] ?? GRID_STEPS_PER_BAR)
}
export function stepLoopEdge(region, edge, direction, resolution) {
  const r = normalizeLoopRegion(region)
  const total = loopGridSize(resolution)
  // Fine/triplet boundaries round to the same integer cells the engine uses.
  // Deduplication lets 32nds progress without a second tap at the same boundary.
  const cells = [...new Set(Array.from({ length: total + 1 }, (_, i) => Math.round(i * GRID_TOTAL_CELLS / total)))]
  const value = edge === 'start' ? r.startCell : r.endCell
  const allowed = cells.filter(c => edge === 'start' ? c < r.endCell : c > r.startCell)
  const next = direction > 0 ? allowed.find(c => c > value) : allowed.findLast(c => c < value)
  return next == null ? r : editLoopEdge(r, edge, next)
}
