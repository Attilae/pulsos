'use client'
// Drawn on/off automation for a lane's Arp, Texture or Sidechain device
// (lib/toggleAutomation.js). Breakpoints on the 64-cell grid, Ableton style:
//   click empty space   add a switch point at the snapped cell; the upper half
//                       of the rail is "on", the lower half "off"
//   drag a point        move it in time (snapped, it can't pass its neighbours)
//                       and between on and off
//   double-click point  delete it
//   keyboard            ←/→ move (Shift: one bar), ↑/↓ on/off, Delete removes;
//                       Enter on the rail adds a point after the last one
// The state holds from each point to the next and wraps round the lane's own loop
// window, which is the destination lane's: the switch lands on the notes it gates.
// The playhead is drawn from playheadTicker on the DOM, never React state.
import * as Tone from 'tone'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { subscribePlayhead } from '@/lib/shared/playheadTicker.js'
import {
  TOGGLE_TOTAL_CELLS, toggleWindow, toggleSegments, toggleStateAtPhase, toggleSnapSize,
  setToggleStep, deleteToggleStep, moveToggleStep, normalizeToggleSteps,
} from '@/lib/toggleAutomation.js'
import { IconClose } from '../icons.jsx'
import './ToggleAutomationRail.css'

const ON_Y = 22
const OFF_Y = 78
const BAR_CELLS = 16

export function toggleCellLabel(cell) {
  const bar = Math.floor(cell / BAR_CELLS) + 1
  const beat = Math.floor((cell % BAR_CELLS) / 4) + 1
  const sixteenth = (cell % 4) + 1
  return `${bar}.${beat}.${sixteenth}`
}

