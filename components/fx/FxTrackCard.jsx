'use client'
import { useId, useState } from 'react'
import { FX_PARAM_SPECS, FX_SYNC_TARGETS } from '@/lib/fxSpecs.js'
import { useEntitlements } from '@/lib/shared/EntitlementsContext.jsx'
import FxParamControl from './FxParamControl.jsx'
import CustomIRPicker from './CustomIRPicker.jsx'
import { IconCaretDown, IconClose } from '../icons.jsx'

// The "Custom…" IR needs an uploaded file, which is Pro-only, so Free doesn't list it.
const CUSTOM_IR_VALUES = ['custom']

export default function FxTrackCard({ bus, wet, muted, soloed, params, onWet, onMute, onSolo, onParam, onCustomIR, onRemove, variant = 'rack' }) {
  const sheet = variant === 'sheet'
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const specs = FX_PARAM_SPECS[bus.id] ?? []
  // When tempo-synced, the raw ms/Hz slider for the synced param is inert.
  const syncTarget = FX_SYNC_TARGETS[bus.id]
  const synced = (params?.sync ?? bus.defaults?.sync ?? 'free') !== 'free'
  const { limits } = useEntitlements()
  const customUploads = limits?.customUploads === true
  const returnSlider = <input type="range" min={0} max={1} step={0.01} value={wet}
    onChange={e => onWet(Number(e.target.value))} aria-label={`${bus.label} return level`}
    aria-valuetext={`${Math.round(wet * 100)}%`} className="fx-track-wet-slider" />
  const returnValue = <span className="fx-track-wet-val">{Math.round(wet * 100)}%</span>
  const remove = <button type="button" className="fx-track-remove-btn" onClick={onRemove} title="Remove FX track" aria-label={`Remove ${bus.label}`}><IconClose /></button>
  return (
    <div role="group" aria-label={`${bus.label} bus`} className={`fx-track-card fx-track-card--${variant} ${muted ? 'fx-track-card--muted' : ''}`}>
      <div className="fx-track-card-header">
        {sheet ? <button type="button" className="fx-track-expand" aria-expanded={expanded} aria-controls={bodyId}
          onClick={() => setExpanded(v => !v)}>{bus.label}<IconCaretDown /></button>
          : <span className="fx-track-name">{bus.label}</span>}
        <button className={`mute-btn ${muted ? 'active' : ''}`} onClick={onMute} aria-pressed={muted} aria-label={`Mute ${bus.label}`} title="Mute">M</button>
        <button className={`solo-btn ${soloed ? 'active' : ''}`} onClick={onSolo} aria-pressed={soloed} aria-label={`Solo ${bus.label}`} title="Solo">S</button>
        {sheet ? <>
          {remove}
          <div className="fx-sheet-return"><span className="fx-param-label">Return</span>{returnSlider}{returnValue}
            <button type="button" className="lsheet-action" aria-label={`Reset ${bus.label} return level`} onClick={() => onWet(bus.defaults?.wet ?? 1)}>Reset</button>
          </div>
        </> : <>{returnSlider}{returnValue}{remove}</>}

      </div>
      {specs.length > 0 && (!sheet || expanded) && (
        <div id={bodyId} className="fx-track-params">
          {specs.map(spec => (
            <FxParamControl
              key={spec.id}
              variant={variant}
              group={sheet ? bus.label : undefined}
              resetValue={bus.defaults?.[spec.id]}
              spec={spec}
              value={params?.[spec.id] ?? bus.defaults?.[spec.id]}
              onChange={v => onParam(spec.id, v)}
              disabled={synced && spec.id === syncTarget}
              hiddenValues={spec.id === 'irType' && !customUploads ? CUSTOM_IR_VALUES : null}
            />
          ))}
          {bus.id === 'reverb' && onCustomIR && (
            <CustomIRPicker onCustomIR={onCustomIR} />
          )}
        </div>
      )}
    </div>
  )
}
