// Modal shown when duplicating an instrument lane. Asks whether to transpose the
// new copy by ± semitones (chromatic). Confirming with 0 = a plain unison copy,
// matching the pre-modal behavior. Modeled on StopEditor.jsx (portal, Esc-close),
// reusing the shared .dlg-* classes (Dialog.css) and .stop-editor-step stepper.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './Dialog.css'
import './StopEditor.css'

const SEMI_LIMIT = 24   // ±2 octaves of chromatic steps

export default function DuplicateLaneDialog({ routeName, onConfirm, onClose }) {
  const [semitones, setSemitones] = useState(0)

  const confirm = useCallback(() => { onConfirm?.(semitones) }, [semitones, onConfirm])

  // Esc closes; Enter confirms.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      else if (e.key === 'Enter') { e.stopPropagation(); confirm() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose, confirm])

  const step = useCallback((delta) => {
    setSemitones(v => Math.max(-SEMI_LIMIT, Math.min(SEMI_LIMIT, v + delta)))
  }, [])

  const hint = semitones === 0
    ? 'unison (exact copy)'
    : `${semitones > 0 ? '+' : ''}${semitones} semitone${Math.abs(semitones) === 1 ? '' : 's'}`

  return createPortal(
    <div className="dlg-overlay" onMouseDown={onClose}>
      <div className="dlg-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="dlg-title">Duplicate lane</div>
        <div className="dlg-message">
          Copy “{routeName}” into a new lane{semitones === 0 ? '.' : ', transposing the whole lane.'}
        </div>

        <div className="stop-editor-row">
          <span className="stop-editor-label">Shift</span>
          <div className="stop-editor-control">
            <button className="stop-editor-step" onClick={() => step(-1)} title="Down a semitone">−</button>
            <span className="stop-editor-note">{semitones > 0 ? '+' : ''}{semitones}</span>
            <button className="stop-editor-step" onClick={() => step(1)} title="Up a semitone">+</button>
            <span className="stop-editor-meta">{hint}</span>
          </div>
          <button className="stop-editor-reset" onClick={() => setSemitones(0)} disabled={semitones === 0}>Reset</button>
        </div>

        <div className="dlg-actions">
          <button className="dlg-btn dlg-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="dlg-btn dlg-btn--primary" onClick={confirm}>Duplicate</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
