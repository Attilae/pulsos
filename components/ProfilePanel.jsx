// Full-screen account/profile overlay, launched from AuthControl.
//
// Three sections:
//   - Account   → display name (authClient.updateUser) + read-only email/joined
//   - Presets   → the signed-in user's saved songs (open / share / delete),
//                 fetched directly via lib/persistence.js so it stays decoupled
//                 from MixerTab's useSongPersistence hook
//   - Security  → change password (authClient.changePassword)
//
// "Open" sets the per-device last-song pointer and reloads into the Map tab,
// which hydrates from that pointer — avoids threading MixerTab state up here.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { authClient, useSession } from '../lib/auth-client.js'
import {
  listSongs, deleteSong as deleteSongRaw,
  shareSong, unshareSong, shareUrl, setLastSongId,
} from '../lib/persistence.js'
import { confirmDialog } from './Dialog.jsx'
import './ProfilePanel.css'

export default function ProfilePanel({ onClose }) {
  const { data: session } = useSession()
  const user = session?.user

  // Close on Esc
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!user) return null

  return (
    <div className="profile-overlay" onMouseDown={onClose}>
      <div className="profile-panel" onMouseDown={e => e.stopPropagation()}>
        <header className="profile-header">
          <h2>Profile</h2>
          <button className="profile-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="profile-scroll">
          <AccountSection user={user} />
          <PresetsSection />
          <SecuritySection />
        </div>
      </div>
    </div>
  )
}

// ── Account ──────────────────────────────────────────────────────────────────

function AccountSection({ user }) {
  const [name, setName] = useState(user.name ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState('')

  const dirty = name.trim() !== (user.name ?? '') && name.trim().length > 0

  const save = async () => {
    if (!dirty) return
    setBusy(true); setMsg('')
    const { error } = await authClient.updateUser({ name: name.trim() })
    setBusy(false)
    setMsg(error ? (error.message || 'Could not update name.') : 'Saved.')
  }

  return (
    <section className="profile-section">
      <h3>Account</h3>
      <div className="profile-field">
        <label>Display name</label>
        <div className="profile-inline">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
          />
          <button className="profile-btn" disabled={!dirty || busy} onClick={save}>
            {busy ? '…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="profile-field">
        <label>Email</label>
        <div className="profile-readonly">{user.email}</div>
      </div>
      <div className="profile-field">
        <label>Member since</label>
        <div className="profile-readonly">{formatDate(user.createdAt)}</div>
      </div>
      {msg && <p className="profile-msg">{msg}</p>}
    </section>
  )
}

// ── Presets ──────────────────────────────────────────────────────────────────

function PresetsSection() {
  const [songs, setSongs] = useState(null)   // null = loading
  const [copied, setCopied] = useState(null)

  const refresh = useCallback(async () => {
    setSongs(await listSongs())
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleOpen = (id) => {
    setLastSongId(id)
    // MixerTab (default Map tab) hydrates from lastSongId on load.
    window.location.href = '/'
  }

  const handleDelete = async (id, name) => {
    if (!(await confirmDialog(`Delete "${name}"? This cannot be undone.`, {
      title: 'Delete preset', confirmLabel: 'Delete', danger: true,
    }))) return
    await deleteSongRaw(id)
    refresh()
  }

  const handleShare = async (id) => {
    try {
      const shareId = await shareSong(id)
      await copy(shareUrl(shareId), id)
      refresh()
    } catch { /* ignore */ }
  }

  const handleUnshare = async (id) => {
    await unshareSong(id)
    refresh()
  }

  const copy = async (url, id) => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(id)
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1800)
    } catch { /* clipboard blocked */ }
  }

  return (
    <section className="profile-section">
      <h3>
        Your presets
        {Array.isArray(songs) && <span className="profile-count">{songs.length}</span>}
      </h3>

      {songs === null && <p className="profile-empty">Loading…</p>}
      {Array.isArray(songs) && songs.length === 0 && (
        <p className="profile-empty">No saved presets yet. Save a song from the Map tab to see it here.</p>
      )}

      {Array.isArray(songs) && songs.length > 0 && (
        <ul className="preset-list">
          {songs.map(s => (
            <li key={s.id} className="preset-row">
              <div className="preset-info">
                <span className="preset-name">{s.name}</span>
                <span className="preset-meta">
                  {formatRelative(s.updatedAt)}
                  {s.shareId && <span className="preset-badge">shared</span>}
                </span>
              </div>
              <div className="preset-actions">
                <button className="preset-action" onClick={() => handleOpen(s.id)}>Open</button>
                {s.shareId ? (
                  <>
                    <button className="preset-action" onClick={() => copy(shareUrl(s.shareId), s.id)}>
                      {copied === s.id ? 'Copied!' : 'Copy link'}
                    </button>
                    <button className="preset-action" onClick={() => handleUnshare(s.id)}>Unshare</button>
                  </>
                ) : (
                  <button className="preset-action" onClick={() => handleShare(s.id)}>
                    {copied === s.id ? 'Copied!' : 'Share'}
                  </button>
                )}
                <button
                  className="preset-action preset-action--danger"
                  onClick={() => handleDelete(s.id, s.name)}
                  title="Delete"
                >Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Security ─────────────────────────────────────────────────────────────────

function SecuritySection() {
  const [current, setCurrent] = useState('')
  const [next, setNext]       = useState('')
  const [confirm, setConfirm] = useState('')
  const [revokeOthers, setRevokeOthers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState('')
  const [err, setErr]   = useState(false)

  const submit = async () => {
    setMsg(''); setErr(false)
    if (next.length < 8) { setErr(true); setMsg('New password must be at least 8 characters.'); return }
    if (next !== confirm) { setErr(true); setMsg('New passwords do not match.'); return }

    setBusy(true)
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: revokeOthers,
    })
    setBusy(false)
    if (error) {
      setErr(true)
      setMsg(error.message || 'Could not change password. If you signed up with a magic link, set a password by signing out and back in.')
      return
    }
    setErr(false)
    setMsg('Password updated.')
    setCurrent(''); setNext(''); setConfirm('')
  }

  return (
    <section className="profile-section">
      <h3>Change password</h3>
      <div className="profile-field">
        <label>Current password</label>
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div className="profile-field">
        <label>New password</label>
        <input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
      </div>
      <div className="profile-field">
        <label>Confirm new password</label>
        <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
      </div>
      <label className="profile-checkbox">
        <input type="checkbox" checked={revokeOthers} onChange={e => setRevokeOthers(e.target.checked)} />
        Sign out other devices
      </label>
      <button className="profile-btn" disabled={busy || !current || !next} onClick={submit}>
        {busy ? '…' : 'Update password'}
      </button>
      {msg && <p className={`profile-msg ${err ? 'profile-msg--err' : ''}`}>{msg}</p>}
    </section>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d) {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatRelative(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
