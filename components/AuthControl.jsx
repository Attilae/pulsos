// The sign-in / sign-up form, rendered inside the HeaderMenu drawer.
//
// This file used to also default-export an `AuthControl` header popover. That
// was superseded by HeaderMenu and had no importers left, so it was removed
// along with its document-level `mousedown` outside-click closer (which never
// worked on touch).
import { useState } from 'react'
import Link from 'next/link'
import { authClient } from '../lib/auth-client.js'

export function AuthForm({ onDone, className = '' }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')

  const run = async (fn, ok) => {
    setMsg('…')
    const { error } = await fn()
    if (error) setMsg(error.message || 'error')
    else { setMsg(ok); if (!ok) onDone() }
  }

  return (
    <div className={`auth-pop auth-form ${className}`}>
      <div className="auth-tabs">
        <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
        <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Sign up</button>
      </div>
      {mode === 'signup' && (
        <input placeholder="name" value={name} onChange={e => setName(e.target.value)} />
      )}
      <input placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
      {mode === 'signin' ? (
        <button className="auth-btn" onClick={() => run(() => authClient.signIn.email({ email, password }), '')}>
          Sign in
        </button>
      ) : (
        <>
          <button className="auth-btn" onClick={() => run(() => authClient.signUp.email({ email, password, name: name || email }), '')}>
            Create account
          </button>
          <p className="auth-legal">
            By creating an account, you agree to the <Link href="/terms">Terms</Link> and
            acknowledge the <Link href="/privacy">Privacy Notice</Link>. Users under 16 need a
            parent or guardian’s authorization.
          </p>
        </>
      )}
      <button
        className="auth-btn auth-btn--ghost"
        onClick={() => run(() => authClient.signIn.magicLink({ email, callbackURL: '/' }), 'Magic link sent — check your email.')}
      >
        Email me a magic link
      </button>
      {msg && <p className="auth-msg">{msg}</p>}
    </div>
  )
}
