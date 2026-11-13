'use client'

// Reference loop lane (signed-in Free and Pro): the user's own loop on the bar grid, to audition
// lanes against. State lives in lib/useReferenceTrack.js (owned by MixerTab);
// this file is presentation only. The loop is kept on the device and in the
// account (a plan-limited number of stored loops), which `CloudNote` and
// `StoredLoops` report and manage. `ReferenceControls` is shared by the desktop
// lane and the phone sheet, so the two can't drift on what's adjustable.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { useEntitlements } from '@/lib/shared/EntitlementsContext.jsx'
import { subscribePlayhead } from '@/lib/shared/playheadTicker.js'
import { useResetGesture } from '@/lib/shared/useResetGesture.js'
import {
  REFERENCE_BAR_OPTIONS, REFERENCE_VOLUME_RANGE, REFERENCE_OFFSET_RANGE,
  bpmForBars, cycleSeconds, driftWarning,
} from '@/lib/referenceTrack.js'
import { formatLoopSize } from '@/lib/referenceLoops.js'
import { IconClose, IconPower, IconUpload, IconWaveform, IconWarning } from './icons.jsx'
import './ReferenceLane.css'

// User-facing names, in one place so the feature can be renamed in one edit.
export const REFERENCE_LANE_LABEL = 'Your loop'
export const REFERENCE_UPLOAD_LABEL = 'Upload your loop'

export const REFERENCE_ACCEPT = '.wav,.wave,.mp3,.aif,.aiff,.aifc,audio/*'

// Guests see the free-account prompt before choosing a file.
export function ReferenceUploadButton({ reference, className = '', children, disabled = false }) {
  const inputRef = useRef(null)
  const { signedIn: allowed, openUpgrade } = useEntitlements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const choose = useCallback(() => {
    if (allowed) inputRef.current?.click()
    else openUpgrade('reference_track')
  }, [allowed, openUpgrade])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''   // picking the same file again still fires onChange
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      await reference.upload(file)
    } catch (err) {
      console.error('[reference] upload failed', err)
      setError(err?.message ?? "Couldn't load that file")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={choose}
        disabled={disabled || busy}
        title={allowed ? 'Load a WAV, AIFF or MP3 loop to play along with the lanes' : 'Create a free account or sign in to upload your loop'}
      >
        {busy ? 'Loading…' : children}
        {!allowed && <span className="reference-account-chip">Free account</span>}
      </button>
      {error && <span className="reference-error" role="alert">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={REFERENCE_ACCEPT}
        style={{ display: 'none' }}
        onChange={handleFile}
      />
    </>
  )
}

function StatusNote({ reference }) {
  const { status, error, unsaved } = reference
  const { openUpgrade } = useEntitlements()
  const name = reference.reference?.name || 'the loop'
  if (status === 'loading') return <p className="reference-note">Loading {name}…</p>
  if (status === 'locked') {
    return (
      <p className="reference-note reference-note--warn">
        <IconWarning /> Sign in to play your own loop.{' '}
        <button type="button" className="reference-link" onClick={() => openUpgrade('reference_track')}>Sign in or create a free account</button>
      </p>
    )
  }
  if (status === 'missing') {
    return (
      <p className="reference-note reference-note--warn">
        <IconWarning /> {name} isn't stored in this browser or in this account.{' '}
        <ReferenceUploadButton reference={reference} className="reference-link">Re-upload it</ReferenceUploadButton>
      </p>
    )
  }
  if (status === 'error') return <p className="reference-note reference-note--warn"><IconWarning /> {error}</p>
  if (unsaved) {
    return <p className="reference-note">This loop plays for this session only: the browser wouldn't store it.</p>
  }
  return null
}

// Where the loop is kept beyond this device.
function CloudNote({ reference }) {
  const { cloud, cloudMessage, canStore } = reference
  const { openUpgrade, plan } = useEntitlements()
  if (!cloud || cloud === 'synced') return null
  if (cloud === 'uploading') return <p className="reference-note" role="status">Storing the loop in your account…</p>
  if (cloud === 'device') {
    return (
      <p className="reference-note">
        This loop is only on this device.{' '}
        {canStore && <button type="button" className="reference-link" onClick={reference.storeCurrent}>Store it in your account</button>}
      </p>
    )
  }
  return (
    <p className="reference-note reference-note--warn">
      <IconWarning /> {cloudMessage ?? "Couldn't store the loop in your account."} It still plays on this device.{' '}
      {cloud === 'full' && plan === 'free' && (
        <button type="button" className="reference-link" onClick={() => openUpgrade('reference_loops')}>See Pro</button>
      )}
      {cloud === 'error' && canStore && (
        <button type="button" className="reference-link" onClick={reference.storeCurrent}>Try again</button>
      )}
    </p>
  )
}

