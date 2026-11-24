'use client'

import { SPEED_OPTIONS, ARP_STYLE_LABELS, ARP_RATE_LABELS } from '../../DawView.jsx'
import { ARP_RATES, ARP_STYLES } from '@/lib/engine.js'
import { NOTE_LENGTHS, NOTE_LENGTH_LABELS, DEFAULT_NOTE_LENGTH } from '@/lib/noteLength.js'
import { DEFAULT_STOP_NOTE_LENGTH, STOP_NOTE_LENGTH_SYNTHS, STOP_NOTE_LENGTH_HINT, STOP_NOTE_LENGTH_HELP, STOP_NOTE_LENGTH_MERGED_HELP } from '@/lib/stopNoteLength.js'
import { DEFAULT_STOP_VELOCITY, STOP_VELOCITY_SOURCES, STOP_VELOCITY_LABELS, STOP_VELOCITY_HINTS, STOP_VELOCITY_HELP } from '@/lib/stopVelocity.js'
import { LOOP_PATTERN_PRESETS, MAX_PATTERN_PLAY, MAX_PATTERN_REST } from '@/lib/laneGating.js'
import LoopRegionFields from './LoopRegionFields.jsx'
import { Field, GroupHead } from './fields.jsx'
import { deviceToggleState } from '@/lib/automationControl.js'

