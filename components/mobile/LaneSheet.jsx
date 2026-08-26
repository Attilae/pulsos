// Everything about one lane that doesn't fit on its strip.
//
// Desktop shows this as a multi-column "device rack" of dense cards. Here it's
// four segments in a bottom sheet:
//   Tone   — instrument, harmony and pitch mapping
//   Rhythm — playback timing and arpeggiation
//   Mix   — level, stereo position, FX sends, sidechain ducking
//   Notes — the touch replacement for the stop rail (see below)
//
// The stop rail can't be made tappable at this size: dots are 8px and sit
// 10–20px apart, so 44px hit areas would overlap several neighbours. Notes is
// a plain vertical list of 44px rows instead, which is a better touch editor
// than dot-dragging ever was — the trade is that you lose the shape of the
// line at a glance, which is why the desktop rail stays.
'use client'

import { useMemo, useState } from 'react'
import Sheet from '../Sheet.jsx'
import {
  NOTE_ROOTS, SCALE_TYPES, SYNTH_TYPES, SidechainSourceOptions,
  SPEED_OPTIONS, ARP_STYLE_LABELS, ARP_RATE_LABELS,
  CONTOUR_LABELS, CONTOUR_TITLES,
} from '../DawView.jsx'
import { LaneTagFields } from '../LaneTagEditor.jsx'
import { ARP_RATES, ARP_STYLES, DEFAULT_ARP, DEFAULT_SIDECHAIN } from '@/lib/engine.js'
import { DEFAULT_GRID_RESOLUTION, DEFAULT_PITCH_VARIETY, PITCH_CONTOURS } from '@/lib/mappings.js'
import { FX_BUSES } from '@/lib/fxTrack.js'
import { buildLanePitchMaps, buildLaneNoteRows } from '@/lib/laneNotes.js'

const SEGMENTS = [
  { id: 'sound', label: 'Tone' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'mix',   label: 'Mix' },
  { id: 'notes', label: 'Notes' },
]

