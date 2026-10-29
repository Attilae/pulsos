// The sign-in / sign-up form, rendered inside the HeaderMenu drawer.
//
// This file used to also default-export an `AuthControl` header popover. That
// was superseded by HeaderMenu and had no importers left, so it was removed
// along with its document-level `mousedown` outside-click closer (which never
// worked on touch).
//
// Feedback has three places, so a message always sits next to what it is
// about: a field's problem renders under that field, a failed request renders
// as a notice above the buttons, and every "we emailed you" outcome swaps the
// form for an inbox panel naming the address, with a resend. Password accounts
// can't sign in until the address is confirmed (lib/auth.js), so an
// unconfirmed sign-in lands on that panel too.
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { authClient } from '../lib/auth-client.js'
import { MIN_PASSWORD_LENGTH, authFieldErrors, describeAuthError } from '../lib/authFormValidation.js'
import { IconCheck, IconError, IconMail } from './icons.jsx'
import './AuthForm.css'

// Better Auth's defaults: emailVerification.expiresIn and magicLink's expiresIn.
const LINK_LIFETIME = { verify: 'an hour', magic: '5 minutes' }
const RESEND_COOLDOWN_MS = 30_000

const BUSY_LABEL = { signin: 'Signing in…', signup: 'Creating account…', magic: 'Sending link…' }

export function AuthForm({ onDone, className = '', callbackURL = '/' }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [fieldErrors, setFieldErrors] = useState({}) // { email?, password? }
  const [notice, setNotice] = useState(null) // { title, message }
  const [busy, setBusy] = useState(null) // the action in flight
  // { kind: 'verify' | 'magic', email, reason: 'signup' | 'signin' | 'magic' }
  const [inbox, setInbox] = useState(null)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)

  const switchMode = (next) => {
    setMode(next)
    setFieldErrors({})
    setNotice(null)
  }

  const showFieldError = (errors) => {
    setFieldErrors(errors)
    if (errors.email) emailRef.current?.focus()
    else if (errors.password) passwordRef.current?.focus()
  }

  const request = (action, addr) => {
    if (action === 'signin') return authClient.signIn.email({ email: addr, password, callbackURL })
    if (action === 'signup') return authClient.signUp.email({ email: addr, password, name: name.trim() || addr, callbackURL })
    return authClient.signIn.magicLink({ email: addr, callbackURL })
  }

  const submit = async (action) => {
    if (busy) return
    setNotice(null)
    const errors = authFieldErrors(action, { email, password })
    showFieldError(errors)
    if (errors.email || errors.password) return

    const addr = email.trim()
    setBusy(action)
    let error
    try {
      ({ error } = await request(action, addr))
    } catch {
      error = {} // no response at all: describeAuthError reads it as offline
    }
    setBusy(null)

    if (!error) {
      if (action === 'signin') { onDone(); return }
      setInbox({ kind: action === 'magic' ? 'magic' : 'verify', email: addr, reason: action })
      return
    }
    // Better Auth has already mailed a fresh confirmation link (sendOnSignIn).
    if (error.code === 'EMAIL_NOT_VERIFIED') {
      setInbox({ kind: 'verify', email: addr, reason: 'signin' })
      return
    }
    const described = describeAuthError(error)
    if (described.field) showFieldError({ [described.field]: described.message })
    else setNotice(described)
  }

  if (inbox) {
    return (
      <div className={`auth-pop auth-form ${className}`}>
        <InboxPanel
          inbox={inbox}
          callbackURL={callbackURL}
          onBack={() => { setInbox(null); setPassword(''); setTimeout(() => emailRef.current?.focus(), 0) }}
        />
      </div>
    )
  }

  const primary = mode === 'signin' ? 'signin' : 'signup'

  return (
    <form
      className={`auth-pop auth-form ${className}`}
      noValidate
      aria-busy={busy ? 'true' : undefined}
      onSubmit={(e) => { e.preventDefault(); submit(primary) }}
    >
      <div className="auth-tabs">
        <button type="button" className={mode === 'signin' ? 'active' : ''} aria-pressed={mode === 'signin'} onClick={() => switchMode('signin')}>Sign in</button>
        <button type="button" className={mode === 'signup' ? 'active' : ''} aria-pressed={mode === 'signup'} onClick={() => switchMode('signup')}>Sign up</button>
      </div>

      {mode === 'signup' && (
        <AuthField label="Name" optional>
          {(props) => <input {...props} autoComplete="name" value={name} onChange={e => setName(e.target.value)} />}
        </AuthField>
      )}
      <AuthField label="Email" error={fieldErrors.email}>
        {(props) => (
          <input
            {...props}
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setFieldErrors(f => ({ ...f, email: undefined })); setNotice(null) }}
          />
        )}
      </AuthField>
      <AuthField
        label="Password"
        error={fieldErrors.password}
        hint={mode === 'signup' ? `At least ${MIN_PASSWORD_LENGTH} characters.` : null}
      >
        {(props) => (
          <input
            {...props}
            ref={passwordRef}
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={e => { setPassword(e.target.value); setFieldErrors(f => ({ ...f, password: undefined })); setNotice(null) }}
          />
        )}
      </AuthField>

      {notice && (
        <div className="auth-notice auth-notice--error" role="alert">
          <IconError className="auth-notice-icon" />
          <div>
            <strong>{notice.title}</strong>
            <span>{notice.message}</span>
          </div>
        </div>
      )}

      <button type="submit" className="auth-btn" disabled={!!busy}>
        {busy === primary ? BUSY_LABEL[primary] : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
      {mode === 'signup' && (
        <p className="auth-legal">
          By creating an account, you agree to the <Link href="/terms">Terms</Link> and
          acknowledge the <Link href="/privacy">Privacy Notice</Link>. You must be at least 13;
          users under 16 need a parent or guardian’s authorization.
        </p>
      )}
      <div className="auth-or" aria-hidden="true"><span>or</span></div>
      <button type="button" className="auth-btn auth-btn--ghost" disabled={!!busy} onClick={() => submit('magic')}>
        {busy === 'magic' ? BUSY_LABEL.magic : 'Email me a magic link'}
      </button>
    </form>
  )
}

