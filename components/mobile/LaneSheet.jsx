// Everything about one lane that doesn't fit on its strip.
//
// Desktop shows this as a multi-column "device rack" of dense cards. Here it's
// three segments in a bottom sheet:
//   Sound — instrument and harmony
//   Mix   — level, stereo position, FX sends
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
import { NOTE_ROOTS, SCALE_TYPES, SYNTH_TYPES } from '../DawView.jsx'
import { FX_BUSES } from '@/lib/fxTrack.js'
import { buildLanePitchMaps, buildLaneNoteRows } from '@/lib/laneNotes.js'

const SEGMENTS = [
  { id: 'sound', label: 'Sound' },
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
  perStopSteps,
  stopVelocities,
  sendMatrix,
  activeFxTracks = [],
  // handlers — the same ones the desktop rack calls
  onVolume, onPan, onDisable, onSolo, onSynthType, onScale, onOctaveShift,
  onSendLevel, onStopPitch, onStopVelocity,
}) {
  const [segment, setSegment] = useState('sound')

  const trackScale = scale ?? { root: 'C', scaleType: 'major' }

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
          {/* Both of these take three arguments, matching the desktop rack's
              `onSynthType(route.id, route.type, st)` / `onScale(route.id,
              route.name, s)`. The engine needs the line type to wire the right
              per-line-type bus, and the short name to update the sound mode. */}
          <Field label="Instrument">
            <select
              value={synthType ?? 'Synth'}
              onChange={e => onSynthType(route.id, route.type, e.target.value)}
            >
              {SYNTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

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

          <Field label="Octave">
            <div className="lsheet-stepper">
              <button type="button" onClick={() => onOctaveShift(route.id, -1)} aria-label="Octave down">−</button>
              <span className="mono">{octave > 0 ? `+${octave}` : octave}</span>
              <button type="button" onClick={() => onOctaveShift(route.id, +1)} aria-label="Octave up">+</button>
            </div>
          </Field>

          <p className="lsheet-note">
            Envelope, filter, EQ, arpeggiator and granular controls are on desktop.
          </p>
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
                      value={sendMatrix?.[route.id]?.[bus] ?? 0}
                      onChange={e => onSendLevel(route.id, bus, Number(e.target.value))}
                      aria-label={`${label} send`}
                    />
                  </div>
                )
              })}
            </Field>
          )}
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

function panLabel(pan) {
  if (Math.abs(pan) < 0.02) return 'centre'
  const side = pan < 0 ? 'L' : 'R'
  return `${side}${Math.round(Math.abs(pan) * 100)}`
}
