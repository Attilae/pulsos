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

import { useCallback, useState, useSyncExternalStore } from 'react'
import { TEXTURE_BLEND_PARAMS, TEXTURE_DEFAULTS, TEXTURE_KNOBS } from '@/lib/granularEngine.js'
import { getCloudsStatus, subscribeCloudsStatus } from '@/lib/cloudsGranularLoader.js'
import Knob from './PanelKnob.jsx'
import './TextureControls.css'

const KNOB = Object.fromEntries(TEXTURE_KNOBS.map(k => [k.key, k]))
const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
const pct = v => `${Math.round(clamp01(v) * 100)}%`

function useTextureStatus() {
  return useSyncExternalStore(subscribeCloudsStatus, getCloudsStatus, () => 'idle')
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
        group="Texture"
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
            group="Texture"
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
