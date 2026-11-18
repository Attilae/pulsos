'use client'
import { useRef, useState } from 'react'
import { SYNTH_DEFAULTS, SAMPLER_PRESET_LIST, SAMPLER_PRESETS, DRUM_VOICES, DRUM_VOICE_LICENSE } from '@/lib/engine.js'
import { POLY_VOICES, polyVoiceOf, OSC_TYPES } from '@/lib/soundSpecs.js'
import { autoCtl } from '@/lib/automationControl.js'
import { useCustomUploadGate } from '@/lib/shared/useCustomUploadGate.js'
import { useResonatorStatus } from '@/lib/shared/useResonatorStatus.js'
import ResonatorControls from '../ResonatorControls.jsx'
import MacroControls from '../MacroControls.jsx'
import { SpSection, SpSlider, SpSelect, SpSliderWithCurve, SheetFieldsContext } from './SynthFields.jsx'
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch']
const FILTER_ROLLOFFS = [-12, -24, -48, -96]
const NOISE_TYPES = ['white', 'pink', 'brown']

export default function EnvelopeFields(props) {
  return <SheetFieldsContext.Provider value={props.variant === 'sheet'}>
    <div className={`envelope-fields envelope-fields--${props.variant ?? 'rack'}`}><EnvPanel {...props} /></div>
  </SheetFieldsContext.Provider>
}