export default function LaneSheet({
  route,
  open,
  onClose,
  // state
  volume = 0,
  pan = 0,
  disabled = false,
  soloed = false,
  synthType,
  scale,
  octave = 0,
  semitone = 0,
  pitchVariety,
  speed = 1,
  gridResolution = DEFAULT_GRID_RESOLUTION,
  arp,
  perStopSteps,
  stopVelocities,
  sendMatrix,
  activeFxTracks = [],
  sidechain,
  sidechainSources = [],
  tag,
  // handlers — the same ones the desktop rack calls
  onVolume, onPan, onDisable, onSolo, onSynthType, onScale, onOctaveShift,
  onPitchVariety, onTrackSpeed, onGridResolution, onArp,
  onSendLevel, onSidechain, onStopPitch, onStopVelocity, onLaneTag,
}) {
  const [segment, setSegment] = useState('sound')

  const trackScale = scale ?? { root: 'C', scaleType: 'major' }
  const pv = { ...DEFAULT_PITCH_VARIETY, ...pitchVariety }
  const ag = { ...DEFAULT_ARP, ...arp }

  const noteRows = useMemo(() => {
    if (!route || segment !== 'notes') return []
    const { pitchMap } = buildLanePitchMaps(route, {
      scale: trackScale, pitchVariety, perStopSteps,
      octaveShift: octave, semitoneShift: semitone,
    })
    return buildLaneNoteRows(route, { pitchMap, perStopSteps, stopVelocities })
  }, [route, segment, trackScale.root, trackScale.scaleType, pitchVariety, perStopSteps, stopVelocities, octave, semitone])

  if (!route) return null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={route.name ?? route.id}
      className="lane-sheet"
      // In the sheet's toolbar, not its body: the Notes list runs to 60+ rows
      // on a bus route, and inside the scrolling body these tabs scrolled out
      // of reach — leaving no way back to Sound or Mix.
      toolbar={
        <div className="lsheet-segments" role="tablist">
          {SEGMENTS.map(s => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={segment === s.id}
              className={`lsheet-segment ${segment === s.id ? 'is-active' : ''}`}
              onClick={() => setSegment(s.id)}
            >{s.label}</button>
          ))}
        </div>
      }
    >
      {segment === 'sound' && (
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
                {SYNTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>

            {/* Same controls as the desktop label modal, imported rather than
                re-implemented, so the two can't drift on presets or swatches. */}
            <Field label="Label" hint="Name this lane by what it plays. The colour marks the lane.">
              <LaneTagFields tag={tag} onChange={patch => onLaneTag(route.id, patch)} />
            </Field>
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
                <button type="button" onClick={() => onOctaveShift(route.id, Math.max(-2, octave - 1))} aria-label="Octave down">−</button>
                <span className="mono">{octave > 0 ? `+${octave}` : octave}</span>
                <button type="button" onClick={() => onOctaveShift(route.id, Math.min(2, octave + 1))} aria-label="Octave up">+</button>
              </div>
            </Field>
          </section>

          <p className="lsheet-note">
            Envelope, filter, EQ and granular controls are on desktop.
          </p>
        </div>
      )}

      {segment === 'rhythm' && (
        <div className="lsheet-body">
          <section className="lsheet-group lsheet-group--rhythm">
            <GroupHead title="Timing" description="Set the lane’s cycle and note grid." />
            <Field label="Playback speed">
              <div className="lsheet-choice-grid lsheet-choice-grid--compact">
                {SPEED_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={speed === option.value ? 'is-active' : ''}
                    onClick={() => onTrackSpeed(route.id, option.value)}
                    aria-pressed={speed === option.value}
                    aria-label={option.title}
                  >{option.label}</button>
                ))}
              </div>
            </Field>

            <Field label="Note grid" hint="Snaps stops to this rhythmic subdivision.">
              <div className="lsheet-choice-grid lsheet-choice-grid--compact">
                {ARP_RATES.map(rate => (
                  <button
                    key={rate}
                    type="button"
                    className={gridResolution === rate ? 'is-active' : ''}
                    onClick={() => onGridResolution(route.id, rate)}
                    aria-pressed={gridResolution === rate}
                  >{ARP_RATE_LABELS[rate] ?? rate}</button>
                ))}
              </div>
            </Field>
          </section>

          <section className="lsheet-group lsheet-group--rhythm">
            <GroupHead title="Arpeggiator" description="Break each stop note into a rhythmic pattern." />
            <button
              type="button"
              className={`lsheet-toggle lsheet-toggle--inline ${ag.enabled ? 'is-on' : ''}`}
              onClick={() => onArp(route.id, { enabled: !ag.enabled })}
              aria-pressed={ag.enabled}
            >{ag.enabled ? 'Arpeggiator on' : 'Arpeggiator off'}</button>

            <div className={ag.enabled ? '' : 'lsheet-disabled-group'}>
              <Field label="Style">
                <div className="lsheet-choice-grid">
                  {ARP_STYLES.map(style => (
                    <button
                      key={style}
                      type="button"
                      disabled={!ag.enabled}
                      className={ag.style === style ? 'is-active' : ''}
                      onClick={() => onArp(route.id, { style })}
                      aria-pressed={ag.style === style}
                    >{ARP_STYLE_LABELS[style] ?? style}</button>
                  ))}
                </div>
              </Field>

              <Field label="Rate">
                <div className="lsheet-choice-grid lsheet-choice-grid--compact">
                  {ARP_RATES.map(rate => (
                    <button
                      key={rate}
                      type="button"
                      disabled={!ag.enabled}
                      className={ag.rate === rate ? 'is-active' : ''}
                      onClick={() => onArp(route.id, { rate })}
                      aria-pressed={ag.rate === rate}
                    >{ARP_RATE_LABELS[rate] ?? rate}</button>
                  ))}
                </div>
              </Field>

              <div className="lsheet-pair lsheet-pair--steppers">
                <Field label="Octaves">
                  <div className="lsheet-stepper">
                    <button type="button" disabled={!ag.enabled} onClick={() => onArp(route.id, { octaves: Math.max(1, ag.octaves - 1) })} aria-label="Arpeggiator octaves down">−</button>
                    <span className="mono">{ag.octaves}</span>
                    <button type="button" disabled={!ag.enabled} onClick={() => onArp(route.id, { octaves: Math.min(4, ag.octaves + 1) })} aria-label="Arpeggiator octaves up">+</button>
                  </div>
                </Field>
                <Field label="Steps">
                  <div className="lsheet-stepper">
                    <button type="button" disabled={!ag.enabled} onClick={() => onArp(route.id, { steps: Math.max(1, ag.steps - 1) })} aria-label="Arpeggiator steps down">−</button>
                    <span className="mono">{ag.steps}</span>
                    <button type="button" disabled={!ag.enabled} onClick={() => onArp(route.id, { steps: Math.min(6, ag.steps + 1) })} aria-label="Arpeggiator steps up">+</button>
                  </div>
                </Field>
              </div>

              <Field label={`Gate · ${Math.round(ag.gate * 100)}%`}>
                <input
                  type="range" min={0.05} max={2} step={0.05} value={ag.gate}
                  disabled={!ag.enabled}
                  onChange={e => onArp(route.id, { gate: Number(e.target.value) })}
                  aria-label="Arpeggiator gate"
                />
              </Field>
            </div>
          </section>
        </div>
      )}

      {segment === 'mix' && (
        <div className="lsheet-body">
          <div className="lsheet-toggles">
            <button
              type="button"
              className={`lsheet-toggle ${disabled ? '' : 'is-on'}`}
              onClick={() => onDisable(route.id)}
            >{disabled ? 'Disabled' : 'Enabled'}</button>
            <button
              type="button"
              className={`lsheet-toggle ${soloed ? 'is-solo' : ''}`}
              onClick={() => onSolo(route.id, false)}
            >Solo</button>
            {/* Desktop uses Cmd/Ctrl-click for additive solo, which has no touch
                equivalent — so it gets its own button here. */}
            <button
              type="button"
              className="lsheet-toggle"
              onClick={() => onSolo(route.id, true)}
            >Add to solo</button>
          </div>

          <Field label={`Level · ${volume > 0 ? `+${volume}` : volume} dB`}>
            <input
              type="range" min={-40} max={6} step={1} value={volume}
              onChange={e => onVolume(route.id, Number(e.target.value))}
              aria-label="Level"
            />
          </Field>

          <Field label={`Pan · ${panLabel(pan)}`}>
            <input
              type="range" min={-1} max={1} step={0.05} value={pan}
              onChange={e => onPan(route.id, Number(e.target.value))}
              aria-label="Pan"
            />
            {/* Desktop resets pan with a double-click; that gesture doesn't
                exist on touch, so the reset is a visible control. */}
            <button type="button" className="lsheet-reset" onClick={() => onPan(route.id, 0)}>
              Centre
            </button>
          </Field>

          {activeFxTracks.length > 0 && (
            <Field label="Sends">
              {activeFxTracks.map(bus => {
                const label = FX_BUSES.find(b => b.id === bus)?.label ?? bus
                return (
                  <div className="lsheet-send" key={bus}>
                    <span className="lsheet-send-name">{label}</span>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={sendMatrix?.[`${route.id}:${bus}`] ?? 0}
                      onChange={e => onSendLevel(route.id, bus, Number(e.target.value))}
                      aria-label={`${label} send`}
                    />
                  </div>
                )
              })}
            </Field>
          )}

          {(() => {
            const sc = { ...DEFAULT_SIDECHAIN, ...sidechain }
            const scOn = !!sc.enabled && !!sc.source
            const ms = v => `${Math.round(v * 1000)} ms`
            return (
              <Field
                label="Sidechain"
                hint="Dips this lane every time the trigger fires — pick a drum pad to make it pump."
              >
                <select
                  value={sc.source}
                  onChange={e => {
                    const source = e.target.value
                    onSidechain(route.id, source ? { source } : { source: '', enabled: false })
                  }}
                  aria-label="Sidechain trigger"
                >
                  <SidechainSourceOptions sources={sidechainSources} excludeId={route.id} />
                </select>

                {sc.source && (
                  <>
                    <button
                      type="button"
                      className={`lsheet-toggle lsheet-toggle--inline ${scOn ? 'is-on' : ''}`}
                      onClick={() => onSidechain(route.id, { enabled: !sc.enabled })}
                    >{scOn ? 'Ducking' : 'Off'}</button>

                    <div className="lsheet-send lsheet-send--wide">
                      <span className="lsheet-send-name">Amount · {Math.round(sc.amountDb)} dB</span>
                      <input
                        type="range" min={-40} max={0} step={1} value={sc.amountDb}
                        onChange={e => onSidechain(route.id, { amountDb: Number(e.target.value) })}
                        aria-label="Sidechain amount"
                      />
                    </div>
                    <div className="lsheet-send lsheet-send--wide">
                      <span className="lsheet-send-name">Attack · {ms(sc.attack)}</span>
                      <input
                        type="range" min={0} max={0.2} step={0.001} value={sc.attack}
                        onChange={e => onSidechain(route.id, { attack: Number(e.target.value) })}
                        aria-label="Sidechain attack"
                      />
                    </div>
                    <div className="lsheet-send lsheet-send--wide">
                      <span className="lsheet-send-name">Release · {ms(sc.release)}</span>
                      <input
                        type="range" min={0.02} max={1.5} step={0.01} value={sc.release}
                        onChange={e => onSidechain(route.id, { release: Number(e.target.value) })}
                        aria-label="Sidechain release"
                      />
                    </div>
                  </>
                )}
              </Field>
            )
          })()}
        </div>
      )}

      {segment === 'notes' && (
        <div className="lsheet-body">
          <p className="lsheet-note">
            One row per stop, in travel order. ± moves the note within the
            lane&rsquo;s scale; the slider sets how hard it&rsquo;s struck.
          </p>
          <ul className="lsheet-notes">
            {noteRows.map(row => (
              <li className="lsheet-noterow" key={row.id}>
                <div className="lsheet-noterow-head">
                  <span className="lsheet-stop">{row.name}</span>
                  <span className="lsheet-note-name mono">{row.note}</span>
                </div>
                <div className="lsheet-noterow-controls">
                  <div className="lsheet-stepper lsheet-stepper--sm">
                    <button
                      type="button"
                      onClick={() => onStopPitch(route.id, row.id, row.steps - 1)}
                      aria-label={`${row.name}: down one step`}
                    >−</button>
                    <span className="mono">{row.steps > 0 ? `+${row.steps}` : row.steps}</span>
                    <button
                      type="button"
                      onClick={() => onStopPitch(route.id, row.id, row.steps + 1)}
                      aria-label={`${row.name}: up one step`}
                    >+</button>
                  </div>
                  <input
                    type="range" min={0.2} max={1} step={0.05}
                    value={row.velocity}
                    onChange={e => onStopVelocity(route.id, row.id, Number(e.target.value))}
                    aria-label={`${row.name}: velocity`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="lsheet-field">
      <span className="lsheet-label">{label}</span>
      {/* Desktop carries these as title= tooltips, which never appear on touch. */}
      {hint && <span className="lsheet-hint">{hint}</span>}
      {children}
    </div>
  )
}

function GroupHead({ title, description }) {
  return (
    <div className="lsheet-group-head">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}

function panLabel(pan) {
  if (Math.abs(pan) < 0.02) return 'centre'
  const side = pan < 0 ? 'L' : 'R'
  return `${side}${Math.round(Math.abs(pan) * 100)}`
}
