'use client'

// The Resonator instrument's editor, shared by the desktop rack (EnvPanel in
// DawView.jsx, variant "rack") and the phone lane sheet (LaneSheet.jsx, variant
// "sheet"), so both expose the same model, timbre and voice controls and the
// same honest loading/error state. Values are the lane's flat params
// (trackADSRs); the vocabulary lives in lib/resonatorSpecs.js.

import {
  RESONATOR_MODELS, RESONATOR_PARAMS, RESONATOR_VOICE_OPTIONS, normalizeResonatorParams,
} from '@/lib/resonatorSpecs.js'
import { useResetGesture } from '@/lib/shared/useResetGesture.js'
import './ResonatorControls.css'

const STATUS_TEXT = {
  loading: 'Loading the Resonator…',
  error: 'The Resonator could not load. Press play to try again.',
}

// An armed automation lane on `synth.<key>` owns the slider: it greys out and,
// while values flow, follows the live automated value (targets are 0..1, so the
// value needs no denormalizing). Same contract as autoCtl in DawView.jsx.
function automationFor(autoTargets, key) {
  const a = autoTargets?.[`synth.${key}`]
  return a ? { locked: true, live: typeof a.value === 'number' ? a.value : null } : { locked: false, live: null }
}

function ParamSlider({ spec, value: stored, onChange, variant, auto }) {
  const reset = useResetGesture(() => { if (!auto.locked) onChange({ [spec.key]: spec.default }) })
  const value = auto.live ?? stored
  const pct = Math.round(value * 100)
  const id = `res-${spec.key}`
  return (
    <div className="res-param">
      <div className="res-param-head">
        <label className="res-param-label" htmlFor={id}>{spec.label}</label>
        <span className="res-param-val">{pct}%</span>
        <button
          type="button"
          className="res-param-reset"
          onClick={() => onChange({ [spec.key]: spec.default })}
          disabled={auto.locked || Math.abs(value - spec.default) < 0.005}
          aria-label={`Reset ${spec.label}`}
        >Reset</button>
      </div>
      <input
        id={id}
        type="range" min={0} max={1} step={0.01} value={value}
        className="res-param-slider"
        disabled={auto.locked}
        aria-valuetext={`${pct}%`}
        aria-describedby={variant === 'sheet' ? `${id}-hint` : undefined}
        title={auto.locked ? 'Controlled by an automation lane' : variant === 'rack' ? `${spec.hint} Double-click to reset.` : undefined}
        onChange={e => onChange({ [spec.key]: Number(e.target.value) })}
        {...reset}
      />
      {variant === 'sheet' && <p className="res-param-hint" id={`${id}-hint`}>{spec.hint}</p>}
    </div>
  )
}

export default function ResonatorControls({ params, onChange, status = 'ready', granularEnabled = false, variant = 'rack', autoTargets }) {
  const p = normalizeResonatorParams(params)
  const model = RESONATOR_MODELS.find(m => m.id === p.resonatorModel) ?? RESONATOR_MODELS[0]

  return (
    <div className={`res-controls res-controls--${variant}`}>
      {STATUS_TEXT[status] && (
        <p className={`res-status res-status--${status}`} role={status === 'error' ? 'alert' : 'status'}>
          {STATUS_TEXT[status]}
        </p>
      )}

      <div className="res-group" role="radiogroup" aria-label="Resonator model">
        <span className="res-group-label">Model</span>
        <div className="res-choices">
          {RESONATOR_MODELS.map(m => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={m.id === model.id}
              className={`res-choice ${m.id === model.id ? 'is-active' : ''}`}
              onClick={() => onChange({ resonatorModel: m.id })}
              title={m.hint}
            >{m.label}</button>
          ))}
        </div>
        <p className="res-group-hint">{model.hint}</p>
      </div>

      {RESONATOR_PARAMS.map(spec => (
        <ParamSlider key={spec.key} spec={spec} value={p[spec.key]} onChange={onChange} variant={variant} auto={automationFor(autoTargets, spec.key)} />
      ))}

      <div className="res-group" role="radiogroup" aria-label="Resonator voices">
        <span className="res-group-label">Voices</span>
        <div className="res-choices">
          {RESONATOR_VOICE_OPTIONS.map(n => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === p.resonatorVoices}
              className={`res-choice ${n === p.resonatorVoices ? 'is-active' : ''}`}
              onClick={() => onChange({ resonatorVoices: n })}
            >{n}</button>
          ))}
        </div>
        <p className="res-group-hint">How many notes can ring at once. More voices use more processing.</p>
      </div>

      <p className="res-note">
        Notes ring out on their own; Damping sets how long. Note length, legato and glide don’t apply.
        {granularEnabled && ' The granular layer is paused on this instrument; its settings are kept.'}
      </p>
    </div>
  )
}
