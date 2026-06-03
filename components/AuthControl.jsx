// Compact sign-in / account control for the app header.
// Signed out → a popover with email+password and magic-link.
// Signed in  → shows the email + a sign-out button.
import { useState, useRef, useEffect } from 'react'
import { authClient, useSession, signOut } from '../lib/auth-client.js'
import ProfilePanel from './ProfilePanel.jsx'

export default function AuthControl() {
  const { data: session, isPending } = useSession()
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  if (isPending) return <span className="auth-control auth-control--pending">…</span>

  if (session) {
    const name = session.user.name || session.user.email
    return (
      <div className="auth-control" ref={rootRef}>
        <button className="auth-trigger" onClick={() => setOpen(o => !o)}>
          {name} ▾
        </button>
        {open && (
          <div className="auth-pop">
            <button className="auth-btn auth-btn--ghost" onClick={() => { setProfileOpen(true); setOpen(false) }}>
              Profile
            </button>
            <button className="auth-btn" onClick={() => { signOut(); setOpen(false) }}>
              Sign out
            </button>
          </div>
        )}
        {profileOpen && <ProfilePanel onClose={() => setProfileOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="auth-control" ref={rootRef}>
      <button className="auth-trigger" onClick={() => setOpen(o => !o)}>Sign in</button>
      {open && <AuthForm onDone={() => setOpen(false)} />}
    </div>
  )
}

function AuthForm({ onDone }) {
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
    <div className="auth-pop auth-form">
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
        <button className="auth-btn" onClick={() => run(() => authClient.signUp.email({ email, password, name: name || email }), '')}>
          Create account
        </button>
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
