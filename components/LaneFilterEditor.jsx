'use client'

// The lane filter editor's shared half: model switching (with the notch notice),
// the Analog load status + Retry, and the phone field set. The desktop rack's
// FilterPanel (DawView.jsx) renders its own sp-* rows from the same hook, so
// desktop and phone can't disagree about ranges, defaults or rules — all of which
// come from lib/laneFilterSpec.js.

import { useState } from 'react'
import * as Tone from 'tone'
import {
  ANALOG_MODEL, CLASSIC_MODEL, FILTER_MODEL_LABELS, ANALOG_FILTER_TYPES, CLASSIC_FILTER_TYPES,
  ANALOG_SLOPES, FILTER_RANGES, ANALOG_UNAVAILABLE_NOTICE,
  analogMaxCutoff, filterModelPatch, resolveLaneFilter, resonanceFromPercent, resonanceToPercent,
} from '@/lib/laneFilterSpec.js'
import { retryLadder } from '@/lib/ladderLoader.js'
import { retryAnalogFilters } from '@/lib/laneFilter.js'
import { useLadderStatus } from '@/lib/shared/useLadderStatus.js'

export const DRIVE_HELP = 'Drive is the input level into the ladder. The lane level feeds it too, so a louder lane saturates more.'

function contextRate() {
  try { return Tone.getContext().sampleRate } catch { return 48000 }
}

const formatHz = (hz) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`)

// Everything both editors need. `onFilter(patch)` writes a partial filter object.
export function useLaneFilterEditor(filter, onFilter) {
  const p = resolveLaneFilter(filter)
  const analog = p.model === ANALOG_MODEL
  const [notice, setNotice] = useState(null)
  const maxCutoff = analog ? analogMaxCutoff(contextRate()) : FILTER_RANGES.frequency.max
  return {
    p,
    analog,
    types: analog ? ANALOG_FILTER_TYPES : CLASSIC_FILTER_TYPES,
    notice,
    maxCutoff,
    // The requested cutoff is above what the Analog filter reaches here.
    cutoffLimit: analog && p.frequency > maxCutoff ? `Plays at ${formatHz(maxCutoff)} max at this sample rate` : null,
    resonancePct: resonanceToPercent(p.resonance),
    setModel(model) {
      if (model === p.model) return
      const { patch, notice: n } = filterModelPatch(filter, model)
      setNotice(n)
      onFilter(patch)
    },
    setResonancePct(pct) { onFilter({ resonance: resonanceFromPercent(pct) }) },
    set(patch) { setNotice(null); onFilter(patch) },
  }
}

// Pending / unavailable line for an Analog lane; nothing for Classic.
export function AnalogFilterStatus({ analog, className = '' }) {
  const status = useLadderStatus()
  if (!analog) return null
  if (status === 'loading') {
    return <p className={`lane-filter-status ${className}`} role="status">Loading the Analog filter. Classic plays meanwhile.</p>
  }
  if (status === 'error') {
    return (
      <p className={`lane-filter-status lane-filter-status--error ${className}`} role="alert">
        {ANALOG_UNAVAILABLE_NOTICE}.{' '}
        <button type="button" className="lane-filter-retry" onClick={() => retryLadder().then(retryAnalogFilters)}>Retry</button>
      </p>
    )
  }
  return null
}

// Classic / Analog segmented switch (response is a separate control).
export function FilterModelSwitch({ value, onChange, className = '' }) {
  return (
    <div className={`lane-filter-model ${className}`} role="radiogroup" aria-label="Filter model">
      {[CLASSIC_MODEL, ANALOG_MODEL].map(m => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          className={`lane-filter-model-btn ${value === m ? 'is-active' : ''}`}
          onClick={() => onChange(m)}
        >{FILTER_MODEL_LABELS[m]}</button>
      ))}
    </div>
  )
}

// Phone lane sheet fields (components/mobile/LaneSheet.jsx, Mix segment).
export function LaneFilterFields({ filter, onFilter, Field }) {
  const ed = useLaneFilterEditor(filter, onFilter)
  const { p, analog } = ed
  return (
    <Field
      label={`Filter · ${FILTER_MODEL_LABELS[p.model]}${p.bypass ? ' · bypassed' : ''}`}
      hint={analog ? DRIVE_HELP : 'Classic is the clean filter. Analog is a ladder filter with resonance and drive.'}
    >
      <FilterModelSwitch value={p.model} onChange={ed.setModel} />
      {ed.notice && <p className="lane-filter-status" role="status">{ed.notice}</p>}
      <AnalogFilterStatus analog={analog} />

      <button
        type="button"
        className={`lsheet-toggle lsheet-toggle--inline ${p.bypass ? '' : 'is-on'}`}
        aria-pressed={!p.bypass}
        onClick={() => ed.set({ bypass: !p.bypass })}
      >{p.bypass ? 'Bypassed' : 'Filter on'}</button>

      <div className="lsheet-send lsheet-send--wide">
        <span className="lsheet-send-name">Response</span>
        <select value={p.type} onChange={e => ed.set({ type: e.target.value })} aria-label="Filter response">
          {ed.types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="lsheet-send lsheet-send--wide">
        <span className="lsheet-send-name">Cutoff · {formatHz(p.frequency)}</span>
        <input
          type="range" min={FILTER_RANGES.frequency.min} max={FILTER_RANGES.frequency.max} step={10}
          value={p.frequency}
          onChange={e => ed.set({ frequency: Number(e.target.value) })}
          aria-label="Filter cutoff"
        />
      </div>
      {ed.cutoffLimit && <p className="lsheet-hint">{ed.cutoffLimit}</p>}

      {analog ? (
        <>
          <div className="lsheet-send lsheet-send--wide">
            <span className="lsheet-send-name">Resonance · {ed.resonancePct}%</span>
            <input
              type="range" min={0} max={100} step={1} value={ed.resonancePct}
              onChange={e => ed.setResonancePct(Number(e.target.value))}
              aria-label="Filter resonance"
            />
          </div>
          <div className="lsheet-send lsheet-send--wide">
            <span className="lsheet-send-name">Drive · {p.drive.toFixed(2)}</span>
            <input
              type="range" min={FILTER_RANGES.drive.min} max={FILTER_RANGES.drive.max} step={0.05} value={p.drive}
              onChange={e => ed.set({ drive: Number(e.target.value) })}
              aria-label="Filter drive"
            />
          </div>
          <div className="lsheet-send lsheet-send--wide">
            <span className="lsheet-send-name">Slope</span>
            <select value={p.slope} onChange={e => ed.set({ slope: Number(e.target.value) })} aria-label="Filter slope">
              {ANALOG_SLOPES.map(s => <option key={s} value={s}>{s} dB/oct</option>)}
            </select>
          </div>
        </>
      ) : (
        <div className="lsheet-send lsheet-send--wide">
          <span className="lsheet-send-name">Q · {p.Q.toFixed(1)}</span>
          <input
            type="range" min={FILTER_RANGES.Q.min} max={FILTER_RANGES.Q.max} step={0.1} value={p.Q}
            onChange={e => ed.set({ Q: Number(e.target.value) })}
            aria-label="Filter Q"
          />
        </div>
      )}
    </Field>
  )
}
