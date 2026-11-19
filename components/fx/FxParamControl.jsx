'use client'

export default function FxParamControl({ spec, value, onChange, disabled = false, disabledText = 'synced', hiddenValues = null, variant = 'rack', resetValue, group }) {
  const label = [group, spec.label].filter(Boolean).join(' ')
  const reset = variant === 'sheet' && <button type="button" className="fx-param-reset lsheet-action" disabled={disabled} aria-label={`Reset ${label}`} onClick={() => onChange(resetValue ?? (spec.kind === 'enum' ? spec.values[0] : spec.min))}>Reset</button>
  if (spec.kind === 'enum') {
    const current = value ?? spec.values[0]
    const values = hiddenValues ? spec.values.filter(v => v === current || !hiddenValues.includes(v)) : spec.values
    return (
      <div className="fx-param-row">
        <span className="fx-param-label">{spec.label}</span>
        <select
          aria-label={label}
          disabled={disabled}
          className="fx-param-select"
          value={current}
          onChange={e => onChange(e.target.value)}
        >
          {values.map(v => (
            <option key={v} value={v} disabled={hiddenValues?.includes(v)}>{spec.valueLabels?.[v] ?? v}</option>
          ))}
        </select>
        {reset}
      </div>
    )
  }

  const v = value ?? spec.min
  const scale = spec.displayScale ?? 1
  const displayVal = v * scale
  const decimals = spec.decimals ?? (spec.step < 0.01 ? 3 : spec.step < 1 ? 2 : 0)
  return (
    <div className={`fx-param-row ${disabled ? 'fx-param-row--disabled' : ''}`}>
      <span className="fx-param-label">{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={v}
        aria-label={label}
        disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="fx-param-slider"
      />
      <span className="fx-param-val">
        {disabled && disabledText != null ? disabledText : `${displayVal.toFixed(decimals)}${spec.unit ? ` ${spec.unit}` : ''}`}
      </span>
      {reset}
    </div>
  )
}
