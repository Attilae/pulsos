'use client'
import { createContext, useContext } from 'react'
export const SheetFieldsContext = createContext(false)

export function SpSection({ label }) {
  return <div className="sp-section">{label}</div>
}

export function SpSlider({ label, min, max, step, value, onChange, unit, disabled = false, resetValue }) {
  const sheet = useContext(SheetFieldsContext)
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`sp-row ${disabled ? 'sp-row--auto' : ''}`}>
      <span className="sp-label">{label}</span>
      <div className="sp-track">
        <div className="sp-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          aria-label={typeof label === 'string' ? label : undefined}
          className="sp-slider" onChange={e => onChange(Number(e.target.value))} />
      </div>
      <span className="sp-val">{disabled ? 'auto' : `${Number(value).toFixed(decimals)}${unit ?? ''}`}</span>
      {sheet && <button type="button" className="sp-reset" disabled={disabled} onClick={() => onChange(resetValue ?? min)} aria-label={`Reset ${label}`}>Reset</button>}
    </div>
  )
}

export function SpSelect({ label, value, options, onChange }) {
  return (
    <div className="sp-row sp-row--select">
      <span className="sp-label">{label}</span>
      <select aria-label={label} className="sp-select" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

export function SpCurve({ value, options, onChange }) {
  const sheet = useContext(SheetFieldsContext)
  return (
    <select className="sp-curve" value={value} onChange={e => onChange(e.target.value)}
      aria-label="Curve shape" title="Curve shape">
      {options.map(o => <option key={o} value={o}>{sheet ? o : o.slice(0, 4)}</option>)}
    </select>
  )
}

export function SpSliderWithCurve({ label, min, max, step, value, onChange, curveValue, curveOptions, onCurve, disabled = false, resetValue }) {
  const sheet = useContext(SheetFieldsContext)
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`sp-row sp-row--curvy ${disabled ? 'sp-row--auto' : ''}`}>
      <span className="sp-label">{label}</span>
      <div className="sp-track">
        <div className="sp-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          aria-label={typeof label === 'string' ? label : undefined}
          className="sp-slider" onChange={e => onChange(Number(e.target.value))} />
      </div>
      <span className="sp-val">{disabled ? 'auto' : Number(value).toFixed(decimals)}</span>
      {sheet && <button type="button" className="sp-reset" disabled={disabled} onClick={() => onChange(resetValue ?? min)} aria-label={`Reset ${label}`}>Reset</button>}
      <SpCurve value={curveValue} options={curveOptions} onChange={onCurve} />
    </div>
  )
}

