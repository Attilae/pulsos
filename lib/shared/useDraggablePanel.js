'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Lets a fixed-position panel be dragged anywhere by a handle, kept inside the
// viewport, with its spot remembered per browser.
//
// Until the first drag the panel keeps its CSS position (`style` is empty), so
// the stylesheet's default placement and media queries still apply. Pass
// `enabled: false` where the stylesheet must win outright (the phone sheet).
//
// The handle is usually also a button, so a press that moved further than
// DRAG_THRESHOLD_PX swallows the click that follows it: dragging the AI
// composer by its header must not also collapse it.

const DRAG_THRESHOLD_PX = 4

function readStored(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? value : null
  } catch {
    return null
  }
}

function writeStored(key, pos) {
  try { localStorage.setItem(key, JSON.stringify(pos)) } catch { /* private mode etc. */ }
}

export function useDraggablePanel({ storageKey, enabled = true, margin = 8 }) {
  const panelRef = useRef(null)
  const dragRef = useRef(null) // { pointerId, startX, startY, originX, originY, moved, last }
  const suppressClickRef = useRef(false)
  const [pos, setPos] = useState(() => (enabled ? readStored(storageKey) : null))
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback((p) => {
    const el = panelRef.current
    if (!p || !el) return p
    const { width, height } = el.getBoundingClientRect()
    const maxX = Math.max(margin, window.innerWidth - width - margin)
    const maxY = Math.max(margin, window.innerHeight - height - margin)
    const x = Math.min(Math.max(p.x, margin), maxX)
    const y = Math.min(Math.max(p.y, margin), maxY)
    return x === p.x && y === p.y ? p : { x, y }
  }, [margin])

  // Keep a placed panel on screen when the window shrinks or the panel grows
  // (expanding it, or a plan preview arriving, near the bottom edge).
  const placed = enabled && pos != null
  useEffect(() => {
    if (!placed) return undefined
    const reclamp = () => setPos(p => clamp(p))
    reclamp()
    const observer = new ResizeObserver(reclamp)
    if (panelRef.current) observer.observe(panelRef.current)
    window.addEventListener('resize', reclamp)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reclamp)
    }
  }, [placed, clamp])

  const onPointerDown = (e) => {
    if (!enabled || e.button !== 0 || !panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      originX: rect.left, originY: rect.top,
      moved: false,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      drag.moved = true
      setDragging(true)
    }
    drag.last = clamp({ x: drag.originX + dx, y: drag.originY + dy })
    setPos(drag.last)
  }

  const endDrag = (e) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!drag.moved) return
    setDragging(false)
    suppressClickRef.current = e.type === 'pointerup'
    if (drag.last) writeStored(storageKey, drag.last)
  }

  const onClickCapture = (e) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  const style = placed ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined

  return {
    panelRef,
    style,
    dragging,
    handleProps: enabled
      ? { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onClickCapture }
      : {},
  }
}
