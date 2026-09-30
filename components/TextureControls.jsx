'use client'

// The Texture panel (NEXT_PUBLIC_GRANULAR_ENGINE=clouds): the lane's granular
// processor, laid out after the front panel of the module its DSP comes from
// (Clouds, Emilie Gillet; see dsp/clouds/README.md). Like the module:
//   - FREEZE latches the recording buffer; the BLEND selector is button B, and
//     its four meters stand in for the four blend LEDs;
//   - POSITION · SIZE · PITCH on the first row, DENSITY · TEXTURE · BLEND on the
//     second, IN GAIN as the small knob;
//   - BLEND edits whichever of dry/wet, spread, feedback or reverb is selected.
// Drawn in Leið's own rack-card language, not as a copy of the module's panel.
//
// Values are the lane's granular cfg (tx* keys, lib/granularEngine.js). Knobs
// owned by an armed grain.* automation lane lock and follow the live value.

import { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react'
import { TEXTURE_BLEND_PARAMS, TEXTURE_DEFAULTS, TEXTURE_KNOBS } from '@/lib/granularEngine.js'
import { getCloudsStatus, subscribeCloudsStatus } from '@/lib/cloudsGranularLoader.js'
import { useResetGesture } from '@/lib/shared/useResetGesture.js'
import './TextureControls.css'

const KNOB = Object.fromEntries(TEXTURE_KNOBS.map(k => [k.key, k]))
const DRAG_PX = 160            // pixels of vertical drag for the full range
const SWEEP = 270              // degrees of rotation, like a panel pot
const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
const pct = v => `${Math.round(clamp01(v) * 100)}%`

function useTextureStatus() {
  return useSyncExternalStore(subscribeCloudsStatus, getCloudsStatus, () => 'idle')
}

// SVG arc between two angles in degrees (0 = straight up, clockwise).
function arcPath(r, from, to) {
  const pt = a => {
    const rad = (a - 90) * Math.PI / 180
    return `${(r * Math.cos(rad)).toFixed(3)} ${(r * Math.sin(rad)).toFixed(3)}`
  }
  const large = to - from > 180 ? 1 : 0
  return `M ${pt(from)} A ${r} ${r} 0 ${large} 1 ${pt(to)}`
}

// A rotary control. `value` is 0..1; `onChange(next)`; `onReset()`.
export function Knob({ label, value, onChange, onReset, format, size = 'lg', bipolar = false, locked = false, laneName, hint }) {
  const id = useId()
  const drag = useRef(null)
  const [active, setActive] = useState(false)
  const reset = useResetGesture(() => { if (!locked) onReset?.() })
  const v = clamp01(value)
  const angle = -SWEEP / 2 + v * SWEEP
  const start = bipolar ? 0 : -SWEEP / 2

  const set = (next) => { if (!locked) onChange(clamp01(next)) }

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
    const step = e.shiftKey ? 0.1 : 0.01
    const deltas = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1 }
    if (e.key in deltas) { e.preventDefault(); set(v + deltas[e.key]) }
    else if (e.key === 'Home') { e.preventDefault(); set(0) }
    else if (e.key === 'End') { e.preventDefault(); set(1) }
  }

  const readout = format(v)
  return (
    <div className={`tx-knob tx-knob--${size}`}>
      <div
        className={`tx-knob-dial${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={laneName ? `${laneName} Texture ${label}` : `Texture ${label}`}
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
          <path className="tx-knob-track" d={arcPath(16, -SWEEP / 2, SWEEP / 2)} />
          {Math.abs(angle - start) > 0.5 && (
            <path className="tx-knob-value" d={arcPath(16, Math.min(start, angle), Math.max(start, angle))} />
          )}
          <circle className="tx-knob-body" r="11" />
          <line className="tx-knob-pointer" x1="0" y1="-4" x2="0" y2="-10" transform={`rotate(${angle.toFixed(2)})`} />
        </svg>
      </div>
      <span className="tx-knob-label">{label}</span>
      <span className="tx-knob-val" id={`${id}-val`}>{locked ? 'auto' : readout}</span>
    </div>
  )
}

export default function TextureControls({ cfg, onChange, autoTargets, laneName }) {
  const status = useTextureStatus()
  const c = { ...TEXTURE_DEFAULTS, ...cfg }
  const on = !!c.enabled
  const [blendKey, setBlendKey] = useState('txBlend')
  const blend = TEXTURE_BLEND_PARAMS.find(b => b.key === blendKey) ?? TEXTURE_BLEND_PARAMS[0]

  // An armed grain.<key> automation lane owns that control: locked, showing the
  // swept value (targets are 0..1, so the live value needs no denormalizing).
  const auto = useCallback((key) => {
    const a = autoTargets?.[`grain.${key}`]
    return a ? { locked: true, live: typeof a.value === 'number' ? a.value : null } : { locked: false, live: null }
  }, [autoTargets])

  const knob = (key) => {
    const spec = KNOB[key]
    const a = auto(key)
    return (
      <Knob
        label={spec.label}
        value={a.live ?? c[key]}
        onChange={v => onChange({ [key]: v })}
        onReset={() => onChange({ [key]: spec.default })}
        format={spec.format}
        size={spec.size}
        bipolar={!!spec.bipolar}
        locked={a.locked}
        laneName={laneName}
        hint={spec.hint}
      />
    )
  }

  const blendAuto = auto(blend.key)

  return (
    <div className="rack-card rack-card--sound tx-card">
      <div className="rack-card-head">
        Texture
        <button
          type="button"
          className={`legato-btn tx-power${on ? ' is-on' : ''}`}
          aria-pressed={on}
          aria-label={laneName ? `Texture on ${laneName}` : 'Texture'}
          onClick={() => onChange({ enabled: !on })}
          title={on
            ? 'Texture is processing this lane. Click to turn it off.'
            : 'Run this lane through Texture: grains of its last second, played around the dry sound.'}
        >{on ? 'ON' : 'OFF'}</button>
      </div>

      {on && status === 'loading' && <p className="tx-status" role="status">Loading Texture…</p>}
      {on && status === 'error' && (
        <p className="tx-status tx-status--error" role="alert">
          Texture could not load, so the lane plays dry. Press play to try again.
        </p>
      )}

      <div className={`tx-body${on ? '' : ' is-off'}`} inert={!on}>
        <div className="tx-strip">
          <button
            type="button"
            className={`tx-freeze${c.txFreeze ? ' is-on' : ''}`}
            aria-pressed={!!c.txFreeze}
            onClick={() => onChange({ txFreeze: !c.txFreeze })}
            title="Stop recording: grains keep playing whatever is in the buffer now."
          >
            <span className="tx-lamp" aria-hidden="true" />
            Freeze
          </button>
          <div className="tx-blend-select" role="radiogroup" aria-label="What the Blend knob controls">
            {TEXTURE_BLEND_PARAMS.map(b => {
              const value = auto(b.key).live ?? c[b.key]
              return (
                <button
                  key={b.key}
                  type="button"
                  role="radio"
                  aria-checked={b.key === blend.key}
                  aria-label={`${b.label}, ${pct(value)}`}
                  className={`tx-blend-opt${b.key === blend.key ? ' is-active' : ''}`}
                  onClick={() => setBlendKey(b.key)}
                  title={`${b.label}: ${b.hint}`}
                >
                  <span className="tx-blend-name" aria-hidden="true">{b.short}</span>
                  <span className="tx-meter" aria-hidden="true">
                    <span className="tx-meter-fill" style={{ transform: `scaleX(${clamp01(value)})` }} />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="tx-row">
          {knob('txPosition')}
          {knob('txSize')}
          {knob('txPitch')}
        </div>
        <div className="tx-row">
          {knob('txDensity')}
          {knob('txTexture')}
          <Knob
            label={`Blend ${blend.short}`}
            value={blendAuto.live ?? c[blend.key]}
            onChange={v => onChange({ [blend.key]: v })}
            onReset={() => onChange({ [blend.key]: blend.default })}
            format={pct}
            locked={blendAuto.locked}
            laneName={laneName}
            hint={`${blend.label}: ${blend.hint}`}
          />
        </div>
        <div className="tx-row tx-row--foot">
          {knob('txInGain')}
          <p className="tx-hint">Each lane note triggers a grain. With Density at centre, only notes do.</p>
        </div>
      </div>
    </div>
  )
}
