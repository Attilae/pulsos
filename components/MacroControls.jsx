'use client'

// The Macro instrument's panel, laid out after the front panel of the module its
// DSP comes from (Plaits, Emilie Gillet; see dsp/macro/README.md), and shared by
// the desktop rack (EnvPanel in DawView.jsx, variant "rack") and the phone lane
// sheet (LaneSheet.jsx, variant "sheet"). Like the module, top to bottom:
//   - MODEL: a bank selector and eight lamps, one per engine of the bank (the
//     module's two buttons and eight LEDs);
//   - FREQUENCY and HARMONICS as the large knobs, TIMBRE and MORPH below them;
//   - the three attenuverters, TIMBRE, FM and MORPH, which set how far each
//     note's decay envelope moves those controls (the module with TRIG patched
//     and the CV inputs empty);
//   - the low-pass gate's Decay and Colour, which the module keeps behind a
//     button hold, as plain small knobs, next to the OUT/AUX blend.
// Drawn in Leið's own rack language, not as a copy of the module's panel.
// HARMONICS, TIMBRE and MORPH show what they do on the selected engine.
//
// Values are the lane's flat params (trackADSRs, macro* keys, lib/macroSpecs.js).
// Knobs owned by an armed synth.* automation lane lock and follow the live value.

import { useCallback, useSyncExternalStore } from 'react'
import {
  MACRO_BANKS, MACRO_ENGINES, MACRO_PARAM, MACRO_SELF_ENVELOPED, MACRO_VOICE_OPTIONS,
  macroEngine, macroTransposeSemitones, normalizeMacroParams,
} from '@/lib/macroSpecs.js'
import { getMacroStatus, subscribeMacroStatus } from '@/lib/macroLoader.js'
import Knob from './PanelKnob.jsx'
import './MacroControls.css'

const STATUS_TEXT = {
  loading: 'Loading Macro…',
  error: 'Macro could not load. Press play to try again.',
}

const pct = v => `${Math.round(v * 100)}%`
const signedPct = v => {
  const n = Math.round(v * 100)
  return n > 0 ? `+${n}%` : `${n}%`
}

// Each control's knob position (0..1) ↔ stored value, and its readout.
const KNOBS = {
  macroFrequency: {
    size: 'lg', bipolar: true, steps: 14,
    format: v => { const st = macroTransposeSemitones(v); return st > 0 ? `+${st} st` : `${st} st` },
  },
  macroHarmonics: { size: 'lg', format: pct },
  macroTimbre: { size: 'md', format: pct },
  macroMorph: { size: 'md', format: pct },
  macroTimbreAmt: { size: 'xs', bipolar: true, format: signedPct },
  macroFmAmt: { size: 'xs', bipolar: true, format: signedPct },
  macroMorphAmt: { size: 'xs', bipolar: true, format: signedPct },
  macroDecay: { size: 'xs', format: pct },
  macroColour: { size: 'xs', format: pct },
  macroAux: { size: 'xs', format: v => (v <= 0 ? 'Out' : v >= 1 ? 'Aux' : `${pct(v)} aux`) },
}

// Stored value ↔ knob position: attenuverters store -1..1, everything else 0..1.
const toKnob = (spec, v) => (v - spec.min) / (spec.max - spec.min)
const fromKnob = (spec, x) => spec.min + x * (spec.max - spec.min)

function useMacroStatus() {
  return useSyncExternalStore(subscribeMacroStatus, getMacroStatus, () => 'idle')
}

