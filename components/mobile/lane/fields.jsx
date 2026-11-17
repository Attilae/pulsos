// Shared building blocks for the phone lane sheet's segments.
'use client'

export function Field({ label, hint, children }) {
  return (
    <div className="lsheet-field">
      <span className="lsheet-label">{label}</span>
      {/* Desktop carries these as title= tooltips, which never appear on touch. */}
      {hint && <span className="lsheet-hint">{hint}</span>}
      {children}
    </div>
  )
}

export function GroupHead({ title, description }) {
  return (
    <div className="lsheet-group-head">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}

export function panLabel(pan) {
  if (Math.abs(pan) < 0.02) return 'centre'
  const side = pan < 0 ? 'L' : 'R'
  return `${side}${Math.round(Math.abs(pan) * 100)}`
}