// One segment of the phone lane sheet (see ../LaneSheet.jsx). It receives the
// sheet's props plus the values LaneSheet derives from them, as `ctx`.
export default function RhythmSegment({ ctx }) {
  const {
    autoTargets, loopRegion, onTrackLoopRegion, route, disabled, synthType, adsr, speed, gridResolution, noteLength, legato, onTrackSpeed, onGridResolution, onArp, onNoteChance, onLoopPattern, onNoteLength, onStopNoteLength, onStopVelocityMap, ag, laneChance, pattern, snl, snlStatus, setSnlBound, svm, svmStatus, setSvm,
  } = ctx
  // An arp on/off lane may switch it on, so its settings stay editable.
  const arpEditable = deviceToggleState(autoTargets, 'device.arp', ag.enabled).editable

  return (
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

        <Field
          label="Note length"
          hint={synthType === 'Resonator' && !adsr?.resonatorEnvelope
            ? 'The Resonator rings out on its own; Damping sets how long. Turn on its envelope to make note length hold and release each note.'
            : synthType === 'Resonator'
            ? 'How long each note is held before the Resonator envelope releases it.'
            : synthType === 'Macro' && adsr?.macroEnvelope
            ? 'How long each note is held before the Macro envelope releases it.'
            : synthType === 'Macro'
            ? "How long each note holds the Macro trigger. Without its envelope only the 6-op FM engines sustain for it; the others ring for the gate's Decay or their own decay."
            : 'How long each note is held before it releases. No effect with legato, the arpeggiator or PluckSynth.'}
        >
          <div className="lsheet-choice-grid lsheet-choice-grid--compact">
            {NOTE_LENGTHS.map(len => {
              const on = (noteLength ?? DEFAULT_NOTE_LENGTH) === len
              return (
                <button
                  key={len}
                  type="button"
                  className={on ? 'is-active' : ''}
                  onClick={() => onNoteLength?.(route.id, len)}
                  aria-pressed={on}
                >{NOTE_LENGTH_LABELS[len]}</button>
              )
            })}
          </div>
        </Field>

        {(snl || STOP_NOTE_LENGTH_SYNTHS.has(synthType)) && (
          <Field
            label="Hold from"
            hint={!snl
              ? `Fixed uses the note length above. Demand: ${STOP_NOTE_LENGTH_HINT.toLowerCase()} ${STOP_NOTE_LENGTH_HELP}`
              : snlStatus.active
              ? `${snl.invert ? 'Quieter stops sustain longer.' : STOP_NOTE_LENGTH_HINT}${route.isMerged ? ` ${STOP_NOTE_LENGTH_MERGED_HELP}` : ''} Stops without demand use the note length above. ${STOP_NOTE_LENGTH_HELP}`
              : `${snlStatus.reason}. The mapping is kept for later.`}
          >
            <div className="lsheet-choice-grid lsheet-choice-grid--compact">
              {[['fixed', 'Fixed'], ['demand', 'Demand']].map(([src, label]) => {
                const on = (snl ? 'demand' : 'fixed') === src
                return (
                  <button
                    key={src}
                    type="button"
                    className={on ? 'is-active' : ''}
                    aria-pressed={on}
                    onClick={() => onStopNoteLength?.(route.id, src === 'demand' ? (snl ?? { ...DEFAULT_STOP_NOTE_LENGTH }) : null)}
                  >{label}</button>
                )
              })}
            </div>
          </Field>
        )}
        {snl && (
          <>
            <Field label="Shortest">
              <select value={snl.min} onChange={e => setSnlBound('min', e.target.value)} aria-label="Shortest hold">
                {NOTE_LENGTHS.map(len => <option key={len} value={len}>{NOTE_LENGTH_LABELS[len]}</option>)}
              </select>
            </Field>
            <Field label="Longest">
              <select value={snl.max} onChange={e => setSnlBound('max', e.target.value)} aria-label="Longest hold">
                {NOTE_LENGTHS.map(len => <option key={len} value={len}>{NOTE_LENGTH_LABELS[len]}</option>)}
              </select>
            </Field>
            <Field label="Invert">
              <div className="lsheet-choice-grid lsheet-choice-grid--compact">
                {[[false, 'Busy = long'], [true, 'Quiet = long']].map(([inv, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={snl.invert === inv ? 'is-active' : ''}
                    aria-pressed={snl.invert === inv}
                    onClick={() => onStopNoteLength?.(route.id, { ...snl, invert: inv })}
                  >{label}</button>
                ))}
              </div>
            </Field>
          </>
        )}
      </section>

      <LoopRegionFields route={route} region={loopRegion} resolution={gridResolution}
        onChange={region => onTrackLoopRegion(route.id, region)} />

      <section className="lsheet-group lsheet-group--rhythm">
        <GroupHead title="Dynamics" description="Set each stop's velocity from the line's data." />
        <Field
          label="Velocity from"
          hint={!svm
            ? `Off plays every stop at full level (plus pitch variety's gap accents). Demand: ${STOP_VELOCITY_HINTS.demand.toLowerCase()} Hubs: ${STOP_VELOCITY_HINTS.hubs.toLowerCase()}`
            : svmStatus.active
            ? `${svm.invert ? 'Inverted: quiet stops play louder.' : STOP_VELOCITY_HINTS[svm.source]} ${STOP_VELOCITY_HELP}`
            : `${svmStatus.reason}. The mapping is kept for later.`}
        >
          <div className="lsheet-choice-grid lsheet-choice-grid--compact">
            {['off', ...STOP_VELOCITY_SOURCES].map(src => {
              const on = (svm?.source ?? 'off') === src
              return (
                <button
                  key={src}
                  type="button"
                  className={on ? 'is-active' : ''}
                  aria-pressed={on}
                  onClick={() => onStopVelocityMap?.(route.id, src === 'off' ? null : { ...(svm ?? DEFAULT_STOP_VELOCITY), source: src })}
                >{src === 'off' ? 'Off' : STOP_VELOCITY_LABELS[src]}</button>
              )
            })}
          </div>
        </Field>
        {svm && (
          <>
            <Field label={`Softest · ${Math.round(svm.min * 100)}%`}>
              <input
                type="range" min={0.2} max={1} step={0.05} value={svm.min}
                onChange={e => setSvm({ min: Math.min(Number(e.target.value), svm.max) })}
                aria-label="Softest velocity"
              />
            </Field>
            <Field label={`Loudest · ${Math.round(svm.max * 100)}%`}>
              <input
                type="range" min={0.2} max={1} step={0.05} value={svm.max}
                onChange={e => setSvm({ max: Math.max(Number(e.target.value), svm.min) })}
                aria-label="Loudest velocity"
              />
            </Field>
            <Field label="Invert">
              <div className="lsheet-choice-grid lsheet-choice-grid--compact">
                {[[false, 'Busy = loud'], [true, 'Quiet = loud']].map(([inv, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={svm.invert === inv ? 'is-active' : ''}
                    aria-pressed={svm.invert === inv}
                    onClick={() => setSvm({ invert: inv })}
                  >{label}</button>
                ))}
              </div>
            </Field>
          </>
        )}
      </section>

      <section className="lsheet-group lsheet-group--rhythm">
        <GroupHead title="Variation" description="Let the lane skip notes and sit out loops." />
        <Field
          label={`Note chance · ${Math.round(laneChance * 100)}%`}
          hint="Each note rolls fresh dice every loop. Lower means fewer notes play."
        >
          <input
            type="range" min={0} max={1} step={0.05} value={laneChance}
            onChange={e => onNoteChance(route.id, Number(e.target.value))}
            aria-label="Note chance"
          />
        </Field>

        <Field label="Loop pattern" hint="Play some loops, rest others. 1:3 plays every 4th loop.">
          <div className="lsheet-choice-grid lsheet-choice-grid--compact">
            {LOOP_PATTERN_PRESETS.map(pr => {
              const on = pattern.play === pr.play && pattern.rest === pr.rest
              return (
                <button
                  key={pr.id}
                  type="button"
                  className={on ? 'is-active' : ''}
                  onClick={() => onLoopPattern(route.id, { play: pr.play, rest: pr.rest, offset: pr.rest ? pattern.offset : 0 })}
                  aria-pressed={on}
                  aria-label={pr.title}
                >{pr.label}</button>
              )
            })}
          </div>
        </Field>

        {[
          { key: 'play',   label: 'Play loops', min: 1, max: MAX_PATTERN_PLAY },
          { key: 'rest',   label: 'Rest loops', min: 0, max: MAX_PATTERN_REST },
          { key: 'offset', label: 'Shift',      min: 0, max: pattern.play + pattern.rest - 1 },
        ].map(f => (
          <Field key={f.key} label={f.label}>
            <div className="lsheet-stepper">
              <button type="button" disabled={pattern[f.key] <= f.min}
                onClick={() => onLoopPattern(route.id, { ...pattern, [f.key]: pattern[f.key] - 1 })}
                aria-label={`${f.label} down`}>−</button>
              <span className="mono">{pattern[f.key]}</span>
              <button type="button" disabled={pattern[f.key] >= f.max}
                onClick={() => onLoopPattern(route.id, { ...pattern, [f.key]: pattern[f.key] + 1 })}
                aria-label={`${f.label} up`}>+</button>
            </div>
          </Field>
        ))}
      </section>

      <section className="lsheet-group lsheet-group--rhythm">
        <GroupHead title="Arpeggiator" description="Break each stop note into a rhythmic pattern." />
        {(() => {
          const dev = deviceToggleState(autoTargets, 'device.arp', ag.enabled)
          return <>
            <button
              type="button"
              className={`lsheet-toggle lsheet-toggle--inline ${dev.on ? 'is-on' : ''}`}
              onClick={() => onArp(route.id, { enabled: !ag.enabled })}
              aria-pressed={dev.on}
              disabled={dev.automated}
            >{dev.automated ? `Automated · ${dev.on ? 'on' : 'off'}` : dev.on ? 'Arpeggiator on' : 'Arpeggiator off'}</button>
            {dev.automated && <p className="lsheet-hint">An automation lane switches the arpeggiator. Remove it in Auto to set it by hand.</p>}
          </>
        })()}

        <div className={arpEditable ? '' : 'lsheet-disabled-group'}>
          <Field label="Style">
            <div className="lsheet-choice-grid">
              {ARP_STYLES.map(style => (
                <button
                  key={style}
                  type="button"
                  disabled={!arpEditable}
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
                  disabled={!arpEditable}
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
                <button type="button" disabled={!arpEditable} onClick={() => onArp(route.id, { octaves: Math.max(1, ag.octaves - 1) })} aria-label="Arpeggiator octaves down">−</button>
                <span className="mono">{ag.octaves}</span>
                <button type="button" disabled={!arpEditable} onClick={() => onArp(route.id, { octaves: Math.min(4, ag.octaves + 1) })} aria-label="Arpeggiator octaves up">+</button>
              </div>
            </Field>
            <Field label="Steps">
              <div className="lsheet-stepper">
                <button type="button" disabled={!arpEditable} onClick={() => onArp(route.id, { steps: Math.max(1, ag.steps - 1) })} aria-label="Arpeggiator steps down">−</button>
                <span className="mono">{ag.steps}</span>
                <button type="button" disabled={!arpEditable} onClick={() => onArp(route.id, { steps: Math.min(6, ag.steps + 1) })} aria-label="Arpeggiator steps up">+</button>
              </div>
            </Field>
          </div>

          <Field label={`Gate · ${Math.round(ag.gate * 100)}%`}>
            <input
              type="range" min={0.05} max={2} step={0.05} value={ag.gate}
              disabled={!arpEditable}
              onChange={e => onArp(route.id, { gate: Number(e.target.value) })}
              aria-label="Arpeggiator gate"
            />
          </Field>
        </div>
      </section>
    </div>
  )
}
