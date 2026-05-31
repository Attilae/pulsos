'use client'

// Slice-1 verification page: exercises auth (email+password, magic link) and the
// /api/presets CRUD. This is a temporary harness — slice 2 replaces it with the
// real DAW shell ported from src/App.jsx.

import { useEffect, useState } from 'react'
import { authClient, useSession, signOut } from '@/lib/auth-client.js'
import { listSongs, saveSong, deleteSong, newSongId } from '@/lib/persistence.js'

export default function Page() {
  const { data: session, isPending } = useSession()

  if (isPending) return <Shell><p>Loading…</p></Shell>
  if (!session) return <Shell><AuthPanel /></Shell>

  return (
    <Shell>
      <p>
        Signed in as <strong>{session.user.email}</strong>{' '}
        <button onClick={() => signOut()}>Sign out</button>
      </p>
      <PresetsPanel />
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <main style={{ maxWidth: 560, margin: '4rem auto', fontFamily: 'system-ui', padding: '0 1rem' }}>
      <h1>Transit DAW — slice 1</h1>
      {children}
    </main>
  )
}

function AuthPanel() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')

  const signUp = async () => {
    setMsg('…')
    const { error } = await authClient.signUp.email({ email, password, name: name || email })
    setMsg(error ? `signup error: ${error.message}` : 'signed up')
  }
  const signInPw = async () => {
    setMsg('…')
    const { error } = await authClient.signIn.email({ email, password })
    setMsg(error ? `signin error: ${error.message}` : 'signed in')
  }
  const magic = async () => {
    setMsg('…')
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/' })
    setMsg(error ? `magic error: ${error.message}` : 'magic link sent — check email (or server console in dev)')
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <input placeholder="name (signup)" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={signUp}>Sign up</button>
        <button onClick={signInPw}>Sign in</button>
        <button onClick={magic}>Magic link</button>
      </div>
      {msg && <p style={{ color: '#666' }}>{msg}</p>}
    </div>
  )
}

function PresetsPanel() {
  const [songs, setSongs] = useState([])
  const refresh = async () => setSongs(await listSongs())
  useEffect(() => { refresh() }, [])

  const addDummy = async () => {
    await saveSong({
      id: newSongId(),
      name: `Test ${new Date().toLocaleTimeString()}`,
      state: { schemaVersion: 1, bpm: 120, demo: true },
    })
    refresh()
  }
  const remove = async (id) => { await deleteSong(id); refresh() }

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Presets <button onClick={addDummy}>+ add test</button></h2>
      {songs.length === 0 && <p>No presets yet.</p>}
      <ul>
        {songs.map((s) => (
          <li key={s.id}>
            {s.name}{' '}
            <small style={{ color: '#999' }}>{new Date(s.updatedAt).toLocaleString()}</small>{' '}
            <button onClick={() => remove(s.id)}>delete</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