// The loops stored in the account, with the plan's limit and a delete button.
function StoredLoops({ reference }) {
  const { library } = reference
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  if (!library?.enabled || !library.loops.length) return null
  const currentId = reference.reference?.id

  async function remove(id) {
    setError(null)
    setBusyId(id)
    try {
      await reference.deleteStored(id)
    } catch (err) {
      setError(err?.message ?? "Couldn't delete the loop")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <details className="reference-library">
      <summary>
        Stored loops: {library.loops.length}{library.limit != null ? ` of ${library.limit}` : ''}
      </summary>
      <ul className="reference-library-list">
        {library.loops.map(loop => (
          <li key={loop.id}>
            <span className="reference-library-name" title={loop.name}>{loop.name}</span>
            <span className="reference-value">{formatLoopSize(loop.bytes)}</span>
            {loop.id === currentId && <span className="reference-library-tag">this song</span>}
            <button
              type="button"
              className="reference-btn"
              onClick={() => remove(loop.id)}
              disabled={busyId != null}
              title="Delete this loop from your account. Songs that use it keep it only on devices that already have it."
            >{busyId === loop.id ? 'Deleting…' : 'Delete'}</button>
          </li>
        ))}
      </ul>
      {error && <p className="reference-note reference-note--warn" role="alert"><IconWarning /> {error}</p>}
    </details>
  )
}

const msOf = (sec) => Math.round((sec ?? 0) * 1000)

export function ReferenceControls({ reference, bpm }) {
  const meta = reference.reference
  const offsetReset = useResetGesture(() => reference.update({ offsetSec: 0 }))
  const volumeReset = useResetGesture(() => reference.update({ volumeDb: -6 }))
  if (!meta) return null
  const playableSec = Math.max(0, meta.durationSec - meta.offsetSec)
  const warning = meta.durationSec > 0 ? driftWarning(meta.durationSec, meta.bars, bpm, meta.offsetSec) : null
  const matchBpm = bpmForBars(playableSec, meta.bars)
  const offsetMax = Math.min(REFERENCE_OFFSET_RANGE[1], Math.max(0, meta.durationSec - 0.05))

  return (
    <div className="reference-controls">
      <label className="reference-field">
        <span className="reference-field-label">Length</span>
        <select
          value={meta.bars}
          onChange={e => reference.update({ bars: Number(e.target.value) })}
          aria-label="Loop length in bars"
        >
          {REFERENCE_BAR_OPTIONS.map(b => <option key={b} value={b}>{b} {b === 1 ? 'bar' : 'bars'}</option>)}
        </select>
      </label>

      <div className="reference-field reference-field--bpm">
        <button
          type="button"
          className="reference-btn"
          onClick={reference.matchBpm}
          disabled={matchBpm == null || Math.abs(matchBpm - bpm) < 0.005}
          title="Set the song tempo so the loop fills exactly this many bars"
        >Match BPM{matchBpm != null ? ` (${matchBpm})` : ''}</button>
      </div>

      <label className="reference-field">
        <span className="reference-field-label">Start</span>
        <input
          type="range" min="0" max={offsetMax} step="0.001"
          value={Math.min(meta.offsetSec, offsetMax)}
          onChange={e => reference.update({ offsetSec: Number(e.target.value) })}
          aria-label="Loop start offset"
          aria-valuetext={`${msOf(meta.offsetSec)} ms`}
          title="Skip silence at the start of the file. Double-click to reset."
          {...offsetReset}
        />
        <span className="reference-value">{msOf(meta.offsetSec)} ms</span>
      </label>

      <label className="reference-field">
        <span className="reference-field-label">Vol</span>
        <input
          type="range" min={REFERENCE_VOLUME_RANGE[0]} max={REFERENCE_VOLUME_RANGE[1]} step="1"
          value={meta.volumeDb}
          onChange={e => reference.update({ volumeDb: Number(e.target.value) })}
          aria-label="Your loop volume"
          aria-valuetext={`${meta.volumeDb} dB`}
          className="volume-slider"
          title="Your loop's volume. Double-click to reset."
          {...volumeReset}
        />
        <span className="reference-value">{meta.volumeDb} dB</span>
      </label>

      <button
        type="button"
        className={`reference-btn ${meta.muted ? 'on' : ''}`}
        aria-pressed={meta.muted}
        onClick={() => reference.update({ muted: !meta.muted })}
        title={meta.muted ? 'Unmute your loop' : 'Mute your loop'}
      ><IconPower /> {meta.muted ? 'Muted' : 'Mute'}</button>

      <label className="reference-check" title="WAV mix exports leave your loop out unless this is on">
        <input
          type="checkbox"
          checked={meta.includeInExport}
          onChange={e => reference.update({ includeInExport: e.target.checked })}
        />
        Include in WAV export
      </label>

      <div className="reference-actions">
        <ReferenceUploadButton reference={reference} className="reference-btn"><IconUpload /> Replace</ReferenceUploadButton>
        <button type="button" className="reference-btn" onClick={reference.remove} title="Take the loop out of this song (it stays stored)">
          <IconClose /> Remove
        </button>
      </div>

      {warning && <p className="reference-note reference-note--warn reference-drift"><IconWarning /> {warning}</p>}
      <StatusNote reference={reference} />
      <CloudNote reference={reference} />
      <StoredLoops reference={reference} />
    </div>
  )
}

// Static waveform of the whole file; the played window (offset → offset + one
// cycle) is highlighted and the playhead is drawn from the shared ticker.
function ReferenceWaveform({ peaks, meta, bpm, started, visible }) {
  const canvasRef = useRef(null)
  const headRef = useRef(null)
  const wrapRef = useRef(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !peaks?.length) return undefined
    const draw = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = getComputedStyle(canvas).color
      const mid = h / 2
      const bar = w / peaks.length
      for (let i = 0; i < peaks.length; i++) {
        const amp = Math.max(0.5, peaks[i] * (h / 2 - 1))
        ctx.fillRect(i * bar, mid - amp, Math.max(1, bar - 0.5), amp * 2)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [peaks])

  const duration = meta.durationSec || 0
  const cycle = cycleSeconds(meta.bars, bpm)
  const windowStart = duration > 0 ? meta.offsetSec / duration : 0
  const windowEnd = duration > 0 ? Math.min(1, (meta.offsetSec + cycle) / duration) : 1

  useEffect(() => {
    const head = headRef.current
    const wrap = wrapRef.current
    if (!head || !wrap) return undefined
    if (!started || !visible || !(duration > 0)) { head.style.opacity = '0'; return undefined }
    head.style.opacity = '1'
    return subscribePlayhead(() => {
      // Phase in ticks, like the engine's repeat, so a tempo change mid-play
      // doesn't shift the drawn playhead off the audio.
      const transport = Tone.getTransport()
      const c = cycleSeconds(meta.bars, transport.bpm.value || bpm)
      const cycleTicks = transport.PPQ * 4 * meta.bars
      if (!(c > 0) || !(cycleTicks > 0)) return
      const into = ((transport.ticks % cycleTicks) / cycleTicks) * c
      const pos = meta.offsetSec + into
      const frac = pos >= duration ? 1 : pos / duration
      head.style.transform = `translateX(${frac * wrap.clientWidth}px)`
    })
  }, [started, visible, duration, meta.bars, meta.offsetSec, bpm])

  return (
    <div className="reference-wave" ref={wrapRef}>
      <canvas ref={canvasRef} className="reference-wave-canvas" aria-hidden="true" />
      <div
        className="reference-wave-window"
        style={{ left: `${windowStart * 100}%`, width: `${Math.max(0, windowEnd - windowStart) * 100}%` }}
        aria-hidden="true"
      />
      <div className="reference-wave-head" ref={headRef} aria-hidden="true" />
    </div>
  )
}

// Desktop lane, rendered by DawView under the instrument lanes.
export default function ReferenceLane({ reference, bpm, started = false, visible = true }) {
  const meta = reference.reference
  if (!meta) return null
  return (
    <div className={`daw-section reference-section ${meta.muted ? 'reference-section--muted' : ''}`}>
      <div className="daw-section-label reference-label">
        <IconWaveform />
        <span className="reference-title">{REFERENCE_LANE_LABEL}</span>
        <span className="reference-name" title={meta.name}>{meta.name || 'Loop'}</span>
      </div>
      {reference.peaks && (
        <ReferenceWaveform peaks={reference.peaks} meta={meta} bpm={bpm} started={started} visible={visible} />
      )}
      <ReferenceControls reference={reference} bpm={bpm} />
    </div>
  )
}
