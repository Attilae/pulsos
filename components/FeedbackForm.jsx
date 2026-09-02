'use client'

// The feedback / bug-report form behind /feedback.
//
// Open to signed-out visitors on purpose — the people most likely to hit a bug
// worth hearing about are the ones who never got as far as an account. The
// email prefills from the session when there is one.
//
// Follows SecuritySection's shape in ProfilePanel.jsx (separate busy/msg/err
// state, validate before submit) rather than AuthForm's looser one, and styles
// from the --legal-* tokens LegalShell sets so it reads as part of that page.

import { useEffect, useMemo, useRef, useState } from 'react'
import Turnstile, { turnstileEnabled } from './Turnstile.jsx'
import { useSession } from '@/lib/auth-client.js'
import { MESSAGE_MIN, MESSAGE_MAX, TURNSTILE_ACTION } from '@/lib/feedback.js'
import './FeedbackForm.css'

const KINDS = [
  { id: 'bug', label: 'Bug', hint: 'Something is broken or sounds wrong' },
  { id: 'idea', label: 'Idea', hint: 'A feature or change you want' },
  { id: 'other', label: 'Something else', hint: 'Anything not covered above' },
]

export default function FeedbackForm() {
  const { data: session } = useSession()
  const [kind, setKind] = useState('bug')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot — real people never see it
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState(false)
  const [sent, setSent] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [context, setContext] = useState(null)
  const turnstileRef = useRef(null)

  const sessionEmail = session?.user?.email
  useEffect(() => {
    // Only prefills an untouched field, so it can't overwrite what someone typed
    // while the session request was still in flight.
    if (sessionEmail) setEmail(prev => (prev ? prev : sessionEmail))
  }, [sessionEmail])

  // Diagnostics are collected in an effect, not during render — window and
  // navigator do not exist while Next prerenders this page.
  useEffect(() => {
    // This page renders outside CityProvider, so read the id the provider
    // persists rather than useCitySelection(), which would report the default.
    let cityId = ''
    try { cityId = localStorage.getItem('leid.cityId') || '' } catch { /* blocked */ }
    setContext({
      href: window.location.href,
      userAgent: navigator.userAgent,
      cityId,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
    })
  }, [])

  const remaining = MESSAGE_MAX - message.length
  // Deliberately not gated on a captcha token. In invisible mode there is
  // nothing on screen to explain a disabled button, so the challenge runs
  // during submit instead — see the getToken() call below.
  const canSubmit = useMemo(
    () => !busy && email.trim() && message.trim().length >= MESSAGE_MIN,
    [busy, email, message],
  )

  const submit = async (event) => {
    event.preventDefault()
    setMsg(''); setErr(false)

    if (!email.trim()) { setErr(true); setMsg('We need an email address to reply to.'); return }
    if (message.trim().length < MESSAGE_MIN) {
      setErr(true); setMsg(`Please write at least ${MESSAGE_MIN} characters.`); return
    }
    setBusy(true)

    // Runs the challenge now, so the token is always fresh and single-use
    // handling lives inside the widget rather than in this component's state.
    let captchaToken = ''
    try {
      captchaToken = (await turnstileRef.current?.getToken()) ?? ''
    } catch (err) {
      setBusy(false); setErr(true)
      setMsg(err?.message === 'timeout'
        ? 'The bot check timed out. Please try again.'
        : 'The bot check could not be completed. Please try again.')
      return
    }

    let res, data
    try {
      res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, email, message, website, context, captchaToken }),
      })
      data = await res.json().catch(() => ({}))
    } catch {
      setBusy(false); setErr(true)
      setMsg('Could not reach the server. Check your connection and try again.')
      return
    }
    setBusy(false)

    if (!res.ok) {
      setErr(true)
      setMsg(data?.error ? capitalize(data.error) : 'Something went wrong. Please try again.')
      return
    }

    setSent(true)
    setMessage('')
  }

  if (sent) {
    return (
      <div className="feedback-done" role="status">
        <h2>Thanks — that reached us.</h2>
        <p>
          We sent a copy to <strong>{email}</strong>. If we need more detail to reproduce it,
          we&rsquo;ll reply to that address.
        </p>
        <button type="button" className="feedback-btn feedback-btn--ghost" onClick={() => { setSent(false); setMsg('') }}>
          Send another
        </button>
      </div>
    )
  }

  return (
    <form className="feedback-form" onSubmit={submit} noValidate>
      <fieldset className="feedback-kinds">
        <legend>What kind of message is this?</legend>
        <div className="feedback-kind-row">
          {KINDS.map(option => (
            <label
              key={option.id}
              className={`feedback-kind ${kind === option.id ? 'feedback-kind--on' : ''}`}
            >
              <input
                type="radio"
                name="kind"
                value={option.id}
                checked={kind === option.id}
                onChange={() => setKind(option.id)}
              />
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="feedback-field">
        <label htmlFor="feedback-email">Your email</label>
        <input
          id="feedback-email"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
        <small>So we can reply and tell you when it&rsquo;s fixed.</small>
      </div>

      <div className="feedback-field">
        <label htmlFor="feedback-message">
          {kind === 'bug' ? 'What happened?' : 'What’s on your mind?'}
        </label>
        <textarea
          id="feedback-message"
          rows={8}
          value={message}
          maxLength={MESSAGE_MAX}
          onChange={e => setMessage(e.target.value)}
          placeholder={kind === 'bug'
            ? 'What you did, what you expected, and what happened instead. Which city and which lines, if it matters.'
            : 'Tell us as much or as little as you like.'}
          required
        />
        <small className={remaining < 200 ? 'feedback-count--low' : undefined}>
          {message.length < MESSAGE_MIN
            ? `At least ${MESSAGE_MIN} characters.`
            : `${remaining} characters left.`}
        </small>
      </div>

      {/* Honeypot. Hidden from people and from screen readers; bots fill it in. */}
      <div className="feedback-hp" aria-hidden="true">
        <label htmlFor="feedback-website">Website</label>
        <input
          id="feedback-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={e => setWebsite(e.target.value)}
        />
      </div>

      {context && (
        <div className="feedback-context">
          <button type="button" onClick={() => setShowContext(v => !v)} aria-expanded={showContext}>
            <span aria-hidden="true">{showContext ? '▾' : '▸'}</span> What we attach to this
          </button>
          {showContext && (
            <dl>
              <div><dt>Page</dt><dd>{context.href}</dd></div>
              <div><dt>Browser</dt><dd>{context.userAgent}</dd></div>
              <div><dt>City</dt><dd>{context.cityId || '—'}</dd></div>
              <div><dt>Window</dt><dd>{context.viewport}</dd></div>
            </dl>
          )}
        </div>
      )}

      {/* Invisible Turnstile draws nothing, so it takes the Cloudflare notice
          with it — the visible badge is what normally carries these links. */}
      <div className="feedback-captcha-zone">
        <Turnstile ref={turnstileRef} className="feedback-captcha" action={TURNSTILE_ACTION} />
        {turnstileEnabled() && (
          <p className="feedback-captcha-note">
            Protected by Cloudflare Turnstile.{' '}
            <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Privacy</a>
            {' · '}
            <a href="https://www.cloudflare.com/website-terms/" target="_blank" rel="noreferrer">Terms</a>
          </p>
        )}
      </div>

      <div className="feedback-actions">
        <button type="submit" className="feedback-btn" disabled={!canSubmit}>
          {busy ? 'Checking…' : 'Send'}
        </button>
        {msg && <p className={`feedback-msg ${err ? 'feedback-msg--err' : ''}`} role="alert">{msg}</p>}
      </div>
    </form>
  )
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
