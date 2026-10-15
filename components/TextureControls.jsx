'use client'

// The Texture panel (NEXT_PUBLIC_GRANULAR_ENGINE=clouds): the lane's granular
// processor, in one of two models (lib/granularEngine.js), each laid out after
// the front panel of the module its DSP comes from. Drawn in Leið's own
// rack-card language, not as a copy of either panel.
//
// Classic (Clouds, Emilie Gillet; dsp/clouds/README.md). Like the module:
//   - FREEZE latches the recording buffer; the BLEND selector is button B, and
//     its four meters stand in for the four blend LEDs;
//   - POSITION · SIZE · PITCH on the first row, DENSITY · TEXTURE · BLEND on the
//     second, IN GAIN as the small knob;
//   - BLEND edits whichever of dry/wet, spread, feedback or reverb is selected.
//
// Mk II (Beads, Emilie Gillet; dsp/beads/README.md). Like the module:
//   - TIME · SIZE · SHAPE · PITCH, each over its randomization attenuverter;
//   - DENSITY as the big knob, FEEDBACK · DRY/WET · REVERB beside it (the
//     module's three mix knobs), IN GAIN small;
//   - the QUALITY button's four LEDs as four lamps, FREEZE as a latch;
//   - what the module's SEED input and button do as a seed-mode choice.
//
// The model switch is offered while NEXT_PUBLIC_TEXTURE_MK2_ENABLED is on, and
// always on a lane already set to Mk II, so it can switch back.
//
// Values are the lane's granular cfg (tx* and tx2* keys). Knobs owned by an
// armed grain.* automation lane lock and follow the live value.

import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import {
  TEXTURE_BLEND_PARAMS, TEXTURE_DEFAULTS, TEXTURE_KNOBS, TEXTURE_MK2_DEFAULTS, TEXTURE_MK2_ENABLED, TEXTURE_MK2_KNOBS,
  TEXTURE_MK2_MIX_KNOBS, TEXTURE_MK2_QUALITIES, TEXTURE_MK2_RAND_KNOBS, TEXTURE_MK2_SEED_MODES, TEXTURE_MODEL_LABELS,
  TEXTURE_MODELS, textureModelOf,
} from '@/lib/granularEngine.js'
import { getCloudsStatus, subscribeCloudsStatus } from '@/lib/cloudsGranularLoader.js'
import { getBeadsStatus, subscribeBeadsStatus } from '@/lib/beadsLoader.js'
import Knob from './PanelKnob.jsx'
import './TextureControls.css'

const KNOB = Object.fromEntries(
  [...TEXTURE_KNOBS, ...TEXTURE_MK2_KNOBS, ...TEXTURE_MK2_RAND_KNOBS, ...TEXTURE_MK2_MIX_KNOBS].map(k => [k.key, k]),
)
const clamp01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
const pct = v => `${Math.round(clamp01(v) * 100)}%`

function useClassicStatus() {
  return useSyncExternalStore(subscribeCloudsStatus, getCloudsStatus, () => 'idle')
}
function useMk2Status() {
  return useSyncExternalStore(subscribeBeadsStatus, getBeadsStatus, () => 'idle')
}

