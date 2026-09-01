'use client'

import { useEffect, useState } from 'react'
import './UpgradeModal.css'

const REASON_COPY = {
  lane_limit: ['Six lines are playing', 'Free sessions can run six instrument lanes at once. Keep this set, or unlock a larger network.'],
  composition_limit: ['Your chain is full', 'Free songs can chain three presets. Pro removes the ceiling so the arrangement can keep moving.'],
  export_limit: ['The last sample export is gone', 'Pro unlocks unlimited MIDI and real-time WAV capture across every instrument.'],
  ai_limit: ['AI Composer allowance reached', 'Pro includes 50 new composition prompts every month.'],
  sign_in: ['Save your free credits', 'Sign in to claim three MIDI/WAV exports and three AI compositions.'],
  billing_error: ['Billing connection interrupted', 'The music is safe. Try checkout again, or return later if Lemon Squeezy is unavailable.'],
  upgrade: ['Take the full network', 'Build wider arrangements, export every idea, and keep AI Composer in the session.'],
}

// Prices are charged in EUR — the Lemon Squeezy store currency. Keep these in sync
// with the LEMONSQUEEZY_VARIANT_ID_* variants; nothing derives them at runtime.
const PRICES = {
  monthly: '€5.99',
  annual: '€49',
}

export default function UpgradeModal({ reason, signedIn, busy, onClose, onCheckout, onSignIn }) {
  const [period, setPeriod] = useState('annual')
  const [title, body] = REASON_COPY[reason] ?? REASON_COPY.upgrade

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="upgrade-overlay" onPointerDown={onClose} role="presentation">
      <section className="upgrade-panel" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onPointerDown={event => event.stopPropagation()}>
        <div className="upgrade-signal" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        <button className="upgrade-close" onClick={onClose} aria-label="Close">×</button>
        <p className="upgrade-kicker">Leið Pro · full signal</p>
        <h2 id="upgrade-title">{title}</h2>
        <p className="upgrade-copy">{body}</p>

        <ul className="upgrade-features">
          <li><strong>∞</strong><span>active instrument lanes</span></li>
          <li><strong>∞</strong><span>presets in every Song chain</span></li>
          <li><strong>↓</strong><span>unlimited MIDI + WAV exports</span></li>
          <li><strong>50</strong><span>AI compositions each month</span></li>
        </ul>

        {signedIn ? (
          <>
            <div className="upgrade-period" aria-label="Billing period">
              <button className={period === 'monthly' ? 'active' : ''} onClick={() => setPeriod('monthly')}>
                Monthly <span>{PRICES.monthly}</span>
              </button>
              <button className={period === 'annual' ? 'active' : ''} onClick={() => setPeriod('annual')}>
                Annual <span>{PRICES.annual} · save 32%</span>
              </button>
            </div>
            <button className="upgrade-cta" disabled={busy} onClick={() => onCheckout(period)}>
              {busy ? 'Connecting…' : `Start Pro · ${period === 'annual' ? `${PRICES.annual}/year` : `${PRICES.monthly}/month`}`}
            </button>
            <p className="upgrade-footnote">Secure checkout and tax handling by Lemon Squeezy. Cancel any time.</p>
          </>
        ) : (
          <button className="upgrade-cta" onClick={onSignIn}>Sign in to continue</button>
        )}
      </section>
    </div>
  )
}
