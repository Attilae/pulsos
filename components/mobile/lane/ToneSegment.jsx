'use client'

import { NOTE_ROOTS, SCALE_TYPES, pickerSynthTypes, CONTOUR_LABELS, CONTOUR_TITLES } from '../../DawView.jsx'
import { LaneTagFields } from '../../LaneTagEditor.jsx'
import ResonatorControls from '../../ResonatorControls.jsx'
import MacroControls from '../../MacroControls.jsx'
import EnvelopeFields from '../../lane/EnvelopeFields.jsx'
import GranularFields from '../../lane/GranularFields.jsx'
import TextureControls from '../../TextureControls.jsx'
import { TEXTURE_ENABLED } from '@/lib/granularEngine.js'
import { autoCtl } from '@/lib/automationControl.js'
import { supportsGranular, findTargetSpec } from '@/lib/engine.js'
import { PITCH_CONTOURS, PITCH_SPANS, PITCH_LEAPS } from '@/lib/mappings.js'
import { synthTypeLabel, polyTargetActive } from '@/lib/soundSpecs.js'
import { Field, GroupHead } from './fields.jsx'

// One segment of the phone lane sheet (see ../LaneSheet.jsx). It receives the
// sheet's props plus the values LaneSheet derives from them, as `ctx`.
export default function ToneSegment({ ctx }) {
  const {
    glide, legato, automationLanes, onSamplerPreset, onSamplerUpload, onDrumVoice, onGranular, onGlide, onLegato,
    route, synthType, adsr, granular, scale, octave, filter, tag, onSynthType, onADSR, onScale, onOctaveShift, onPitchVariety, onLaneTag, trackScale, pv, resonatorStatus,
  } = ctx

  const autoTargets = {}
  for (const cfg of Object.values(automationLanes ?? {})) {
    if (!cfg?.sourceRouteId || !polyTargetActive(cfg.paramTarget, synthType, adsr)) continue
    autoTargets[cfg.paramTarget] = { spec: findTargetSpec(cfg.paramTarget, synthType), value: null }
  }
  const glideAuto = autoCtl(autoTargets, 'glide', { divide: 1000 })

  return (
    <div className="lsheet-body">
      <section className="lsheet-group lsheet-group--sound">
        <GroupHead title="Voice" description="Choose the lane’s instrument and role." />
        {/* Both handlers match the desktop rack. The engine needs line type
            to wire the right per-line-type bus. */}
        <Field label="Instrument">
          <select
            value={synthType ?? 'Synth'}
            onChange={e => onSynthType(route.id, route.type, e.target.value)}
          >
            {pickerSynthTypes(synthType ?? 'Synth').map(t => <option key={t} value={t}>{synthTypeLabel(t)}</option>)}
          </select>
        </Field>

        {/* Same controls as the desktop label modal, imported rather than
            re-implemented, so the two can't drift on presets or swatches. */}
        <Field label="Label" hint="Name this lane by what it plays. The colour marks the lane.">
          <LaneTagFields tag={tag} onChange={patch => onLaneTag(route.id, patch)} />
        </Field>
      </section>

      {synthType === 'Resonator' && (
        <section className="lsheet-group lsheet-group--sound">
          <GroupHead title="Resonator" description="Shape what the strike excites, how long it rings, and optionally hold and bow each note." />
          <ResonatorControls
            params={adsr}
            onChange={patch => onADSR?.(route.id, patch)}
            status={resonatorStatus}
            granularEnabled={!!granular?.enabled}
            autoTargets={autoTargets}
            variant="sheet"
          />
        </section>
      )}

      {synthType === 'Macro' && (
        <section className="lsheet-group lsheet-group--sound">
          <GroupHead title="Macro" description="Pick a model, then shape it with Harmonics, Timbre and Morph, as on the module's panel." />
          <MacroControls
            params={adsr}
            onChange={patch => onADSR?.(route.id, patch)}
            granularEnabled={!!granular?.enabled && !supportsGranular('Macro')}
            autoTargets={autoTargets}
            variant="sheet"
            laneName={route.name}
          />
        </section>
      )}

      {!['Resonator', 'Macro'].includes(synthType) && (
        <section className="lsheet-group lsheet-group--sound">
          <GroupHead title="Sound" description="Shape the instrument and its envelope." />
          <EnvelopeFields variant="sheet" synthType={synthType ?? 'Synth'} adsr={adsr}
            onADSR={patch => onADSR(route.id, patch)} autoTargets={autoTargets}
            onSamplerPreset={id => onSamplerPreset(route.id, route.type, id)}
            onSamplerUpload={(file, note) => onSamplerUpload(route.id, file, note)}
            onDrumVoice={id => onDrumVoice(route.id, route.type, id)} />
        </section>
      )}

      <section className="lsheet-group lsheet-group--sound">
        <GroupHead title={TEXTURE_ENABLED ? 'Texture' : 'Granular'} description="Layer grains from this lane’s instrument." />
        {TEXTURE_ENABLED
          ? <TextureControls cfg={granular} onChange={patch => onGranular(route.id, patch)} autoTargets={autoTargets} laneName={route.name} variant="sheet" />
          : supportsGranular(synthType)
            ? <GranularFields route={route} granular={granular} onGranular={patch => onGranular(route.id, patch)} autoTargets={autoTargets} variant="sheet" />
            : <p className="lsheet-note">Not available on the {synthType} yet.{granular?.enabled ? ' Its grain settings are kept for when you switch back.' : ''}</p>}
      </section>

      <section className="lsheet-group lsheet-group--sound">
        <GroupHead title="Pitch map" description="Turn route data into melody." />
        <Field label="Key" hint="Sets the scale this line's stops are mapped onto.">
          <div className="lsheet-pair">
            <select
              value={trackScale.root}
              onChange={e => onScale(route.id, route.name, { ...trackScale, root: e.target.value })}
              aria-label="Root note"
            >
              {NOTE_ROOTS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={trackScale.scaleType}
              onChange={e => onScale(route.id, route.name, { ...trackScale, scaleType: e.target.value })}
              aria-label="Scale"
            >
              {SCALE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </Field>

        <Field label="Contour" hint="Choose what shapes the notes along the route.">
          <div className="lsheet-choice-grid">
            {PITCH_CONTOURS.map(contour => (
              <button
                key={contour}
                type="button"
                className={pv.contour === contour ? 'is-active' : ''}
                onClick={() => onPitchVariety(route.id, { contour })}
                aria-pressed={pv.contour === contour}
                aria-label={CONTOUR_TITLES[contour]}
              >{CONTOUR_LABELS[contour] ?? contour}</button>
            ))}
          </div>
        </Field>

        <Field label="Pitch range" hint="Limit generated notes before your stop edits and octave shift. Auto keeps the original contour range.">
          <div className="lsheet-choice-grid">
            {[null, ...PITCH_SPANS].map(span => (
              <button key={span ?? 'auto'} type="button"
                className={(span == null ? pv.span == null : pv.span === span) ? 'is-active' : ''}
                aria-pressed={span == null ? pv.span == null : pv.span === span}
                onClick={() => onPitchVariety(route.id, { span: span ?? undefined })}
              >{span == null ? 'Auto' : `${span} octave${span === 1 ? '' : 's'}`}</button>
            ))}
          </div>
        </Field>

        <Field label="Maximum leap" hint="Scale steps between generated notes, including the loop return. Trimming a loop can reshape its notes. Your stop edits take priority.">
          <div className="lsheet-choice-grid">
            {PITCH_LEAPS.map(maxLeap => (
              <button key={maxLeap} type="button"
                className={(pv.maxLeap ?? 0) === maxLeap ? 'is-active' : ''}
                aria-pressed={(pv.maxLeap ?? 0) === maxLeap}
                onClick={() => onPitchVariety(route.id, { maxLeap })}
              >{maxLeap ? `${maxLeap} step${maxLeap === 1 ? '' : 's'}` : 'Off'}</button>
            ))}
          </div>
        </Field>

        <Field
          label={`Variation · ${Math.round(pv.variety * 100)}%`}
          hint="Adds repeatable melodic variation without changing the selected contour."
        >
          <input
            type="range" min={0} max={1} step={0.01} value={pv.variety}
            onChange={e => onPitchVariety(route.id, { variety: Number(e.target.value) })}
            aria-label="Pitch variation"
          />
        </Field>

        <Field label="Octave">
          <div className="lsheet-stepper">
            <button type="button" onClick={() => onOctaveShift(route.id, Math.max(-4, octave - 1))} aria-label="Octave down">−</button>
            <span className="mono">{octave > 0 ? `+${octave}` : octave}</span>
            <button type="button" onClick={() => onOctaveShift(route.id, Math.min(4, octave + 1))} aria-label="Octave up">+</button>
          </div>
        </Field>
      </section>

      {!['Resonator', 'Macro'].includes(synthType) && (
        <section className="lsheet-group lsheet-group--sound">
          <GroupHead title="Expression" description="Slide between notes or hold connected phrases." />
          <Field label={`Glide · ${glideAuto.disabled ? 'automated' : `${glide.toFixed(2)} s`}`}>
            <input type="range" min={0} max={1} step={0.01} value={glide} disabled={glideAuto.disabled}
              aria-label="Glide" onChange={e => onGlide(route.id, Number(e.target.value))} />
            <button type="button" disabled={glideAuto.disabled} onClick={() => onGlide(route.id, 0)}>Reset glide</button>
          </Field>
          <Field label="Legato">
            <button type="button" aria-pressed={legato} className={legato ? 'is-active' : ''}
              onClick={() => onLegato(route.id, !legato)}>{legato ? 'On' : 'Off'}</button>
          </Field>
        </section>
      )}
    </div>
  )
}
