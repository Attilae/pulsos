// Per-stop editor modal for the Map/DAW stop rail. Opened by clicking a note dot;
// edits pitch (diatonic ± steps, stays in key), velocity (0.2..1) and chance
// (0..1, overriding the lane's note chance — see lib/laneGating.js). Edits are
// live — each control fires its callback immediately, so there is no Apply button.
//
// Driven by an `editingStop` payload assembled in DawView's StopRail:
//   { routeId, stopId, stopName, geoNote, degrees, velocity, chance, laneChance,
//     root, scaleType, semitoneShift }
// `chance` is the stop's own override, or null when it follows `laneChance`.
// `geoNote` is the octave-shifted, offset-free geographic note; the displayed pitch
// applies its diatonic edit first, then the lane's chromatic transpose.
'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModal } from '@/lib/shared/useModal.js'
import { shiftSemitones, transposeNoteInScale } from '@/lib/mappings.js'
import './StopEditor.css'
import { IconClose } from './icons.jsx'

const DEGREE_LIMIT = 14   // ±2 octaves of diatonic steps

export default function StopEditor({ editingStop, onClose, onPitch, onVelocity, onChance }) {
  const { routeId, stopId, stopName, geoNote, root, scaleType, semitoneShift = 0 } = editingStop
  const [degrees,  setDegrees]  = useState(editingStop.degrees ?? 0)
  const [velocity, setVelocity] = useState(editingStop.velocity ?? 1)
  const laneChance = editingStop.laneChance ?? 1
  const [chance, setChance] = useState(editingStop.chance ?? null)

  const panelRef = useRef(null)
  const titleId = useId()
  useModal(true, panelRef, { onClose })

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

  const changeChance = useCallback((pct) => {
    const c = Math.max(0, Math.min(1, pct / 100))
    setChance(c)
    onChance?.(routeId, stopId, c)
  }, [routeId, stopId, onChance])

  const followLane = useCallback(() => {
    setChance(null)
    onChance?.(routeId, stopId, null)
  }, [routeId, stopId, onChance])

  const baseNote = shiftSemitones(geoNote, semitoneShift)
  const currentNote = shiftSemitones(
    transposeNoteInScale(geoNote, degrees, root, scaleType),
    semitoneShift,
  )
  const velPct = Math.round(velocity * 100)
  const chancePct = Math.round((chance ?? laneChance) * 100)

  return createPortal(
    <div className="dlg-overlay" onPointerDown={onClose}>
      <div
        ref={panelRef}
        className="stop-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="stop-editor-head">
          <h2 id={titleId} className="dlg-title">{stopName || 'Stop'}</h2>
          <button className="stop-editor-close" onClick={onClose} title="Close" aria-label="Close"><IconClose /></button>
        </div>

        <div className="stop-editor-row">
          <span className="stop-editor-label">Pitch</span>
          <div className="stop-editor-control">
            <button className="stop-editor-step" onClick={() => stepPitch(-1)} title="Down a scale degree" aria-label="Pitch down a scale degree">−</button>
            <span className="stop-editor-note" aria-live="polite">{currentNote}</span>
            <button className="stop-editor-step" onClick={() => stepPitch(1)} title="Up a scale degree" aria-label="Pitch up a scale degree">+</button>
            <span className="stop-editor-meta">
              {degrees === 0 ? 'geographic' : `${degrees > 0 ? '+' : ''}${degrees} · was ${baseNote}`}
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
              aria-label="Velocity"
              aria-valuetext={`${velPct}%`}
              value={velPct}
              onChange={e => changeVelocity(Number(e.target.value))}
            />
            <span className="stop-editor-note stop-editor-note--vel">{velPct}%</span>
          </div>
          <button className="stop-editor-reset" onClick={resetVelocity} disabled={velPct === 100}>Reset</button>
        </div>

        {onChance && (
          <div className="stop-editor-row">
            <span className="stop-editor-label">Chance</span>
            <div className="stop-editor-control">
              <input
                className="stop-editor-slider"
                type="range" min="0" max="100" step="5"
                aria-label="Chance"
                aria-valuetext={`${chancePct}%${chance == null ? ', from lane' : ''}`}
                value={chancePct}
                onChange={e => changeChance(Number(e.target.value))}
                title="How likely this note is to play on each loop"
              />
              <span className="stop-editor-note stop-editor-note--vel">{chancePct}%</span>
              <span className="stop-editor-meta">{chance == null ? 'lane' : 'own'}</span>
            </div>
            <button className="stop-editor-reset" onClick={followLane} disabled={chance == null}
              title={`Follow the lane's chance (${Math.round(laneChance * 100)}%)`}>Lane</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
