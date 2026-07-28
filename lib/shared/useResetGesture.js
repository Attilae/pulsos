'use client'

// Several DAW controls reset to their default on double-click (pan to centre,
// a loop region to the full bar, an automation curve to flat). Double-click has
// no reliable touch equivalent — iOS treats a fast double tap as zoom — so this
// hook adds a long-press path that fires the same callback.
//
// Spread the returned props onto the element:
//   <input type="range" {...useResetGesture(() => onPan(0))} />
//
// Note this is an *additional* path, never the only one: every reset also gets
// a visible control in the mobile sheets, because a hidden gesture is not an
// affordance.
import { useCallback, useEffect, useMemo, useRef } from 'react'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 10   // px of drift before we treat it as a drag, not a press

export function useResetGesture(onReset, { delay = LONG_PRESS_MS } = {}) {
  const timerRef = useRef(0)
  const originRef = useRef(null)
  const firedRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = 0 }
    originRef.current = null
  }, [])

  useEffect(() => clear, [clear])

  return useMemo(() => ({
    onDoubleClick: (e) => { e.preventDefault?.(); onReset?.() },

    onPointerDown: (e) => {
      // Mouse users have double-click; a long mouse press would collide with
      // dragging a slider, so the press path is touch/pen only.
      if (e.pointerType === 'mouse') return
      firedRef.current = false
      originRef.current = { x: e.clientX, y: e.clientY }
      timerRef.current = setTimeout(() => {
        firedRef.current = true
        timerRef.current = 0
        onReset?.()
      }, delay)
    },

    onPointerMove: (e) => {
      const origin = originRef.current
      if (!origin || !timerRef.current) return
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_TOLERANCE) clear()
    },

    onPointerUp: (e) => {
      // A long press that already reset must not also count as a value change.
      if (firedRef.current) { e.preventDefault?.(); firedRef.current = false }
      clear()
    },

    onPointerCancel: clear,
    onPointerLeave: clear,
  }), [onReset, delay, clear])
}

export default useResetGesture