export default function MacroControls({ params, onChange, granularEnabled = false, variant = 'rack', autoTargets, laneName }) {
  const status = useMacroStatus()
  const p = normalizeMacroParams(params)
  const engine = macroEngine(p.macroEngine)
  const bankEngines = MACRO_ENGINES.filter(e => e.bank === engine.bank)
  const selfEnveloped = MACRO_SELF_ENVELOPED.includes(engine.id)
  const sheet = variant === 'sheet'

  // An armed synth.<key> lane owns the knob. Its live value arrives normalized
  // 0..1 across the target's range, which is already the knob position.
  const auto = useCallback((key) => {
    const a = autoTargets?.[`synth.${key}`]
    return a ? { locked: true, live: typeof a.value === 'number' ? a.value : null } : { locked: false, live: null }
  }, [autoTargets])

  const knob = (key, { sublabel, dim } = {}) => {
    const spec = MACRO_PARAM[key]
    const k = KNOBS[key]
    const a = auto(key)
    return (
      <Knob
        group="Macro"
        label={spec.label}
        sublabel={sublabel}
        value={a.live ?? toKnob(spec, p[key])}
        onChange={x => onChange({ [key]: fromKnob(spec, x) })}
        onReset={() => onChange({ [key]: spec.default })}
        format={x => k.format(fromKnob(spec, x))}
        size={sheet && k.size === 'xs' ? 'sm' : k.size}
        bipolar={!!k.bipolar}
        steps={k.steps ?? 0}
        locked={a.locked}
        dim={dim}
        laneName={laneName}
        hint={spec.hint}
      />
    )
  }

  // The module's bank buttons keep the row: bank 2, row 3 → bank 3, row 3.
  const pickBank = (bank) => {
    if (bank === engine.bank) return
    const row = engine.index % 8
    onChange({ macroEngine: MACRO_ENGINES[(bank - 1) * 8 + row].id })
  }

  return (
    <div className={`mc-panel mc-panel--${variant}`}>
      {STATUS_TEXT[status] && (
        <p className={`mc-status mc-status--${status}`} role={status === 'error' ? 'alert' : 'status'}>
          {STATUS_TEXT[status]}
        </p>
      )}

      <div className="mc-model">
        <div className="mc-model-head">
          <span className="mc-caption">Model</span>
          <div className="mc-banks" role="radiogroup" aria-label="Macro model bank">
            {MACRO_BANKS.map(b => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={b === engine.bank}
                className={`mc-bank${b === engine.bank ? ' is-active' : ''}`}
                onClick={() => pickBank(b)}
                title={b === 1 ? 'Bank 1: filters, phase distortion, 6-op FM, terrain, strings, chiptune'
                  : b === 2 ? 'Bank 2: classic synthesis'
                  : 'Bank 3: noise, physical models and drums'}
              >{b}</button>
            ))}
          </div>
        </div>
        <div className="mc-lamps" role="radiogroup" aria-label={`Macro model, bank ${engine.bank}`}>
          {bankEngines.map(e => {
            const on = e.id === engine.id
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`mc-lamp-btn${on ? ' is-active' : ''}`}
                onClick={() => onChange({ macroEngine: e.id })}
                title={e.hint}
              >
                <span className="mc-lamp" aria-hidden="true" />
                <span className="mc-lamp-name">{e.label}</span>
              </button>
            )
          })}
        </div>
        <p className="mc-hint">{engine.hint}</p>
      </div>

      <div className="mc-row mc-row--2">
        {knob('macroFrequency')}
        {knob('macroHarmonics', { sublabel: engine.harmonics })}
      </div>
      <div className="mc-row mc-row--2">
        {knob('macroTimbre', { sublabel: engine.timbre })}
        {knob('macroMorph', { sublabel: engine.morph })}
      </div>

      <div className="mc-section">
        <span className="mc-caption">Envelope amount</span>
        <div className="mc-row mc-row--3">
          {knob('macroTimbreAmt')}
          {knob('macroFmAmt')}
          {knob('macroMorphAmt')}
        </div>
      </div>

      <div className="mc-section">
        <span className="mc-caption">Gate and output</span>
        <div className="mc-row mc-row--3">
          {knob('macroDecay')}
          {knob('macroColour', { dim: selfEnveloped })}
          {knob('macroAux', { sublabel: engine.aux })}
        </div>
        {selfEnveloped && (
          <p className="mc-hint">{engine.label} shapes its own notes: Colour does nothing, and Decay only times the envelope amounts.</p>
        )}
      </div>

      <div className="mc-section mc-voices">
        <span className="mc-caption">Voices</span>
        <div className="mc-choices" role="radiogroup" aria-label="Macro voices">
          {MACRO_VOICE_OPTIONS.map(n => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={n === p.macroVoices}
              className={`mc-choice${n === p.macroVoices ? ' is-active' : ''}`}
              onClick={() => onChange({ macroVoices: n })}
            >{n}</button>
          ))}
        </div>
      </div>

      <p className="mc-note">
        Each note holds the trigger for its note length. Legato and glide don’t apply; more voices use more processing.
        {granularEnabled && ' The granular layer is paused on this instrument; its settings are kept.'}
      </p>
    </div>
  )
}
