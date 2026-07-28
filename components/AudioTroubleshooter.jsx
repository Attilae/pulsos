// "I pressed play and I can't hear anything."
//
// The honest design constraint: the iPhone ring/silent switch is NOT detectable
// from JavaScript, and neither is the device volume. Every "trick" for this is
// unreliable. So this panel never asserts that the phone is muted. Instead it
// verifies everything that IS knowable — is the AudioContext running, is the
// master fader up, is anything actually enabled, and is the output bus carrying
// real signal — and uses the *combination* to point at the right culprit:
//
//   all internal checks pass + output has signal → the browser is producing
//     sound and the problem is outside it (hardware switch, device volume,
//     Bluetooth routing). Those rows get promoted to the top.
//   all internal checks pass + output is silent  → that's our bug, and we say so.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { getDiagnostics, probeOutputPeak, unlockAudio } from '@/lib/audioSession.js'
import { trackProductEvent } from '@/lib/productAnalytics.js'
import './AudioTroubleshooter.css'

const SILENCE_DB = -80   // below this we treat the bus as silent

export default function AudioTroubleshooter({
  open,
  onClose,
  started = false,
  masterVolume = 0,
  onMasterVolume,
  activeLaneCount = 0,
  onEnableLanes,
  trigger = 'manual',
}) {
  const [diag, setDiag] = useState(null)
  const [peakDb, setPeakDb] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) trackProductEvent('audio_troubleshooter_opened', { trigger, started })
  }, [open, trigger, started])

  // Poll while open so the rows react to fixes made from inside the panel.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      setDiag(getDiagnostics())
      const db = await probeOutputPeak(300)
      if (!cancelled) setPeakDb(db)
    }
    tick()
    const id = setInterval(tick, 900)
    return () => { cancelled = true; clearInterval(id) }
  }, [open])

  const resume = useCallback(async () => {
    setBusy(true)
    await unlockAudio()
    setDiag(getDiagnostics())
    setBusy(false)
  }, [])

  if (!open) return null

  const contextOk = diag?.contextState === 'running'
  const masterOk  = !diag?.masterMuted && (diag?.masterDb ?? masterVolume) > -60
  const lanesOk   = activeLaneCount > 0
  const hasSignal = peakDb != null && peakDb > SILENCE_DB
  const internalsOk = contextOk && masterOk && lanesOk

  // The key inference: healthy graph + measurable output = not our problem.
  const soundIsLeavingTheApp = internalsOk && started && hasSignal
  // Equally important to name: healthy graph, playing, and nothing on the bus.
  const appIsBroken = internalsOk && started && peakDb != null && !hasSignal

  return (
    <Sheet open={open} onClose={onClose} title="Sound check" className="audio-check">
      {soundIsLeavingTheApp && (
        <p className="audio-check-verdict audio-check-verdict--external">
          Leið <strong>is</strong> producing sound — the output meter below is moving.
          If you still hear nothing, it&rsquo;s between the browser and your ears:
        </p>
      )}

      {soundIsLeavingTheApp && <DeviceRows ios={diag?.ios} />}

      {appIsBroken && (
        <p className="audio-check-verdict audio-check-verdict--bug">
          Everything is configured correctly but no signal is reaching the output.
          That&rsquo;s a bug on our side, not something you can fix here.
        </p>
      )}

      <ul className="audio-check-list">
        <Row
          ok={contextOk}
          label="Audio engine"
          detail={contextOk
            ? `Running at ${diag?.sampleRate ? Math.round(diag.sampleRate / 1000) + ' kHz' : 'default rate'}`
            : `Browser audio is ${diag?.contextState ?? 'suspended'} — it needs a tap to wake up.`}
          action={contextOk ? null : { label: busy ? 'Starting…' : 'Resume audio', onClick: resume, disabled: busy }}
        />

        <Row
          ok={masterOk}
          label="Master volume"
          detail={diag?.masterMuted
            ? 'The master output is muted.'
            : `${Math.round(diag?.masterDb ?? masterVolume)} dB`}
        >
          {onMasterVolume && (
            <input
              type="range"
              className="audio-check-slider"
              min={-40} max={6} step={1}
              value={masterVolume}
              onChange={e => onMasterVolume(Number(e.target.value))}
              aria-label="Master volume"
            />
          )}
        </Row>

        <Row
          ok={lanesOk}
          label="Enabled lanes"
          detail={lanesOk
            ? `${activeLaneCount} lane${activeLaneCount === 1 ? '' : 's'} audible`
            : 'Every lane is disabled — new sessions start silent so you can build the mix one line at a time.'}
          action={lanesOk || !onEnableLanes ? null : { label: 'Enable a lane', onClick: () => { onEnableLanes(); onClose?.() } }}
        />

        <Row
          ok={hasSignal}
          label="Output level"
          detail={!started
            ? 'Press Play to measure.'
            : peakDb == null ? 'Measuring…'
            : hasSignal ? `Peak ${peakDb.toFixed(1)} dBFS`
            : 'Silent'}
        >
          <Meter db={peakDb} />
        </Row>
      </ul>

      {!soundIsLeavingTheApp && <DeviceRows ios={diag?.ios} muted />}

      <p className="audio-check-foot">
        Headphones are recommended — phone speakers lose most of the bass these
        instruments live in.
      </p>
    </Sheet>
  )
}

// The two things we genuinely cannot detect, stated as instructions rather than
// as claims about the device's state.
function DeviceRows({ ios, muted = false }) {
  return (
    <ul className={`audio-check-list audio-check-list--device ${muted ? 'is-muted' : ''}`}>
      {ios && (
        <li className="audio-check-row audio-check-row--device">
          <span className="audio-check-dot audio-check-dot--unknown" aria-hidden="true" />
          <div className="audio-check-text">
            <span className="audio-check-label">Ring / silent switch</span>
            <span className="audio-check-detail">
              iPhones mute browser audio when the switch above the volume buttons
              is flipped down. If you can see orange, flip it back.
            </span>
          </div>
        </li>
      )}
      <li className="audio-check-row audio-check-row--device">
        <span className="audio-check-dot audio-check-dot--unknown" aria-hidden="true" />
        <div className="audio-check-text">
          <span className="audio-check-label">Device volume</span>
          <span className="audio-check-detail">
            Press volume-up <em>while a sound is playing</em> — media volume is
            separate from ringer volume and only moves during playback.
          </span>
        </div>
      </li>
    </ul>
  )
}

function Row({ ok, label, detail, action, children }) {
  return (
    <li className={`audio-check-row ${ok ? 'is-ok' : 'is-bad'}`}>
      <span className={`audio-check-dot ${ok ? 'audio-check-dot--ok' : 'audio-check-dot--bad'}`} aria-hidden="true" />
      <div className="audio-check-text">
        <span className="audio-check-label">{label}</span>
        <span className="audio-check-detail">{detail}</span>
        {children}
      </div>
      {action && (
        <button type="button" className="audio-check-fix" onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </button>
      )}
    </li>
  )
}

function Meter({ db }) {
  // -60..0 dBFS mapped across the bar; null/-Infinity render empty.
  const pct = db == null || !Number.isFinite(db)
    ? 0
    : Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  return (
    <div className="audio-check-meter" role="img" aria-label={`Output peak ${db == null ? 'unknown' : `${db.toFixed(0)} dB`}`}>
      <span className="audio-check-meter-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
