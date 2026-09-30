'use client'

// Keyboard contract for every overlay (dialogs, editors, sheets, the header
// drawer): focus moves in on open, Tab/Shift-Tab cycle inside the panel, Esc
// closes, and focus goes back to whatever opened it.
//
// Overlays stack (a confirm over a sheet, the stop editor over the DAW), so
// open modals register on a module-level stack and only the topmost one
// reacts to Esc/Tab. That replaces the per-component "capture + stopPropagation"
// Esc listeners, which only worked when the inner one happened to register last.

import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const stack = []  // open modal tokens, topmost last

function focusablesIn(panel) {
  if (!panel) return []
  // getClientRects() is empty for display:none subtrees, so collapsed sections
  // don't become invisible Tab stops.
  return [...panel.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length > 0)
}

/**
 * @param {boolean} open
 * @param {{ current: HTMLElement | null }} panelRef  the dialog element (give it tabIndex={-1})
 * @param {{ onClose?: () => void, initialFocusRef?: { current: HTMLElement | null } }} [opts]
 */
export function useModal(open, panelRef, { onClose, initialFocusRef } = {}) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return undefined
    const token = {}
    stack.push(token)
    const restoreTo = document.activeElement
    const isTop = () => stack[stack.length - 1] === token

    // Deferred a tick so a component's own autoFocus / focus effect wins.
    const focusTimer = setTimeout(() => {
      const panel = panelRef.current
      if (!panel || panel.contains(document.activeElement)) return
      const target = initialFocusRef?.current ?? focusablesIn(panel)[0] ?? panel
      target.focus?.()
    }, 0)

    function onKeyDown(e) {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = focusablesIn(panel)
      if (!items.length) { e.preventDefault(); panel.focus?.(); return }
      const first = items[0]
      const last  = items[items.length - 1]
      const active = document.activeElement
      if (!panel.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      const i = stack.indexOf(token)
      if (i >= 0) stack.splice(i, 1)
      if (restoreTo && restoreTo.isConnected) restoreTo.focus?.()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
}
