'use client'

// The Resonator instrument's editor, shared by the desktop rack (EnvPanel in
// DawView.jsx, variant "rack") and the phone lane sheet (LaneSheet.jsx, variant
// "sheet"), so both expose the same model, timbre, envelope and voice controls
// and the same honest loading/error state. Values are the lane's flat params
// (trackADSRs); the vocabulary lives in lib/resonatorSpecs.js.

import {
  RESONATOR_MODELS, RESONATOR_PARAMS, RESONATOR_VOICE_OPTIONS, RESONATOR_ENVELOPE_PARAMS, RESONATOR_BOW,
  normalizeResonatorParams,
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

const NO_AUTOMATION = { locked: false, live: null }

// Times (spec.unit 's') use a cubic taper so the short end, where attacks and
// decays mostly live, gets most of the slider's travel; the rest are 0..1.
const isTime = (spec) => spec.unit === 's'
const toSlider = (spec, v) => (isTime(spec) ? Math.cbrt((v - spec.min) / (spec.max - spec.min)) : v)
const fromSlider = (spec, x) => {
  if (!isTime(spec)) return x
  const v = spec.min + x ** 3 * (spec.max - spec.min)
  return v < 1 ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100
}
const formatValue = (spec, v) => {
  if (!isTime(spec)) return `${Math.round(v * 100)}%`
  return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`
}

function ParamSlider({ spec, value: stored, onChange, variant, auto = NO_AUTOMATION }) {
  const reset = useResetGesture(() => { if (!auto.locked) onChange({ [spec.key]: spec.default }) })
  const value = auto.live ?? stored
  const shown = formatValue(spec, value)
  const id = `res-${spec.key}`
  const tolerance = isTime(spec) ? spec.default * 0.01 + 1e-4 : 0.005
  return (
    <div className="res-param">
      <div className="res-param-head">
        <label className="res-param-label" htmlFor={id}>{spec.label}</label>
        <span className="res-param-val">{shown}</span>
        <button
          type="button"
          className="res-param-reset"
          onClick={() => onChange({ [spec.key]: spec.default })}
          disabled={auto.locked || Math.abs(value - spec.default) < tolerance}
          aria-label={`Reset ${spec.label}`}
        >Reset</button>
      </div>
      <input
        id={id}
        type="range" min={0} max={1} step={isTime(spec) ? 0.001 : 0.01} value={toSlider(spec, value)}
        className="res-param-slider"
        disabled={auto.locked}
        aria-valuetext={shown}
        aria-describedby={variant === 'sheet' ? `${id}-hint` : undefined}
        title={auto.locked ? 'Controlled by an automation lane' : variant === 'rack' ? `${spec.hint} Double-click to reset.` : undefined}
        onChange={e => onChange({ [spec.key]: fromSlider(spec, Number(e.target.value)) })}
        {...reset}
      />
      {variant === 'sheet' && <p className="res-param-hint" id={`${id}-hint`}>{spec.hint}</p>}
    </div>
  )
}

// A two-way On/Off choice in the same radio style as Model and Voices.
function Toggle({ label, value, onChange, hint, offLabel = 'Off', onLabel = 'On' }) {
  return (
    <div className="res-group" role="radiogroup" aria-label={label}>
      <span className="res-group-label">{label}</span>
      <div className="res-choices">
        {[[false, offLabel], [true, onLabel]].map(([v, text]) => (
          <button
            key={text}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={`res-choice ${value === v ? 'is-active' : ''}`}
            onClick={() => onChange(v)}
          >{text}</button>
        ))}
      </div>
      {hint && <p className="res-group-hint">{hint}</p>}
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

      <Toggle
        label="Envelope"
        value={p.resonatorEnvelope}
        onChange={v => onChange({ resonatorEnvelope: v })}
        hint={p.resonatorEnvelope
          ? 'Each note is held for its note length, then fades over the release.'
          : 'Off: every note is struck and rings out on its own.'}
      />

      {p.resonatorEnvelope && (
        <>
          {RESONATOR_ENVELOPE_PARAMS.map(spec => (
            <ParamSlider key={spec.key} spec={spec} value={p[spec.key]} onChange={onChange} variant={variant} />
          ))}
          <ParamSlider spec={RESONATOR_BOW} value={p.resonatorBow} onChange={onChange} variant={variant} />
          <Toggle
            label="Strike"
            value={p.resonatorStrike}
            onChange={v => onChange({ resonatorStrike: v })}
            hint={!p.resonatorStrike && p.resonatorBow === 0
              ? 'With no strike and no bow, nothing excites the resonator, so it is silent.'
              : 'The struck attack at the start of each note. Turn it off for a pure bowed sound.'}
          />
        </>
      )}

      <p className="res-note">
        {p.resonatorEnvelope
          ? 'Damping still shapes the ring inside each note. Legato and glide don’t apply.'
          : 'Notes ring out on their own; Damping sets how long. Note length, legato and glide don’t apply.'}
        {granularEnabled && ' The granular layer is paused on this instrument; its settings are kept.'}
      </p>
    </div>
  )
}
