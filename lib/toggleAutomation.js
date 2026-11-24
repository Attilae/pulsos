// Device on/off automation: drawn step envelopes that switch a lane's Arp,
// Texture (granular) or Sidechain device on and off over the lane's own loop.
//
// Pure and dependency-free (imported by the engine, the UI, song state and MIDI
// export). Unlike the stop-driven automation lanes (lib/automationTrack.js), a
// toggle lane has no source line: it stores breakpoints on the shared 64-cell
// grid (4 bars × 16ths), `steps: [{ cell, on }]`, and plays them over the
// *destination* lane's loop window and speed, so a switch always lands on the
// notes it gates.
//
// Step semantics (an Ableton step envelope on a loop):
//   - the state at a cell is the last step at or before it inside the loop window;
//   - before the first step it wraps round to the last step in the window;
//   - with no step inside the window the device keeps its manual setting.

export const TOGGLE_TOTAL_CELLS = 64
const STEPS_PER_BAR = 16
const MAX_STEPS = TOGGLE_TOTAL_CELLS
// A note scheduled exactly on a step's cell must see that step, whatever the
// floating-point error of ticks → phase → cell.
const CELL_EPS = 1e-4

export const TOGGLE_TARGETS = [
  { id: 'device.arp',       label: 'Arp on/off',       group: 'Devices', toggle: true, device: 'arp',       min: 0, max: 1 },
  { id: 'device.texture',   label: 'Texture on/off',   group: 'Devices', toggle: true, device: 'texture',   min: 0, max: 1 },
  { id: 'device.sidechain', label: 'Sidechain on/off', group: 'Devices', toggle: true, device: 'sidechain', min: 0, max: 1 },
]

const BY_ID = new Map(TOGGLE_TARGETS.map(t => [t.id, t]))
export const TOGGLE_DEVICES = TOGGLE_TARGETS.map(t => t.device)

export function isToggleTarget(id) { return BY_ID.has(id) }
export function toggleTargetSpec(id) { return BY_ID.get(id) ?? null }
export function toggleDeviceOf(id) { return BY_ID.get(id)?.device ?? null }

// Steps from anywhere (a saved song, a shared link, a drag): integer cells
// 0..63, boolean states, one step per cell (the last one wins), sorted.
export function normalizeToggleSteps(steps) {
  if (!Array.isArray(steps)) return []
  const byCell = new Map()
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue
    const cell = Number(s.cell)
    if (!Number.isFinite(cell)) continue
    const c = Math.round(cell)
    if (c < 0 || c >= TOGGLE_TOTAL_CELLS) continue
    byCell.set(c, !!s.on)
  }
  return [...byCell.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_STEPS)
    .map(([cell, on]) => ({ cell, on }))
}

// The lane's loop window, clamped the way the engine clamps it.
export function toggleWindow(region) {
  const start = Math.max(0, Math.min(TOGGLE_TOTAL_CELLS - 1, Math.round(region?.startCell ?? 0)))
  const end = Math.max(start + 1, Math.min(TOGGLE_TOTAL_CELLS, Math.round(region?.endCell ?? TOGGLE_TOTAL_CELLS)))
  return { startCell: start, endCell: end }
}

function stepsInWindow(steps, window) {
  const { startCell, endCell } = toggleWindow(window)
  return (steps ?? []).filter(s => s.cell >= startCell && s.cell < endCell)
}

// Device state at `cell` (may be fractional) of a lane looping over `window`.
export function toggleStateAtCell(steps, cell, window, fallback = false) {
  const inWin = stepsInWindow(steps, window)
  if (!inWin.length) return !!fallback
  let state = inWin[inWin.length - 1].on   // wraps from the end of the loop
  for (const s of inWin) {
    if (s.cell <= cell + CELL_EPS) state = s.on
    else break
  }
  return !!state
}

// The same at a loop phase 0..1 (0 = loop start).
export function toggleStateAtPhase(steps, phase, window, fallback = false) {
  const { startCell, endCell } = toggleWindow(window)
  const p = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0
  return toggleStateAtCell(steps, startCell + p * (endCell - startCell), window, fallback)
}

// Contiguous on/off blocks covering the window, for drawing.
export function toggleSegments(steps, window, fallback = false) {
  const { startCell, endCell } = toggleWindow(window)
  const inWin = stepsInWindow(steps, window)
  const bounds = [startCell, ...inWin.map(s => s.cell).filter(c => c > startCell), endCell]
  const out = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1]
    if (b <= a) continue
    const on = toggleStateAtCell(steps, a, window, fallback)
    const prev = out[out.length - 1]
    if (prev && prev.on === on) prev.endCell = b
    else out.push({ startCell: a, endCell: b, on })
  }
  return out
}