// A labelled input with its hint or error underneath, wired up with
// aria-invalid / aria-describedby. The input itself comes from a render prop so
// the caller keeps its own ref and handlers.
function AuthField({ label, optional = false, error, hint, children }) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error || hint
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>
        {label}{optional && <span className="auth-label-optional"> (optional)</span>}
      </label>
      {children({
        id,
        'aria-invalid': error ? 'true' : undefined,
        'aria-describedby': note ? noteId : undefined,
      })}
      {error ? (
        <p id={noteId} className="auth-field-error"><IconError />{error}</p>
      ) : hint ? (
        <p id={noteId} className="auth-field-hint">{hint}</p>
      ) : null}
    </div>
  )
}

function InboxPanel({ inbox, callbackURL, onBack }) {
  const [resend, setResend] = useState('idle') // 'idle' | 'sending' | 'sent' | 'error'
  const headingRef = useRef(null)

  // Focus moves with the view so a screen reader hears the outcome and the
  // keyboard isn't left on a button that no longer exists.
  useEffect(() => { headingRef.current?.focus() }, [])

  // One resend per cooldown: the mail provider and Better Auth's rate limiter
  // would refuse a burst anyway, and the button saying so is clearer.
  useEffect(() => {
    if (resend !== 'sent') return undefined
    const t = setTimeout(() => setResend('idle'), RESEND_COOLDOWN_MS)
    return () => clearTimeout(t)
  }, [resend])

  const sendAgain = async () => {
    setResend('sending')
    try {
      const { error } = inbox.kind === 'magic'
        ? await authClient.signIn.magicLink({ email: inbox.email, callbackURL })
        : await authClient.sendVerificationEmail({ email: inbox.email, callbackURL })
      setResend(error ? 'error' : 'sent')
    } catch {
      setResend('error')
    }
  }

  const title = inbox.reason === 'signin' ? 'Confirm your email first' : 'Check your inbox'
  const lead = {
    signup: 'We sent a confirmation link to',
    signin: 'Your account isn’t confirmed yet, so we sent a new confirmation link to',
    magic: 'We sent a sign-in link to',
  }[inbox.reason]
  const then = inbox.kind === 'magic'
    ? 'Open it on this device to sign in.'
    : 'Open it to confirm your address. The link signs you in.'

  return (
    <div className="auth-inbox">
      <IconMail className="auth-inbox-icon" />
      <h3 className="auth-inbox-title" tabIndex={-1} ref={headingRef}>{title}</h3>
      <p className="auth-inbox-body" role="status">
        {lead} <strong className="auth-inbox-email">{inbox.email}</strong>. {then}
      </p>
      <p className="auth-inbox-hint">
        It expires in {LINK_LIFETIME[inbox.kind]}. Nothing there after a minute? Check your spam folder, or send it again.
      </p>
      <button
        type="button"
        className="auth-btn"
        disabled={resend === 'sending' || resend === 'sent'}
        onClick={sendAgain}
      >
        {resend === 'sending' ? 'Sending…' : 'Send the link again'}
      </button>
      {resend === 'sent' && (
        <p className="auth-field-ok" role="status"><IconCheck />Sent. It can take a minute to arrive.</p>
      )}
      {resend === 'error' && (
        <p className="auth-field-error" role="alert"><IconError />Couldn’t send it. Wait a minute and try again.</p>
      )}
      <button type="button" className="auth-btn auth-btn--ghost" onClick={onBack}>
        {inbox.reason === 'signup' ? 'Use a different email' : 'Back to sign in'}
      </button>
    </div>
  )
}
