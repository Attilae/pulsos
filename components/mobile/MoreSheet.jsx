// The eight header controls that aren't Play, BPM or the view switch.
//
// Desktop lays these out as an 11-item flex-wrap row; at 390px that same row
// stacks into six lines of sticky chrome before you can see a single lane.
'use client'

import Sheet from '../Sheet.jsx'
import { NOTE_ROOTS, SCALE_TYPES } from '../DawView.jsx'

export default function MoreSheet({
  open, onClose,
  cityName,
  mode, onMode, liveAvailable,
  harmony, onHarmony, harmonyMixed,
  onRepick,
  onExportMidi, onExportWav, canExport, audioExporting,
  canImportDrums, hasDrums, onImportDrums,
  onOpenAi,
  onSoundCheck,
}) {
  return (
    <Sheet open={open} onClose={onClose} title={`${cityName} · session`} className="more-sheet">
      <div className="msheet-field">
        <span className="msheet-label">
          Harmony {harmonyMixed && <em className="msheet-mixed">lanes differ</em>}
        </span>
        <div className="msheet-pair">
          <select
            value={harmony.root}
            onChange={e => onHarmony({ ...harmony, root: e.target.value })}
            aria-label="Root note for all lanes"
          >
            {NOTE_ROOTS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            value={harmony.scaleType}
            onChange={e => onHarmony({ ...harmony, scaleType: e.target.value })}
            aria-label="Scale for all lanes"
          >
            {SCALE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {liveAvailable && (
        <div className="msheet-field">
          <span className="msheet-label">Source</span>
          <div className="msheet-seg">
            <button
              type="button" className={mode === 'mock' ? 'is-active' : ''}
              onClick={() => onMode('mock')}
            >Mock</button>
            <button
              type="button" className={mode === 'live' ? 'is-active' : ''}
              onClick={() => onMode('live')}
            >Live</button>
          </div>
        </div>
      )}

      <div className="msheet-actions">
        <button type="button" className="msheet-action" onClick={onRepick}>
          ↻ Re-pick all lines
        </button>
        {canImportDrums && (
          <button type="button" className="msheet-action" onClick={onImportDrums}>
            ♪ {hasDrums ? 'Update drums' : 'Add drums'}
          </button>
        )}
        <button type="button" className="msheet-action" onClick={onOpenAi}>
          ✦ AI Composer
        </button>
      </div>

      <div className="msheet-field">
        <span className="msheet-label">Export</span>
        <div className="msheet-actions">
          <button type="button" className="msheet-action" onClick={onExportMidi} disabled={!canExport}>
            ↓ MIDI
          </button>
          <button type="button" className="msheet-action" onClick={onExportWav} disabled={!canExport || audioExporting}>
            {audioExporting ? 'Recording…' : '↓ WAV'}
          </button>
        </div>
        <span className="msheet-hint">
          WAV records in real time — it plays the song through once to capture it.
        </span>
      </div>

      <button type="button" className="msheet-action msheet-action--quiet" onClick={onSoundCheck}>
        Sound problems?
      </button>
    </Sheet>
  )
}
