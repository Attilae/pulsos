// Lane label editor — names a lane by its musical role ("Bass", "Lead", "Pad")
// and gives it a colour, which the lane box paints as its left border.
//
// Two exports, deliberately:
//   • LaneTagFields — the controls themselves, reused verbatim by the phone lane
//     sheet (same trick as DawView's SidechainSourceOptions). The desktop modal
//     and the sheet can't drift on which presets or swatches exist.
//   • default LaneTagEditor — the desktop modal wrapper (portal + Esc + backdrop,
//     matching StopEditor).
//
// Edits are live: every control fires its callback immediately, so there is no
// Apply button and no local draft to fall out of sync.
'use client'

import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { LANE_TAG_PRESETS, LANE_TAG_COLORS, LANE_TAG_MAX_LEN, normalizeLaneTag } from '@/lib/laneTags.js'
import './LaneTagEditor.css'

/**
 * The label controls. `onChange` takes a partial patch ({ text } / { color } /
 * both) — MixerTab merges it, so a preset can set text and colour in one call.
 */
export function LaneTagFields({ tag, onChange }) {
  const { text, color } = normalizeLaneTag(tag)

  return (
    <div className="lane-tag-fields">
      <div className="lane-tag-presets">
        {LANE_TAG_PRESETS.map(preset => (
          <button
            key={preset.text}
            type="button"
            className={`lane-tag-preset ${text === preset.text ? 'is-active' : ''}`}
            style={{ '--lane-tag-color': preset.color }}
            onClick={() => onChange({ text: preset.text, color: preset.color })}
          >{preset.text}</button>
        ))}
      </div>

      <input
        type="text"
        className="lane-tag-input"
        value={text}
        maxLength={LANE_TAG_MAX_LEN}
        placeholder="Custom label"
        aria-label="Lane label"
        onChange={e => onChange({ text: e.target.value })}
      />

      <div className="lane-tag-swatches">
        {LANE_TAG_COLORS.map(swatch => (
          <button
            key={swatch}
            type="button"
            className={`lane-tag-swatch ${color === swatch ? 'is-active' : ''}`}
            style={{ '--lane-tag-color': swatch }}
            aria-label={`Colour ${swatch}`}
            aria-pressed={color === swatch}
            onClick={() => onChange({ color: swatch })}
          />
        ))}
        {/* Native picker for anything outside the swatch row. It has no "unset"
            state, so clearing the colour is the separate button below. */}
        <input
          type="color"
          className="lane-tag-color-input"
          value={color || '#94a3b8'}
          aria-label="Custom colour"
          onChange={e => onChange({ color: e.target.value })}
        />
      </div>

      <button
        type="button"
        className="lane-tag-clear"
        disabled={!text && !color}
        onClick={() => onChange({ text: '', color: '' })}
      >Clear label</button>
    </div>
  )
}

export default function LaneTagEditor({ routeName, tag, onChange, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const handleChange = useCallback(patch => onChange(patch), [onChange])

  return createPortal(
    <div className="dlg-overlay" onPointerDown={onClose}>
      <div className="lane-tag-editor" onPointerDown={e => e.stopPropagation()}>
        <div className="lane-tag-editor-head">
          <h2 className="dlg-title">Label · {routeName}</h2>
          <button className="lane-tag-editor-close" onClick={onClose} title="Close">✕</button>
        </div>
        <p className="lane-tag-editor-hint">
          Name this lane by what it plays. The colour marks the lane box.
        </p>
        <LaneTagFields tag={tag} onChange={handleChange} />
      </div>
    </div>,
    document.body,
  )
}
