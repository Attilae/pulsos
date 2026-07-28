// The app's one bottom-sheet primitive — the mobile counterpart to a desktop
// popover or side panel. Used for the device rack, the More menu, the song
// menu, the audio troubleshooter and the first-run notice.
//
// Deliberately NOT routed through Dialog.jsx's DialogHost: that host is a
// promise-based alert/confirm queue, which is the wrong shape for rich,
// stateful content that stays open while the user edits things behind it.
//
// Below 768px this renders as a bottom sheet with a drag-down-to-dismiss
// grabber; at 768px and up the same markup becomes a centred modal panel, so
// call sites never branch on viewport.
'use client'

import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './Sheet.css'

const DISMISS_DISTANCE = 90   // px dragged down before a release closes the sheet
const DISMISS_VELOCITY = 0.6  // px/ms — a quick flick closes from any distance

export default function Sheet({
  open,
  title,
  onClose,
  children,
  footer = null,
  className = '',
  labelledBy,
}) {
  const panelRef = useRef(null)
  const dragRef = useRef(null)     // { startY, startT, dy } while a drag is live
  const restoreFocusRef = useRef(null)

  const close = useCallback(() => { onClose?.() }, [onClose])

  // Esc closes. Capture phase + stopPropagation matches Dialog.jsx so a sheet
  // opened over another overlay doesn't dismiss both at once.
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  // Lock the page behind the sheet: without this, scrolling past the end of the
  // sheet's own content scrolls the DAW underneath it on iOS.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Move focus in on open, hand it back on close.
  useEffect(() => {
    if (!open) return undefined
    restoreFocusRef.current = document.activeElement
    const t = setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const first = panel.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ;(first ?? panel).focus?.()
    }, 0)
    return () => {
      clearTimeout(t)
      restoreFocusRef.current?.focus?.()
      restoreFocusRef.current = null
    }
  }, [open])

  // ── Drag-down-to-dismiss ──────────────────────────────────────────────────
  // Pointer events with capture, the same technique the DAW's loop handles and
  // automation dots already use, so it works identically for mouse and touch.
  const onGrabberDown = (e) => {
    const panel = panelRef.current
    if (!panel) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { startY: e.clientY, startT: performance.now(), dy: 0 }
    panel.style.transition = 'none'
  }

  const onGrabberMove = (e) => {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || !panel) return
    // Downward only — dragging up shouldn't detach the sheet from the edge.
    drag.dy = Math.max(0, e.clientY - drag.startY)
    panel.style.transform = `translateY(${drag.dy}px)`
  }

  const endDrag = (e) => {
    const drag = dragRef.current
    const panel = panelRef.current
    dragRef.current = null
    if (!drag || !panel) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    panel.style.transition = ''
    panel.style.transform = ''
    const velocity = drag.dy / Math.max(1, performance.now() - drag.startT)
    if (drag.dy > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY) close()
  }

  if (!open) return null

  return createPortal(
    <div
      className="sheet-overlay"
      // pointerdown, not mousedown: synthesized mouse events on touch fire late
      // and don't survive a scroll, so taps on the scrim were unreliable.
      onPointerDown={close}
    >
      <div
        ref={panelRef}
        className={`sheet-panel ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onPointerDown={e => e.stopPropagation()}
      >
        <div
          className="sheet-grabber"
          onPointerDown={onGrabberDown}
          onPointerMove={onGrabberMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-hidden="true"
        >
          <span className="sheet-grabber-bar" />
        </div>

        <header className="sheet-head">
          {title && <h2 className="sheet-title">{title}</h2>}
          <button type="button" className="sheet-close" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="sheet-body">{children}</div>

        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