// Engine schedule for a lane's loop: where the state changes, as loop phases
// 0..1, starting with the state at the loop start. Redundant steps (same state
// as before) are dropped.
export function toggleTransitions(steps, window, fallback = false) {
  const { startCell, endCell } = toggleWindow(window)
  const len = endCell - startCell
  return toggleSegments(steps, window, fallback).map(seg => ({ phase: (seg.startCell - startCell) / len, on: seg.on }))
}

// Cells per snap step at a lane grid resolution ('16n' → 1, '8n' → 2, '4n' → 4).
// Triplet grids have no whole-cell step, so they snap to the 16th grid.
const RATE_STEPS = { '4n': 4, '8n': 8, '8t': 12, '16n': 16, '16t': 24, '32n': 32 }
export function toggleSnapSize(rate) {
  const perBar = RATE_STEPS[rate] ?? STEPS_PER_BAR
  const size = STEPS_PER_BAR / perBar
  return Number.isInteger(size) && size >= 1 ? size : 1
}

export function snapToggleCell(cell, rate) {
  const size = toggleSnapSize(rate)
  const snapped = Math.round(cell / size) * size
  return Math.max(0, Math.min(TOGGLE_TOTAL_CELLS - 1, snapped))
}

// ── Edits (each returns a new array) ──────────────────────────────────────────

export function setToggleStep(steps, cell, on) {
  const c = Math.round(cell)
  if (!(c >= 0 && c < TOGGLE_TOTAL_CELLS)) return normalizeToggleSteps(steps)
  return normalizeToggleSteps([...(steps ?? []).filter(s => s.cell !== c), { cell: c, on: !!on }])
}

export function deleteToggleStep(steps, cell) {
  return normalizeToggleSteps((steps ?? []).filter(s => s.cell !== cell))
}

// Move the step at `fromCell` to `toCell` (and optionally a new state). A step
// can't pass its neighbours, as in Ableton: it stops one cell short of them.
export function moveToggleStep(steps, fromCell, toCell, on) {
  const list = normalizeToggleSteps(steps)
  const idx = list.findIndex(s => s.cell === fromCell)
  if (idx < 0) return list
  const lo = idx > 0 ? list[idx - 1].cell + 1 : 0
  const hi = idx < list.length - 1 ? list[idx + 1].cell - 1 : TOGGLE_TOTAL_CELLS - 1
  const cell = Math.max(lo, Math.min(hi, Math.round(toCell)))
  const next = list.slice()
  next[idx] = { cell, on: on == null ? list[idx].on : !!on }
  return next
}

// ── Availability ──────────────────────────────────────────────────────────────

// Whether a device toggle can do anything on this lane right now, and why not.
// ctx: { textureSupported, sidechainSource }. An inactive lane is kept, like the
// other model-specific targets, and resumes when the lane can host it again.
export function toggleTargetActive(id, ctx = {}) {
  const device = toggleDeviceOf(id)
  if (device === 'texture' && ctx.textureSupported === false) {
    return { active: false, reason: 'this instrument can\'t host the grain layer' }
  }
  if (device === 'sidechain' && !ctx.sidechainSource) {
    return { active: false, reason: 'pick a sidechain source in the device rack' }
  }
  return { active: true, reason: null }
}

// Merge every toggle lane of one destination route into { device → steps }.
// `lanes` is the route's automation cfg map (laneId → cfg). When two lanes
// drive one device, the last one wins.
export function toggleLanesByDevice(lanes) {
  const out = {}
  for (const cfg of Object.values(lanes ?? {})) {
    const device = toggleDeviceOf(cfg?.paramTarget)
    if (device) out[device] = normalizeToggleSteps(cfg.steps)
  }
  return out
}

// A device's manual (rack button) state, the fallback of its on/off lane, from
// the lane's saved device configs.
export function deviceManualOn(paramTarget, { arp, granular, sidechain } = {}) {
  const device = toggleDeviceOf(paramTarget)
  if (device === 'arp') return !!arp?.enabled
  if (device === 'texture') return !!granular?.enabled
  if (device === 'sidechain') return !!sidechain?.enabled
  return false
}
