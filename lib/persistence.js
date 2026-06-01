// Song persistence backed by the /api/presets route handlers (Postgres).
//
// Same exported names as the old localStorage module, but the network calls are
// now async — callers must await listSongs/loadSong/saveSong/deleteSong.
//
// The "last loaded song" pointer stays in localStorage on purpose: it's a
// per-device UI hint ("reopen what I had"), not user-owned data, so it doesn't
// belong in the DB.

export const SCHEMA_VERSION = 1

const LAST_KEY = 'transit-daw:lastSongId'

async function _json(res) {
  if (res.status === 401) throw new AuthRequiredError()
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`[persistence] ${res.status} ${detail}`)
  }
  return res.json()
}

export class AuthRequiredError extends Error {
  constructor() { super('auth required'); this.name = 'AuthRequiredError' }
}

// ── Songs (server) ────────────────────────────────────────────────────────────

export async function listSongs() {
  try {
    const rows = await _json(await fetch('/api/presets', { credentials: 'include' }))
    return Array.isArray(rows)
      ? [...rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      : []
  } catch (e) {
    if (e instanceof AuthRequiredError) return []
    console.warn('[persistence] listSongs failed', e)
    return []
  }
}

export async function loadSong(id) {
  if (!id) return null
  try {
    const res = await fetch(`/api/presets/${encodeURIComponent(id)}`, { credentials: 'include' })
    if (res.status === 404) return null
    return await _json(res)
  } catch (e) {
    if (e instanceof AuthRequiredError) return null
    console.warn('[persistence] loadSong failed', e)
    return null
  }
}

// Upsert: PUT /api/presets/:id handles both new and existing songs.
export async function saveSong(song) {
  if (!song?.id) throw new Error('saveSong: missing id')
  const res = await fetch(`/api/presets/${encodeURIComponent(song.id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: song.name,
      schemaVersion: SCHEMA_VERSION,
      state: song.state,
    }),
  })
  return _json(res)
}

export async function deleteSong(id) {
  if (!id) return
  try {
    await fetch(`/api/presets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch (e) {
    console.warn('[persistence] deleteSong failed', e)
  }
  if (getLastSongId() === id) clearLastSongId()
}

// ── Sharing ──────────────────────────────────────────────────────────────────

// Enable a public share link (idempotent) → returns shareId.
export async function shareSong(id) {
  if (!id) throw new Error('shareSong: missing id')
  const res = await fetch(`/api/presets/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    credentials: 'include',
  })
  const { shareId } = await _json(res)
  return shareId
}

export async function unshareSong(id) {
  if (!id) return
  try {
    await fetch(`/api/presets/${encodeURIComponent(id)}/share`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch (e) {
    console.warn('[persistence] unshareSong failed', e)
  }
}

// Public read of a shared preset → { name, state } or null. No auth required.
export async function loadShared(shareId) {
  if (!shareId) return null
  try {
    const res = await fetch(`/api/shared/${encodeURIComponent(shareId)}`)
    if (res.status === 404) return null
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.warn('[persistence] loadShared failed', e)
    return null
  }
}

// Build the shareable URL for a token.
export function shareUrl(shareId) {
  if (!shareId) return ''
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/?shared=${encodeURIComponent(shareId)}`
}

// ── Last-loaded pointer (per-device, localStorage) ───────────────────────────

export function getLastSongId() {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

export function setLastSongId(id) {
  if (!id) { clearLastSongId(); return }
  try { localStorage.setItem(LAST_KEY, String(id)) } catch {}
}

export function clearLastSongId() {
  try { localStorage.removeItem(LAST_KEY) } catch {}
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function newSongId() {
  return `song_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}
