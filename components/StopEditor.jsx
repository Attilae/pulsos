// Per-stop editor modal for the Map/DAW stop rail. Opened by clicking a note dot;
// edits pitch (diatonic ± steps, stays in key) and velocity (0.2..1). Edits are
// live — each control fires its callback immediately, so there is no Apply button.
//
// Driven by an `editingStop` payload assembled in DawView's StopRail:
//   { routeId, stopId, stopName, geoNote, degrees, velocity, root, scaleType }
// `geoNote` is the octave-shifted, offset-free geographic note; the displayed pitch
// is `transposeNoteInScale(geoNote, degrees, root, scaleType)`.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { transposeNoteInScale } from '@/lib/mappings.js'
import './StopEditor.css'

const DEGREE_LIMIT = 14   // ±2 octaves of diatonic steps

export default function StopEditor({ editingStop, onClose, onPitch, onVelocity }) {
  const { routeId, stopId, stopName, geoNote, root, scaleType } = editingStop
  const [degrees,  setDegrees]  = useState(editingStop.degrees ?? 0)
  const [velocity, setVelocity] = useState(editingStop.velocity ?? 1)

  // Esc closes.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const stepPitch = useCallback((delta) => {
    const next = Math.max(-DEGREE_LIMIT, Math.min(DEGREE_LIMIT, degrees + delta))
    if (next === degrees) return
    setDegrees(next)
    onPitch?.(routeId, stopId, next)
  }, [degrees, routeId, stopId, onPitch])

  const resetPitch = useCallback(() => {
    setDegrees(0)
    onPitch?.(routeId, stopId, 0)
  }, [routeId, stopId, onPitch])

  const changeVelocity = useCallback((pct) => {
    const v = Math.max(0.2, Math.min(1, pct / 100))
    setVelocity(v)
    onVelocity?.(routeId, stopId, v)
  }, [routeId, stopId, onVelocity])

  const resetVelocity = useCallback(() => {
    setVelocity(1)
    onVelocity?.(routeId, stopId, 1)
  }, [routeId, stopId, onVelocity])

  const currentNote = transposeNoteInScale(geoNote, degrees, root, scaleType)
  const velPct = Math.round(velocity * 100)

  return createPortal(
    <div className="dlg-overlay" onMouseDown={onClose}>
      <div className="stop-editor" onMouseDown={e => e.stopPropagation()}>
        <div className="stop-editor-head">
          <h2 className="dlg-title">{stopName || 'Stop'}</h2>
          <button className="stop-editor-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="stop-editor-row">
          <span className="stop-editor-label">Pitch</span>
          <div className="stop-editor-control">
            <button className="stop-editor-step" onClick={() => stepPitch(-1)} title="Down a scale degree">−</button>
            <span className="stop-editor-note">{currentNote}</span>
            <button className="stop-editor-step" onClick={() => stepPitch(1)} title="Up a scale degree">+</button>
            <span className="stop-editor-meta">
              {degrees === 0 ? 'geographic' : `${degrees > 0 ? '+' : ''}${degrees} · was ${geoNote}`}
            </span>
          </div>
          <button className="stop-editor-reset" onClick={resetPitch} disabled={degrees === 0}>Reset</button>
        </div>

        <div className="stop-editor-row">
          <span className="stop-editor-label">Velocity</span>
          <div className="stop-editor-control">
            <input
              className="stop-editor-slider"
              type="range" min="20" max="100" step="1"
              value={velPct}
              onChange={e => changeVelocity(Number(e.target.value))}
            />
            <span className="stop-editor-note stop-editor-note--vel">{velPct}%</span>
          </div>
          <button className="stop-editor-reset" onClick={resetVelocity} disabled={velPct === 100}>Reset</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