export default function TextureControls({ cfg, onChange, autoTargets, laneName }) {
  const classicStatus = useClassicStatus()
  const mk2Status = useMk2Status()
  const c = { ...TEXTURE_DEFAULTS, ...TEXTURE_MK2_DEFAULTS, ...cfg }
  const on = !!c.enabled
  const model = textureModelOf(c)
  const status = model === 'mk2' ? mk2Status : classicStatus
  const showSwitch = TEXTURE_MK2_ENABLED || model === 'mk2'
  const [blendKey, setBlendKey] = useState('txBlend')
  const bodyCache = useRef({})
  const blend = TEXTURE_BLEND_PARAMS.find(b => b.key === blendKey) ?? TEXTURE_BLEND_PARAMS[0]

  // An armed grain.<key> automation lane owns that control: locked, showing the
  // swept value (targets are 0..1, so the live value needs no denormalizing).
  const auto = useCallback((key) => {
    const a = autoTargets?.[`grain.${key}`]
    return a ? { locked: true, live: typeof a.value === 'number' ? a.value : null } : { locked: false, live: null }
  }, [autoTargets])

  const knob = (key, { format, label, size, group } = {}) => {
    const mk2Key = key.startsWith('tx2')
    const spec = KNOB[key]
    const a = auto(key)
    return (
      <Knob
        group={group ?? (mk2Key ? 'Texture Mk II' : 'Texture')}
        label={label ?? spec.label}
        value={a.live ?? c[key]}
        onChange={v => onChange({ [key]: v })}
        onReset={() => onChange({ [key]: spec.default })}
        format={format ?? spec.format}
        size={size ?? spec.size}
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

      {showSwitch && (
        <div className="tx-models" role="radiogroup" aria-label={laneName ? `Texture model on ${laneName}` : 'Texture model'}>
          {TEXTURE_MODELS.map(m => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === model}
              className={`tx-model${m === model ? ' is-active' : ''}`}
              onClick={() => { if (m !== model) onChange({ txModel: m }) }}
              title={m === 'mk2'
                ? 'Mk II: grains, delay and tape-style quality settings. Classic’s settings are kept.'
                : 'Classic: the original grain cloud. Mk II’s settings are kept.'}
            >{TEXTURE_MODEL_LABELS[m]}</button>
          ))}
        </div>
      )}

      {on && status === 'loading' && <p className="tx-status" role="status">Loading Texture {model === 'mk2' ? 'Mk II' : ''}…</p>}
      {on && status === 'error' && (
        <p className="tx-status tx-status--error" role="alert">
          Texture {model === 'mk2' ? 'Mk II ' : ''}could not load, so the lane plays dry. Press play to try again.
        </p>
      )}

      {/* Both models' bodies share one grid cell and the inactive one is hidden,
          so the card is always as tall as the taller model and switching never
          pushes the cards stacked under it in the rack (DeviceRack.jsx). */}
      <div className="tx-bodies">
      <div className={bodyClass('mk2')} inert={!on || model !== 'mk2'} aria-hidden={model !== 'mk2'}>
        {cachedBody('mk2', mk2Body)}
      </div>
      <div className={bodyClass('classic')} inert={!on || model !== 'classic'} aria-hidden={model !== 'classic'}>
        {cachedBody('classic', classicBody)}
      </div>
      </div>
    </div>
  )

  // The hidden model's controls are reused from its last render, so React skips
  // its knobs entirely while the other model is edited (it stays in the DOM
  // only to hold the card's height). Its handlers are stale but it's inert.
  function cachedBody(m, render) {
    if (m === model || !bodyCache.current[m]) bodyCache.current[m] = render()
    return bodyCache.current[m]
  }

  function classicBody() {
    return (
      <>
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
      </>
    )
  }

  function bodyClass(m) {
    return `tx-body${on ? '' : ' is-off'}${m === model ? '' : ' is-hidden'}`
  }

  function mk2Body() {
    const seedMode = TEXTURE_MK2_SEED_MODES.find(m => m.id === c.tx2SeedMode) ?? TEXTURE_MK2_SEED_MODES[0]
    const quality = TEXTURE_MK2_QUALITIES.find(q => q.id === c.tx2Quality) ?? TEXTURE_MK2_QUALITIES[0]
    const sizeValue = auto('tx2Size').live ?? c.tx2Size
    const delay = sizeValue >= 0.99
    return (
      <>
        <div className="tx-strip">
          <button
            type="button"
            className={`tx-freeze${c.tx2Freeze ? ' is-on' : ''}`}
            aria-pressed={!!c.tx2Freeze}
            onClick={() => onChange({ tx2Freeze: !c.tx2Freeze })}
            title="Stop recording: grains (or delay repeats) keep playing whatever is in the buffer now."
          >
            <span className="tx-lamp" aria-hidden="true" />
            Freeze
          </button>
          <div className="tx-seg" role="radiogroup" aria-label="How lane notes drive the grains">
            {TEXTURE_MK2_SEED_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={m.id === seedMode.id}
                className={`tx-seg-opt${m.id === seedMode.id ? ' is-active' : ''}`}
                onClick={() => onChange({ tx2SeedMode: m.id })}
                title={`${m.label}: ${m.hint}`}
              >{m.label}</button>
            ))}
          </div>
        </div>

        <div className="tx-row tx-row--4">
          {TEXTURE_MK2_KNOBS.map(k => (
            <div key={k.key} className="tx-stack">
              {knob(k.key)}
              {knob(k.rand, { label: 'Random', group: `Texture Mk II ${k.label}` })}
            </div>
          ))}
        </div>

        <div className="tx-row tx-row--4">
          {knob('tx2Density', { format: v => KNOB.tx2Density.format(v, seedMode.id, { delay, quality: quality.id }) })}
          {knob('tx2Feedback')}
          {knob('tx2DryWet')}
          {knob('tx2Reverb')}
        </div>

        <div className="tx-row tx-row--foot">
          {knob('tx2InGain')}
          <div className="tx-quality">
            <span className="tx-caption">Quality</span>
            <div className="tx-lamps" role="radiogroup" aria-label="Texture Mk II quality">
              {TEXTURE_MK2_QUALITIES.map(q => (
                <button
                  key={q.id}
                  type="button"
                  role="radio"
                  aria-checked={q.id === quality.id}
                  className={`tx-lamp-btn${q.id === quality.id ? ' is-active' : ''}`}
                  onClick={() => onChange({ tx2Quality: q.id })}
                  title={`${q.label}: ${q.hint}`}
                >
                  <span className="tx-lamp" aria-hidden="true" />
                  <span className="tx-lamp-name">{q.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="tx-hint">
          {delay
            ? (seedMode.id === 'free'
              ? 'Delay mode: Density sets the delay length and Time offsets it.'
              : 'Delay mode: lane notes set the tempo, Density picks the division.')
            : seedMode.hint}
          {' '}Changing quality clears the recording.
        </p>
      </>
    )
  }
}
