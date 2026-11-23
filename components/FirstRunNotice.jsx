// Shown once in the phone layout, in place of the old MobileGate.
//
// The gate used to block phones entirely. This replaces the block with an
// expectation: the phone build supports touch editing and shares the desktop
// audio engine. The notice also explains the iOS ring/silent switch, which
// the browser cannot detect.
//
// "Got it" doubles as the audio unlock. It is the first guaranteed user
// gesture of the session, which makes it the best possible moment to promote
// the page's audio session out of iOS's muted "ambient" category — long before
// the user finds Play.
'use client'

import { useEffect, useState } from 'react'
import Sheet from './Sheet.jsx'
import { useIsPhone } from '@/lib/shared/useViewport.js'
import { isIOS, formFactor } from '@/lib/shared/platform.js'
import { unlockAudio } from '@/lib/audioSession.js'
import { openSoundCheck } from '@/lib/shared/soundCheck.js'
import { trackProductEvent } from '@/lib/productAnalytics.js'
import './FirstRunNotice.css'

const SEEN_KEY = 'leid-intro-seen'

export function hasSeenIntro() {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}

export default function FirstRunNotice({ onDismiss }) {
  // Keyed to viewport width, not pointer type, because that is exactly when
  // the compact layout renders — and the compact layout is what this explains.
  // (A desktop user who narrows their window below 768px gets it too, which is
  // correct: they're looking at the phone UI and deserve the same explanation.)
  const phone = useIsPhone()
  // 'checking' until the first client effect — matches the old gate's
  // hydration-safe pattern, so the server and first client render agree.
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setChecked(true)
    if (!phone || hasSeenIntro()) { onDismiss?.(); return }
    setOpen(true)
    // The view event itself is fired once by App.jsx for every form factor.
    trackProductEvent('mobile_intro_shown', { form_factor: formFactor(), ios: isIOS() })
  }, [phone]) // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss() {
    // A real gesture — spend it on the audio session before anything else.
    unlockAudio()
    try { localStorage.setItem(SEEN_KEY, '1') } catch {}
    trackProductEvent('mobile_intro_dismissed', { ios: isIOS() })
    setOpen(false)
    onDismiss?.()
  }

  if (!checked || !open) return null

  return (
    <Sheet
      open
      title="Leið on a phone"
      onClose={dismiss}
      footer={
        <>
          <button type="button" className="intro-btn intro-btn--primary" onClick={dismiss}>
            Got it
          </button>
          <button
            type="button"
            className="intro-btn"
            onClick={() => { dismiss(); openSoundCheck('manual') }}
          >
            Sound problems?
          </button>
        </>
      }
    >
      <p className="intro-lead">
        Play the city and shape each lane in Tone, Rhythm, Mix, Notes and Auto.
        Open Mixer from session settings for FX buses and the master output.
      </p>

      {isIOS() && (
        <p className="intro-warn">
          <strong>If playback is silent on iPhone,</strong> check media volume
          and the ring/silent switch. Sound problems? can check the browser&rsquo;s output.
        </p>
      )}

      <p className="intro-note">Headphones recommended.</p>
    </Sheet>
  )
}
