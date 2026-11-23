// The eight header controls that aren't Play, BPM or the view switch.
//
// Desktop lays these out as an 11-item flex-wrap row; at 390px that same row
// stacks into six lines of sticky chrome before you can see a single lane.
'use client'

import Sheet from '../Sheet.jsx'
import { NOTE_ROOTS, SCALE_TYPES } from '../DawView.jsx'
import { IconDownload, IconWaveform, IconMixer, IconMotion, IconRepick, IconMusic, IconAdd } from '../icons.jsx'
import { ReferenceControls, ReferenceWaveform, ReferenceUploadButton, REFERENCE_LANE_LABEL, REFERENCE_UPLOAD_LABEL } from '../ReferenceLane.jsx'

export default function MoreSheet({
  open, onClose,
  cityName,
  started = false,
  mode, onMode, liveAvailable,
  harmony, onHarmony, harmonyMixed,
  onRepick,
  onExportMidi, onExportWav, canExport, audioExporting, audioProgress = 0,
  canImportDrums, hasDrums, onImportDrums,
  reference, bpm,
  onOpenAi, onOpenMixer, onOpenActivity,
  onSoundCheck,
}) {
  return (
    <Sheet open={open} onClose={onClose} title={`${cityName} · session`} className="more-sheet" tourId="mobile-session-sheet">
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
        <button type="button" className="msheet-action" data-tour="mobile-mixer-open" onClick={onOpenMixer}><IconMixer /> Mixer</button>
        <button type="button" className="msheet-action" onClick={onOpenActivity}><IconMotion /> Activity</button>
        {/* Same rule as the desktop header: re-picking swaps lanes under a
            running engine, so it waits for Stop rather than silently doing nothing. */}
        <button type="button" className="msheet-action" onClick={onRepick} disabled={started}>
          <IconRepick /> Re-pick all lines
        </button>
        {started && <span className="msheet-hint">Stop playback to re-pick lines.</span>}
        {canImportDrums && (
          <button type="button" className="msheet-action" onClick={onImportDrums}>
            <IconMusic /> {hasDrums ? 'Update drums' : 'Add drums'}
          </button>
        )}
        <button type="button" className="msheet-action" onClick={onOpenAi}>
          <IconAdd /> AI Composer
        </button>
      </div>

      {reference && (
        <div className="msheet-field">
          <span className="msheet-label">{REFERENCE_LANE_LABEL}</span>
          {reference.reference ? (
            <>
              <span className="msheet-hint">{reference.reference.name}</span>
              {reference.peaks && <ReferenceWaveform peaks={reference.peaks} meta={reference.reference} bpm={bpm} started={started} visible={open} />}
              <ReferenceControls reference={reference} bpm={bpm} variant="sheet" />
            </>
          ) : (
            <div className="msheet-actions">
              <ReferenceUploadButton reference={reference} className="msheet-action">
                <IconWaveform /> {REFERENCE_UPLOAD_LABEL}
              </ReferenceUploadButton>
            </div>
          )}
          <span className="msheet-hint">
            Play your own loop on the bar grid and find the missing part against it.
          </span>
        </div>
      )}

      <div className="msheet-field">
        <span className="msheet-label">Export</span>
        <div className="msheet-actions">
          <button type="button" className="msheet-action" onClick={onExportMidi} disabled={!canExport}>
            <IconDownload /> MIDI
          </button>
          <button type="button" className="msheet-action" onClick={onExportWav} disabled={!started || !canExport || audioExporting}>
            {audioExporting ? `Recording ${Math.round(audioProgress * 100)}%` : <><IconDownload /> WAV</>}
          </button>
        </div>
        <span className="msheet-hint">
          {started
            ? 'WAV records in real time: it plays the song through once to capture it.'
            : 'WAV records the live mix in real time, so press Play first.'}
        </span>
      </div>

      <button type="button" className="msheet-action msheet-action--quiet" onClick={onSoundCheck}>
        Sound problems?
      </button>
    </Sheet>
  )
}