export default function ToggleAutomationRail({
  steps: rawSteps, loopRegion, speed = 1, gridResolution, manualOn = false, deviceLabel = 'Device',
  color, started = false, visible = true, inactive = false, onUpdate, onActiveValue, variant = 'rack',
}) {
  const sheet = variant === 'sheet'
  const steps = useMemo(() => normalizeToggleSteps(rawSteps), [rawSteps])
  // Latest steps between a pointer event and the re-render it causes.
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const railRef = useRef(null)
  const needleRef = useRef(null)
  const dragRef = useRef(null)          // { cell } of the point being dragged
  const [dragCell, setDragCell] = useState(null)
  const [focusCell, setFocusCell] = useState(null)

  const win = toggleWindow(loopRegion)
  const { startCell, endCell } = win
  const startPct = (startCell / TOGGLE_TOTAL_CELLS) * 100
  const endPct = (endCell / TOGGLE_TOTAL_CELLS) * 100
  const snap = toggleSnapSize(gridResolution)

  const commit = useCallback((next) => {
    stepsRef.current = next
    onUpdate?.({ steps: next })
  }, [onUpdate])

  // Pointer → { cell, on }. Cells snap to the lane's grid resolution.
  const pointAt = useCallback((e) => {
    const el = railRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    const raw = ((e.clientX - r.left) / r.width) * TOGGLE_TOTAL_CELLS
    const cell = Math.max(0, Math.min(TOGGLE_TOTAL_CELLS - snap, Math.floor(raw / snap) * snap))
    const on = (e.clientY - r.top) / r.height < 0.5
    return { cell, on }
  }, [snap])

  // Capture on the element pressed: a point keeps its own events (so its
  // double-click still reaches it), and its moves bubble up to the rail.
  const beginDrag = (e, cell) => {
    dragRef.current = { cell }
    setDragCell(cell)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onRailDown = (e) => {
    if (e.button != null && e.button !== 0) return
    const p = pointAt(e)
    if (!p) return
    e.preventDefault()
    commit(setToggleStep(stepsRef.current, p.cell, p.on))
    setFocusCell(p.cell)
    beginDrag(e, p.cell)   // click-and-drag places the new point
  }

  const onPointDown = (e, cell) => {
    if (e.button != null && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setFocusCell(cell)
    beginDrag(e, cell)
  }

  const onRailMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const p = pointAt(e)
    if (!p) return
    const cur = stepsRef.current.find(s => s.cell === d.cell)
    if (!cur || (cur.on === p.on && d.cell === p.cell)) return
    const next = moveToggleStep(stepsRef.current, d.cell, p.cell, p.on)
    const moved = next.find(s => !stepsRef.current.some(o => o.cell === s.cell && o.on === s.on)) ?? null
    const newCell = moved?.cell ?? d.cell
    d.cell = newCell
    setDragCell(newCell)
    setFocusCell(newCell)
    commit(next)
  }

  const endDrag = (e) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragCell(null)
    if (e.target?.hasPointerCapture?.(e.pointerId)) e.target.releasePointerCapture(e.pointerId)
  }

  const onPointDouble = (e, cell) => {
    e.preventDefault()
    e.stopPropagation()
    commit(deleteToggleStep(stepsRef.current, cell))
    setFocusCell(null)
  }

  const onPointKey = (e, s) => {
    let next = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const by = (e.shiftKey ? BAR_CELLS : snap) * (e.key === 'ArrowLeft' ? -1 : 1)
      next = moveToggleStep(stepsRef.current, s.cell, s.cell + by)
      const moved = next.find(n => !stepsRef.current.some(o => o.cell === n.cell))
      if (moved) setFocusCell(moved.cell)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      next = setToggleStep(stepsRef.current, s.cell, e.key === 'ArrowUp')
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      next = deleteToggleStep(stepsRef.current, s.cell)
      setFocusCell(null)
      railRef.current?.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      next = setToggleStep(stepsRef.current, s.cell, !s.on)
    }
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    commit(next)
  }

  // Enter on the rail itself (keyboard path to a first point): a point after the
  // last one inside the loop, flipping the state there.
  const addNext = useCallback(() => {
    const cur = stepsRef.current.filter(s => s.cell >= startCell && s.cell < endCell)
    const last = cur[cur.length - 1]
    let cell = last ? last.cell + Math.max(snap, 4) : startCell
    if (cell >= endCell) cell = endCell - snap
    while (stepsRef.current.some(s => s.cell === cell) && cell > startCell) cell -= snap
    if (stepsRef.current.some(s => s.cell === cell)) return
    const on = last ? !last.on : !manualOn
    commit(setToggleStep(stepsRef.current, cell, on))
    setFocusCell(cell)
  }, [startCell, endCell, snap, manualOn, commit])

  const onRailKey = (e) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addNext() }
  }

  // Keep keyboard focus on a point as it moves.
  useEffect(() => {
    if (focusCell == null || dragRef.current) return
    const el = railRef.current?.querySelector(`[data-cell="${focusCell}"]`)
    if (el && document.activeElement !== el && railRef.current?.contains(document.activeElement)) el.focus()
  }, [focusCell, steps])

  // Playhead: the destination lane's loop window at its speed, like its StopRail.
  // Reports the state in effect (1/0) only when it changes.
  useEffect(() => {
    const el = needleRef.current
    if (!el) return undefined
    if (!started || !visible) {
      el.style.transform = `translateX(${startPct}%)`
      if (!started) onActiveValue?.(null)
      return undefined
    }
    let reported = null
    const regionLen = endCell - startCell
    const unsubscribe = subscribePlayhead(() => {
      const bpm = Tone.getTransport().bpm.value || 120
      const partLoopSec = (regionLen / TOGGLE_TOTAL_CELLS) * ((16 / bpm) * 60) / (speed || 1)
      const t = Tone.getTransport().seconds
      const phase = partLoopSec > 0 ? ((t % partLoopSec) + partLoopSec) % partLoopSec / partLoopSec : 0
      el.style.transform = `translateX(${startPct + phase * (endPct - startPct)}%)`
      const on = toggleStateAtPhase(stepsRef.current, phase, win, manualOn) ? 1 : 0
      if (on !== reported) { reported = on; onActiveValue?.(on) }
    })
    return () => { unsubscribe(); onActiveValue?.(null) }
  }, [started, visible, speed, startCell, endCell, startPct, endPct, manualOn, onActiveValue])

  const segments = toggleSegments(steps, win, manualOn)
  const pathPoints = []
  for (const seg of segments) {
    const y = seg.on ? ON_Y : OFF_Y
    pathPoints.push(`${(seg.startCell / TOGGLE_TOTAL_CELLS) * 100},${y}`, `${(seg.endCell / TOGGLE_TOTAL_CELLS) * 100},${y}`)
  }
  const hasPointsInLoop = steps.some(s => s.cell >= startCell && s.cell < endCell)

  return (
    <div className={`toggle-auto${sheet ? ' toggle-auto--sheet' : ''}${inactive ? ' is-inactive' : ''}`} style={{ '--line-color': color }}>
      <div
        ref={railRef}
        className="toggle-auto-rail"
        role="group"
        tabIndex={0}
        aria-label={`${deviceLabel} on/off automation. Click to add a switch point, drag to move, double-click to delete. Press Enter to add one.`}
        onPointerDown={onRailDown}
        onPointerMove={onRailMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onRailKey}
      >
        <span className="auto-axis-label auto-axis-label--top">ON</span>
        <span className="auto-axis-label auto-axis-label--bot">OFF</span>
        {[1, 2, 3].map(b => (
          <span key={b} className="toggle-auto-bar" style={{ left: `${(b * BAR_CELLS / TOGGLE_TOTAL_CELLS) * 100}%` }} aria-hidden="true" />
        ))}
        {startPct > 0 && <div className="loop-region-dim" style={{ left: 0, width: `${startPct}%` }} />}
        {endPct < 100 && <div className="loop-region-dim" style={{ left: `${endPct}%`, width: `${100 - endPct}%` }} />}

        {segments.filter(s => s.on).map(s => (
          <div
            key={s.startCell}
            className="toggle-auto-on"
            style={{ left: `${(s.startCell / TOGGLE_TOTAL_CELLS) * 100}%`, width: `${((s.endCell - s.startCell) / TOGGLE_TOTAL_CELLS) * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <svg className="auto-curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={pathPoints.join(' ')} fill="none" className="toggle-auto-line" vectorEffect="non-scaling-stroke" />
        </svg>

        {!hasPointsInLoop && (
          <span className="toggle-auto-hint" aria-hidden="true">
            {manualOn ? 'On' : 'Off'} for the whole loop. Click to add a switch point
          </span>
        )}

        <div className={`lane-playhead auto-playhead ${started ? 'active' : ''}`}>
          <div ref={needleRef} className="lane-playhead-track" />
        </div>

        {steps.map(s => {
          const outside = s.cell < startCell || s.cell >= endCell
          return (
            <button
              key={s.cell}
              type="button"
              data-cell={s.cell}
              className={`toggle-auto-point${s.on ? ' is-on' : ''}${dragCell === s.cell ? ' dragging' : ''}${outside ? ' is-outside' : ''}`}
              style={{ left: `${(s.cell / TOGGLE_TOTAL_CELLS) * 100}%`, top: `${s.on ? ON_Y : OFF_Y}%` }}
              role="slider"
              aria-label={`${deviceLabel} switch point at ${toggleCellLabel(s.cell)}`}
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={s.on ? 1 : 0}
              aria-valuetext={`${s.on ? 'On' : 'Off'} at bar ${toggleCellLabel(s.cell)}${outside ? ', outside the loop' : ''}`}
              title={`${s.on ? 'On' : 'Off'} at ${toggleCellLabel(s.cell)}. Drag to move, double-click to delete`}
              onPointerDown={e => onPointDown(e, s.cell)}
              onDoubleClick={e => onPointDouble(e, s.cell)}
              onKeyDown={e => onPointKey(e, s)}
              onFocus={() => setFocusCell(s.cell)}
            />
          )
        })}
      </div>

      {sheet && (
        <div className="toggle-auto-list">
          {steps.length === 0 && <p className="toggle-auto-empty">No switch points. The device stays {manualOn ? 'on' : 'off'}.</p>}
          {steps.map(s => (
            <div key={s.cell} className="toggle-auto-row">
              <span className="toggle-auto-pos">{toggleCellLabel(s.cell)}</span>
              <button type="button" aria-label={`Move earlier from ${toggleCellLabel(s.cell)}`}
                onClick={() => commit(moveToggleStep(stepsRef.current, s.cell, s.cell - snap))}>−</button>
              <button type="button" aria-label={`Move later from ${toggleCellLabel(s.cell)}`}
                onClick={() => commit(moveToggleStep(stepsRef.current, s.cell, s.cell + snap))}>+</button>
              <button type="button" className={`toggle-auto-state${s.on ? ' is-on' : ''}`} aria-pressed={s.on}
                onClick={() => commit(setToggleStep(stepsRef.current, s.cell, !s.on))}>{s.on ? 'On' : 'Off'}</button>
              <button type="button" className="toggle-auto-del" aria-label={`Delete switch point at ${toggleCellLabel(s.cell)}`}
                onClick={() => commit(deleteToggleStep(stepsRef.current, s.cell))}><IconClose /></button>
            </div>
          ))}
          <div className="toggle-auto-actions">
            <button type="button" onClick={addNext}>Add switch point</button>
            {steps.length > 0 && <button type="button" onClick={() => commit([])}>Clear all</button>}
          </div>
        </div>
      )}
    </div>
  )
}