function SamplerUploadRow({ onSamplerUpload }) {
  const inputRef = useRef(null)
  const [note, setNote] = useState('C4')
  const [name, setName] = useState(null)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const { allowed, choose } = useCustomUploadGate(inputRef)
  const baseNotes = ['C2', 'C3', 'C4', 'C5', 'A3', 'A4']

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''   // so picking the same file again still fires onChange
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      await onSamplerUpload?.(file, note)
      setName(file.name)
    } catch (err) {
      console.error('Sampler upload failed:', err)
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="sp-row sp-row--select">
      <span className="sp-label">File</span>
      <select aria-label="Sample base note" className="sp-select" value={note} onChange={e => setNote(e.target.value)}
        title="Base note for the uploaded sample">
        {baseNotes.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <button type="button" className="sp-select" onClick={choose} disabled={uploading} aria-busy={uploading}
        title={allowed ? undefined : 'Custom samples are a Pro feature'}>
        {uploading ? 'Loading…' : allowed ? (error ?? name ?? 'Choose…') : 'Pro'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </div>
  )
}

const ALL_ENV_CURVES  = ['linear', 'exponential', 'bounce', 'cosine', 'ripple', 'sine', 'step']
const DECAY_ENV_CURVES = ['linear', 'exponential']

function AdsrVisualizer({ attack = 0.1, decay = 0.1, sustain = 0.5, release = 1.0 }) {
  const W = 200, H = 44, P = 3
  const peakY = P, floorY = H - P
  const sustY = peakY + (1 - Math.max(0, Math.min(1, sustain))) * (floorY - peakY)
  const inner = W - P * 2
  const ax = P + inner * 0.27
  const dx = ax + inner * 0.21
  const sx = dx + inner * 0.21
  const ex = sx + inner * 0.31

  const fill = `M${P},${floorY} L${ax},${peakY} L${dx},${sustY} L${sx},${sustY} L${ex},${floorY} Z`
  const line = `M${P},${floorY} L${ax},${peakY} L${dx},${sustY} L${sx},${sustY} L${ex},${floorY}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sp-viz" preserveAspectRatio="none">
      <path d={fill} className="sp-viz-fill" />
      <path d={line} className="sp-viz-line" />
    </svg>
  )
}

const AMP_ENV_KEYS = new Set(['attack', 'decay', 'sustain', 'release'])

function EnvPanel(props) {
  // A PolySynth stacks copies of one voice, so it edits that voice's controls,
  // headed by the voice picker. Defaults follow the voice, as the engine's do.
  if (props.synthType === 'PolySynth') {
    const voice = polyVoiceOf(props.adsr)
    const header = (
      <>
        <SpSection label="POLY" />
        <div className="sp-row sp-row--select">
          <span className="sp-label">Voice</span>
          <select aria-label="PolySynth voice" className="sp-select" value={voice} onChange={e => props.onADSR({ voice: e.target.value })}>
            {POLY_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
      </>
    )
    return <EnvPanelBody {...props} synthType={voice} header={header} />
  }
  return <EnvPanelBody {...props} />
}

function EnvPanelBody({ synthType, adsr, onADSR, onSamplerPreset, onDrumVoice, onSamplerUpload, autoTargets = {}, granularEnabled = false, laneName, header = null }) {
  const resonatorStatus = useResonatorStatus()
  const def = SYNTH_DEFAULTS[synthType] ?? SYNTH_DEFAULTS['Synth']
  const p = { ...def, ...adsr }

  // An EnvPanel slider's onADSR({ key }) maps to automation id `synth.<key>`; the amp-env
  // A/D/S/R are also driven by `adsr.<key>`. Returns { disabled, value } to spread onto the
  // slider — value falls back to the stored param when no live automation value is flowing.
  const a = (key, stored) => {
    const ids = AMP_ENV_KEYS.has(key) ? [`synth.${key}`, `adsr.${key}`] : [`synth.${key}`]
    const r = autoCtl(autoTargets, ids)
    return { disabled: r.disabled, value: r.display ?? stored }
  }

  if (synthType === 'Drums') {
    const voiceId = p.drumVoice ?? 'kick'
    return (
    <div className="sp-panel">
      <SpSection label="DRUMS" />
      <div className="sp-row sp-row--select">
        <span className="sp-label">Voice</span>
        <select aria-label="Drum voice" className="sp-select" value={voiceId}
          onChange={e => onDrumVoice?.(e.target.value)}>
          {DRUM_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>
      <div className="sp-row sp-row--credits" title={DRUM_VOICE_LICENSE.attribution}>
        <span className="sp-label">©</span>
        <span className="sp-credits-text">
          {DRUM_VOICE_LICENSE.license} · {DRUM_VOICE_LICENSE.attribution}
          {' · '}
          <a className="sp-credits-link" href={DRUM_VOICE_LICENSE.source} target="_blank" rel="noopener noreferrer">source ↗</a>
        </span>
      </div>
      <SpSection label="ENV" />
      <SpSlider label="A" min={0} max={0.5} step={0.001} {...a('attack', p.attack ?? 0.001)} resetValue={def.attack} onChange={v => onADSR({ attack: v })} />
      <SpSlider label="R" min={0.02} max={3} step={0.01} {...a('release', p.release ?? 0.6)} resetValue={def.release} onChange={v => onADSR({ release: v })} />
    </div>
    )
  }

  if (synthType === 'Resonator') return (
    <div className="sp-panel">
      <ResonatorControls params={p} onChange={onADSR} status={resonatorStatus} granularEnabled={granularEnabled} variant="rack" autoTargets={autoTargets} />
    </div>
  )

  if (synthType === 'Macro') return (
    <div className="sp-panel">
      <MacroControls params={p} onChange={onADSR} granularEnabled={granularEnabled} variant="rack" autoTargets={autoTargets} laneName={laneName} />
    </div>
  )

  if (synthType === 'Sampler') {
    const presetId = p.samplerPreset ?? 'piano'
    const preset   = SAMPLER_PRESETS[presetId]
    return (
    <div className="sp-panel">
      <SpSection label="SAMPLER" />
      <div className="sp-row sp-row--select">
        <span className="sp-label">Inst</span>
        <select aria-label="Sampler preset" className="sp-select" value={presetId}
          onChange={e => onSamplerPreset?.(e.target.value)}>
          {SAMPLER_PRESET_LIST.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {preset?.license && (
        <div className="sp-row sp-row--credits" title={preset.attribution}>
          <span className="sp-label">©</span>
          <span className="sp-credits-text">
            {preset.license} · {preset.attribution}
            {preset.source && (
              <> · <a className="sp-credits-link" href={preset.source} target="_blank" rel="noopener noreferrer">source ↗</a></>
            )}
          </span>
        </div>
      )}
      <SpSection label="ENV" />
      <SpSlider label="A" min={0} max={2} step={0.001} {...a('attack', p.attack ?? 0.01)} resetValue={def.attack} onChange={v => onADSR({ attack: v })} />
      <SpSlider label="R" min={0.01} max={6} step={0.01} {...a('release', p.release ?? 1.0)} resetValue={def.release} onChange={v => onADSR({ release: v })} />
      <SpSection label="UPLOAD" />
      <SamplerUploadRow onSamplerUpload={onSamplerUpload} />
    </div>
    )
  }

  const envBlock = (hasViz = true) => (
    <>
      {hasViz && <AdsrVisualizer attack={p.attack} decay={p.decay} sustain={p.sustain} release={p.release} />}
      <SpSliderWithCurve
        label="A" min={0.001} max={2} step={0.001} {...a('attack', p.attack ?? 0.005)} resetValue={def.attack} onChange={v => onADSR({ attack: v })}
        curveValue={p.attackCurve ?? 'exponential'} curveOptions={ALL_ENV_CURVES} onCurve={v => onADSR({ attackCurve: v })}
      />
      <SpSliderWithCurve
        label="D" min={0.001} max={2} step={0.001} {...a('decay', p.decay ?? 0.1)} resetValue={def.decay} onChange={v => onADSR({ decay: v })}
        curveValue={p.decayCurve ?? 'exponential'} curveOptions={DECAY_ENV_CURVES} onCurve={v => onADSR({ decayCurve: v })}
      />
      <SpSlider label="S" min={0} max={1} step={0.01} {...a('sustain', p.sustain ?? 0.5)} resetValue={def.sustain} onChange={v => onADSR({ sustain: v })} />
      <SpSliderWithCurve
        label="R" min={0.01} max={4} step={0.01} {...a('release', p.release ?? 1.0)} resetValue={def.release} onChange={v => onADSR({ release: v })}
        curveValue={p.releaseCurve ?? 'exponential'} curveOptions={ALL_ENV_CURVES} onCurve={v => onADSR({ releaseCurve: v })}
      />
    </>
  )

  if (synthType === 'PluckSynth') return (
    <div className="sp-panel">
      <SpSlider label="Noise" min={0.1} max={20} step={0.1}  {...a('attackNoise', p.attackNoise ?? 1)}  resetValue={def.attackNoise} onChange={v => onADSR({ attackNoise: v })} />
      <SpSlider label="Damp"  min={200} max={8000} step={10} {...a('dampening', p.dampening ?? 4000)}   resetValue={def.dampening} onChange={v => onADSR({ dampening: v })} unit="Hz" />
      <SpSlider label="Res"   min={0} max={0.98} step={0.01} {...a('resonance', p.resonance ?? 0.7)}    resetValue={def.resonance} onChange={v => onADSR({ resonance: v })} />
    </div>
  )

  if (synthType === 'NoiseSynth') return (
    <div className="sp-panel">
      <SpSection label="NOISE" />
      <SpSelect label="Type" value={p.noiseType ?? 'white'} options={NOISE_TYPES} onChange={v => onADSR({ noiseType: v })} />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'MembraneSynth') return (
    <div className="sp-panel">
      <SpSection label="DRUM" />
      <SpSlider label="Decay"  min={0.001} max={0.5} step={0.001} {...a('pitchDecay', p.pitchDecay ?? 0.05)}  resetValue={def.pitchDecay} onChange={v => onADSR({ pitchDecay: v })} />
      <SpSlider label="Octav"  min={1}     max={20}  step={0.5}   {...a('membOctaves', p.membOctaves ?? 10)}  resetValue={def.membOctaves} onChange={v => onADSR({ membOctaves: v })} />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'MetalSynth') return (
    <div className="sp-panel">
      <SpSection label="METAL" />
      <SpSlider label="Harm"   min={0.1}  max={20}    step={0.1}  {...a('metalHarmonicity', p.metalHarmonicity ?? 5.1)} resetValue={def.metalHarmonicity} onChange={v => onADSR({ metalHarmonicity: v })} />
      <SpSlider label="ModIdx" min={1}    max={100}   step={1}    {...a('metalModIndex', p.metalModIndex ?? 32)}        resetValue={def.metalModIndex} onChange={v => onADSR({ metalModIndex: v })} />
      <SpSlider label="Octav"  min={0.1}  max={5}     step={0.1}  {...a('metalOctaves', p.metalOctaves ?? 1.5)}         resetValue={def.metalOctaves} onChange={v => onADSR({ metalOctaves: v })} />
      <SpSlider label="Res"    min={100}  max={10000} step={10}   {...a('resonance', p.resonance ?? 4000)}              resetValue={def.resonance} onChange={v => onADSR({ resonance: v })} unit="Hz" />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'MonoSynth') return (
    <div className="sp-panel">
      <SpSection label="OSC" />
      <SpSelect label="Type"  value={p.oscillatorType ?? 'sawtooth'} options={OSC_TYPES}   onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase" min={0} max={360} step={1}              value={p.phase ?? 0}  resetValue={def.phase} onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"   min={-200} max={200} step={1}           {...a('detune', p.detune ?? 0)} resetValue={def.detune} onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="ENV" />
      {envBlock()}
      <SpSection label="FILTER" />
      <SpSelect label="Type"   value={p.filterType ?? 'lowpass'}        options={FILTER_TYPES}               onChange={v => onADSR({ filterType: v })} />
      <SpSelect label="Roll"   value={String(p.filterRolloff ?? -12)}   options={FILTER_ROLLOFFS.map(String)} onChange={v => onADSR({ filterRolloff: Number(v) })} />
      <SpSlider label="Q"      min={0.1} max={20}   step={0.1}          {...a('filterQ', p.filterQ ?? 1)}                   resetValue={def.filterQ} onChange={v => onADSR({ filterQ: v })} />
      <SpSection label="FILTER ENV" />
      <SpSlider label="A"      min={0.001} max={2}  step={0.001}        {...a('filterEnvAttack', p.filterEnvAttack ?? 0.001)}  resetValue={def.filterEnvAttack} onChange={v => onADSR({ filterEnvAttack: v })} />
      <SpSlider label="D"      min={0.001} max={2}  step={0.001}        {...a('filterEnvDecay', p.filterEnvDecay ?? 0.3)}      resetValue={def.filterEnvDecay} onChange={v => onADSR({ filterEnvDecay: v })} />
      <SpSlider label="S"      min={0} max={1}      step={0.01}         {...a('filterEnvSustain', p.filterEnvSustain ?? 0.3)}  resetValue={def.filterEnvSustain} onChange={v => onADSR({ filterEnvSustain: v })} />
      <SpSlider label="R"      min={0.01} max={4}   step={0.01}         {...a('filterEnvRelease', p.filterEnvRelease ?? 0.8)}  resetValue={def.filterEnvRelease} onChange={v => onADSR({ filterEnvRelease: v })} />
      <SpSlider label="Base"   min={20}  max={5000} step={10}           {...a('filterEnvBaseFreq', p.filterEnvBaseFreq ?? 200)} resetValue={def.filterEnvBaseFreq} onChange={v => onADSR({ filterEnvBaseFreq: v })} unit="Hz" />
      <SpSlider label="Oct"    min={0}   max={8}    step={0.5}          {...a('filterEnvOctaves', p.filterEnvOctaves ?? 3)}    resetValue={def.filterEnvOctaves} onChange={v => onADSR({ filterEnvOctaves: v })} />
      <SpSlider label="Exp"    min={0.1} max={8}    step={0.1}          value={p.filterEnvExponent ?? 2}     resetValue={def.filterEnvExponent} onChange={v => onADSR({ filterEnvExponent: v })} />
    </div>
  )

  if (synthType === 'FMSynth') return (
    <div className="sp-panel">
      {header}
      <SpSection label="CARRIER OSC" />
      <SpSelect label="Type"   value={p.oscillatorType ?? 'sine'}     options={OSC_TYPES} onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase"  min={0} max={360} step={1}              value={p.phase ?? 0}              resetValue={def.phase} onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"    min={-200} max={200} step={1}           {...a('detune', p.detune ?? 0)}             resetValue={def.detune} onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="MODULATOR" />
      <SpSelect label="Type"   value={p.modulationOscType ?? 'sine'}  options={OSC_TYPES} onChange={v => onADSR({ modulationOscType: v })} />
      <SpSlider label="Harm"   min={0.1} max={20}  step={0.1}          {...a('harmonicity', p.harmonicity ?? 3)}        resetValue={def.harmonicity} onChange={v => onADSR({ harmonicity: v })} />
      <SpSlider label="Idx"    min={0}   max={100} step={0.5}          {...a('modulationIndex', p.modulationIndex ?? 0)} resetValue={def.modulationIndex} onChange={v => onADSR({ modulationIndex: v })} />
      <SpSection label="MOD ENV" />
      <SpSlider label="A"      min={0.001} max={2} step={0.001}        {...a('modAttack', p.modAttack ?? 0.5)}        resetValue={def.modAttack} onChange={v => onADSR({ modAttack: v })} />
      <SpSlider label="D"      min={0.001} max={2} step={0.001}        {...a('modDecay', p.modDecay ?? 0.1)}          resetValue={def.modDecay} onChange={v => onADSR({ modDecay: v })} />
      <SpSlider label="S"      min={0} max={1}     step={0.01}         {...a('modSustain', p.modSustain ?? 1.0)}      resetValue={def.modSustain} onChange={v => onADSR({ modSustain: v })} />
      <SpSlider label="R"      min={0.01} max={4}  step={0.01}         {...a('modRelease', p.modRelease ?? 1.4)}      resetValue={def.modRelease} onChange={v => onADSR({ modRelease: v })} />
      <SpSection label="AMP ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'AMSynth') return (
    <div className="sp-panel">
      {header}
      <SpSection label="CARRIER OSC" />
      <SpSelect label="Type"   value={p.oscillatorType ?? 'sine'}      options={OSC_TYPES} onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase"  min={0} max={360} step={1}               value={p.phase ?? 0}             resetValue={def.phase} onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"    min={-200} max={200} step={1}            {...a('detune', p.detune ?? 0)}            resetValue={def.detune} onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="MODULATOR" />
      <SpSelect label="Type"   value={p.modulationOscType ?? 'square'}  options={OSC_TYPES} onChange={v => onADSR({ modulationOscType: v })} />
      <SpSlider label="Harm"   min={0.1} max={20}  step={0.1}           {...a('harmonicity', p.harmonicity ?? 3)}     resetValue={def.harmonicity} onChange={v => onADSR({ harmonicity: v })} />
      <SpSection label="MOD ENV" />
      <SpSlider label="A"      min={0.001} max={2} step={0.001}         {...a('modAttack', p.modAttack ?? 0.5)}       resetValue={def.modAttack} onChange={v => onADSR({ modAttack: v })} />
      <SpSlider label="D"      min={0.001} max={2} step={0.001}         {...a('modDecay', p.modDecay ?? 0.0)}         resetValue={def.modDecay} onChange={v => onADSR({ modDecay: v })} />
      <SpSlider label="S"      min={0} max={1}     step={0.01}          {...a('modSustain', p.modSustain ?? 1.0)}     resetValue={def.modSustain} onChange={v => onADSR({ modSustain: v })} />
      <SpSlider label="R"      min={0.01} max={4}  step={0.01}          {...a('modRelease', p.modRelease ?? 0.5)}     resetValue={def.modRelease} onChange={v => onADSR({ modRelease: v })} />
      <SpSection label="AMP ENV" />
      {envBlock()}
    </div>
  )

  if (synthType === 'DuoSynth') return (
    <div className="sp-panel">
      <SpSection label="OSC" />
      <SpSelect label="Osc 1"   value={p.voice0OscType ?? 'sawtooth'} options={OSC_TYPES} onChange={v => onADSR({ voice0OscType: v })} />
      <SpSelect label="Osc 2"   value={p.voice1OscType ?? p.voice0OscType ?? 'sawtooth'} options={OSC_TYPES} onChange={v => onADSR({ voice1OscType: v })} />
      <SpSlider label="Dtn"     min={-200} max={200} step={1}          {...a('detune', p.detune ?? 0)}              resetValue={def.detune} onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSlider label="Harm"    min={0.1} max={6}    step={0.1}        {...a('duoHarmonicity', p.duoHarmonicity ?? 1.5)}  resetValue={def.duoHarmonicity} onChange={v => onADSR({ duoHarmonicity: v })} />
      <SpSection label="VIBRATO" />
      <SpSlider label="Rate"    min={0.1} max={20}   step={0.1}        {...a('vibratoRate', p.vibratoRate ?? 5)}          resetValue={def.vibratoRate} onChange={v => onADSR({ vibratoRate: v })} unit="Hz" />
      <SpSlider label="Amt"     min={0}   max={1}    step={0.01}       {...a('vibratoAmount', p.vibratoAmount ?? 0.5)}    resetValue={def.vibratoAmount} onChange={v => onADSR({ vibratoAmount: v })} />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )

  // Default: basic Synth
  return (
    <div className="sp-panel">
      {header}
      <SpSection label="OSC" />
      <SpSelect label="Type"  value={p.oscillatorType ?? 'sine'} options={OSC_TYPES} onChange={v => onADSR({ oscillatorType: v })} />
      <SpSlider label="Phase" min={0} max={360} step={1}          value={p.phase ?? 0}  resetValue={def.phase} onChange={v => onADSR({ phase: v })} unit="°" />
      <SpSlider label="Dtn"   min={-200} max={200} step={1}       {...a('detune', p.detune ?? 0)} resetValue={def.detune} onChange={v => onADSR({ detune: v })} unit="¢" />
      <SpSection label="ENV" />
      {envBlock()}
    </div>
  )
}

