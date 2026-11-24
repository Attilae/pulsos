'use client'
import { useMemo } from 'react'
import { availableAutomationTargets } from '@/lib/engine.js'
import { filterTargetActive, FILTER_TARGET_MODELS, FILTER_MODEL_LABELS } from '@/lib/laneFilterSpec.js'
import { polyTargetActive, POLY_TARGET_VOICES, POLY_VOICE_LABELS } from '@/lib/soundSpecs.js'
import { textureTargetActive, TEXTURE_MODEL_LABELS } from '@/lib/granularEngine.js'
import { isToggleTarget, toggleTargetActive } from '@/lib/toggleAutomation.js'
import { supportsGranular } from '@/lib/engine.js'
import { useResetGesture } from '@/lib/shared/useResetGesture.js'
import { IconClose } from '../icons.jsx'
import { SPEED_OPTIONS } from '../DawView.jsx'

export default function AutomationFields({ instRoute, allRoutes = [], synthType = 'Synth', adsr, filter, granular, sidechain, activeFxTracks,
  sourceRouteId, paramTarget, speed, glide, onUpdate, onRemove, variant = 'rack' }) {
  const sheet = variant === 'sheet'
  const granularEnabled = !!granular?.enabled
  const resetGlide = useResetGesture(() => onUpdate({ glide: 0 }))
  // Any lane (active or not) can be a source: a source now stays visible and audible
  // in its own section while its geographic data also drives this automation curve.
  // A merged lane has no per-stop geography of its own, so it can't be a source.
  const pickableRoutes = allRoutes.filter(r => r.id !== instRoute.id && !r.isMerged)
  // A device on/off lane is drawn on the lane's own loop: no source, speed or glide.
  const drawn = isToggleTarget(paramTarget)
  const toggleState = drawn
    ? toggleTargetActive(paramTarget, { textureSupported: supportsGranular(synthType), sidechainSource: sidechain?.source })
    : null

  // Target options, grouped by .group, filtered to what's valid for this synth type.
  const groupedTargets = useMemo(() => {
    const groups = {}
    for (const t of availableAutomationTargets(synthType, activeFxTracks ?? [], granularEnabled, granular)) {
      const g = t.group ?? 'Other'
      ;(groups[g] ??= []).push(t)
    }
    return groups
  }, [synthType, activeFxTracks, granularEnabled, granular])

  return (
    <div className={`auto-lane-controls${sheet ? " auto-lane-controls--sheet" : ""}`}>
        {sheet && !drawn && <span className="lsheet-label">Source line</span>}
        {!drawn && <select aria-label="Automation source" className="auto-select auto-select--source-line" value={sourceRouteId}
          onChange={e => onUpdate({ sourceRouteId: e.target.value })}>
          <option value="">Pick a line</option>
          {pickableRoutes.map(r => {
            // Some cities (e.g. NYC/MTA) carry paragraph-length descriptions; native <option>
            // text can't be CSS-truncated, so cap it here or the dropdown popup overflows.
            const desc = r.desc && r.desc.length > 48 ? `${r.desc.slice(0, 48).trimEnd()}…` : r.desc
            return (
              <option key={r.id} value={r.id}>
                {r.name}{desc ? ` · ${desc}` : ''}
              </option>
            )
          })}
        </select>}

        {sheet && <span className="lsheet-label">Target</span>}
        <select aria-label="Automation target" className="auto-select" value={paramTarget}
          onChange={e => onUpdate({ paramTarget: e.target.value })}>
          {Object.entries(groupedTargets).map(([group, targets]) => (
            <optgroup key={group} label={group}>
              {targets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.label}{FILTER_TARGET_MODELS[t.id] ? ` (${FILTER_MODEL_LABELS[FILTER_TARGET_MODELS[t.id]]})` : ''}
                  {synthType === 'PolySynth' && POLY_TARGET_VOICES[t.id] ? ` (${POLY_TARGET_VOICES[t.id].map(v => POLY_VOICE_LABELS[v]).join(', ')})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <button className="auto-remove-btn" onClick={onRemove} title="Remove lane" aria-label="Remove automation lane">{sheet ? "Remove automation" : <IconClose />}</button>

        {!filterTargetActive(paramTarget, filter) && (
          <p className="auto-lane-inactive" role="status">
            Inactive: this target needs the {FILTER_MODEL_LABELS[FILTER_TARGET_MODELS[paramTarget]]} filter.
            It resumes when the lane switches back.
          </p>
        )}
        {!polyTargetActive(paramTarget, synthType, adsr) && (
          <p className="auto-lane-inactive" role="status">
            Inactive: this target needs the {POLY_TARGET_VOICES[paramTarget].map(v => POLY_VOICE_LABELS[v]).join(' or ')} voice.
            It resumes when the lane switches back.
          </p>
        )}
        {toggleState && !toggleState.active && (
          <p className="auto-lane-inactive" role="status">
            Inactive: {toggleState.reason}. The switch points are kept.
          </p>
        )}
        {drawn && toggleState?.active && !sheet && (
          <p className="auto-lane-hint">Click to add a switch point, drag to move, double-click to delete.</p>
        )}
        {!textureTargetActive(paramTarget, granular) && (
          <p className="auto-lane-inactive" role="status">
            Inactive: this target needs Texture {TEXTURE_MODEL_LABELS[paramTarget.startsWith('grain.tx2') ? 'mk2' : 'classic']}.
            It resumes when the lane switches back.
          </p>
        )}

        {!drawn && <>
        <div className="speed-row auto-speed-row">
          <span className="speed-label">SPEED</span>
          <div className="speed-btns">
            {SPEED_OPTIONS.map(opt => (
              <button
                key={opt.value}
                aria-pressed={speed === opt.value}
                className={`speed-btn ${speed === opt.value ? 'active' : ''}`}
                style={!sheet && speed === opt.value ? { borderColor: instRoute.color, color: instRoute.color } : {}}
                onClick={() => onUpdate({ speed: opt.value })}
                title={opt.title}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {sheet && <button type="button" className="lsheet-reset" onClick={() => onUpdate({ speed: 1 })}>Reset speed</button>}
        </div>

        <div className="glide-row auto-glide-row">
          <span className="glide-label">GLIDE</span>
          <input
            type="range" min="0" max="1" step="0.01"
            value={glide}
            aria-label="Automation glide"
            aria-valuetext={`${Math.round(glide * 100)}%`}
            onChange={e => onUpdate({ glide: parseFloat(e.target.value) })}
            {...resetGlide}
            className="glide-slider"
            style={{ accentColor: sheet ? 'var(--accent)' : instRoute.color }}
          />
          <span className="glide-val" style={{ color: sheet ? 'var(--text-subtle)' : instRoute.color }}>{Math.round(glide * 1000)}ms</span>
          {sheet && <button type="button" className="lsheet-reset" onClick={() => onUpdate({ glide: 0 })}>Reset glide</button>}
        </div>
        </>}
      </div>
  )
}
