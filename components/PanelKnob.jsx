'use client'

// A rotary control for the panels modelled on hardware modules (Texture,
// Macro): an SVG pot with a 270° sweep, vertical drag (Shift for fine), arrow,
// Page, Home and End keys, and double-click or long-press to reset. Locked
// knobs (owned by an automation lane) turn amber and ignore input.
//
// `value` is the knob position, 0..1. `bipolar` draws the arc from the centre,
// for controls whose middle is "nothing" (attenuverters, transposes). `steps`
// snaps the position to that many equal steps (keyboard moves one step).

import { useId, useRef, useState } from 'react'
import { useResetGesture } from '@/lib/shared/useResetGesture.js'
import './PanelKnob.css'

const DRAG_PX = 160            // pixels of vertical drag for the full range
const SWEEP = 270              // degrees of rotation, like a panel pot
const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))

// SVG arc between two angles in degrees (0 = straight up, clockwise).
function arcPath(r, from, to) {
  const pt = a => {
    const rad = (a - 90) * Math.PI / 180
    return `${(r * Math.cos(rad)).toFixed(3)} ${(r * Math.sin(rad)).toFixed(3)}`
  }
  const large = to - from > 180 ? 1 : 0
  return `M ${pt(from)} A ${r} ${r} 0 ${large} 1 ${pt(to)}`
}

export default function PanelKnob({
  label, value, onChange, onReset, format, size = 'lg', bipolar = false, steps = 0,
  locked = false, group, laneName, hint, sublabel, dim = false,
}) {
  const id = useId()
  const drag = useRef(null)
  const [active, setActive] = useState(false)
  const reset = useResetGesture(() => { if (!locked) onReset?.() })
  const v = clamp01(value)
  const angle = -SWEEP / 2 + v * SWEEP
  const start = bipolar ? 0 : -SWEEP / 2
  const snap = (x) => (steps > 0 ? Math.round(clamp01(x) * steps) / steps : clamp01(x))

  const set = (next) => {
    if (locked) return
    const s = snap(next)
    if (s !== v) onChange(s)
  }

  const onPointerDown = (e) => {
    reset.onPointerDown?.(e)
    if (locked || e.button > 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.currentTarget.focus()
    drag.current = { y: e.clientY, v }
    setActive(true)
  }
  const onPointerMove = (e) => {
    reset.onPointerMove?.(e)
    if (!drag.current) return
    const scale = e.shiftKey ? DRAG_PX * 4 : DRAG_PX
    set(drag.current.v + (drag.current.y - e.clientY) / scale)
  }
  const end = (e) => {
    reset.onPointerUp?.(e)
    drag.current = null
    setActive(false)
  }
  const onKeyDown = (e) => {
    const fine = steps > 0 ? 1 / steps : 0.01
    const step = steps > 0 ? fine : (e.shiftKey ? 0.1 : fine)
    const page = steps > 0 ? Math.max(fine, 0.1) : 0.1
    const deltas = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: page, PageDown: -page }
    if (e.key in deltas) { e.preventDefault(); set(v + deltas[e.key]) }
    else if (e.key === 'Home') { e.preventDefault(); set(0) }
    else if (e.key === 'End') { e.preventDefault(); set(1) }
  }

  const readout = format(v)
  const name = [laneName, group, label].filter(Boolean).join(' ')
  return (
    <div className={`pk-knob pk-knob--${size}${dim ? ' is-dim' : ''}`}>
      <div
        className={`pk-knob-dial${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(v.toFixed(3))}
        aria-valuetext={locked ? `${readout}, automated` : readout}
        aria-disabled={locked || undefined}
        aria-describedby={`${id}-val`}
        title={locked ? 'Controlled by an automation lane' : `${hint ?? label} Drag up or down (Shift for fine). Double-click to reset.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={reset.onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="-20 -20 40 40" aria-hidden="true" focusable="false">
          <path className="pk-knob-track" d={arcPath(16, -SWEEP / 2, SWEEP / 2)} />
          {Math.abs(angle - start) > 0.5 && (
            <path className="pk-knob-value" d={arcPath(16, Math.min(start, angle), Math.max(start, angle))} />
          )}
          <circle className="pk-knob-body" r="11" />
          <line className="pk-knob-pointer" x1="0" y1="-4" x2="0" y2="-10" transform={`rotate(${angle.toFixed(2)})`} />
        </svg>
      </div>
      <span className="pk-knob-label">{label}</span>
      {sublabel && <span className="pk-knob-sub">{sublabel}</span>}
      <span className="pk-knob-val" id={`${id}-val`}>{locked ? 'auto' : readout}</span>
    </div>
  )
}
