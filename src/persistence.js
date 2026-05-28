// Thin localStorage wrapper for Transit DAW songs.
// Pure functions — no React. All values are JSON-stringified.
//
// Layout:
//   'transit-daw:songIndex' → [{ id, name, updatedAt }, …]
//   'transit-daw:song:<id>' → full song object { schemaVersion, id, name, createdAt, updatedAt, state }
//   'transit-daw:lastSongId' → string | null

export const SCHEMA_VERSION = 1

const INDEX_KEY = 'transit-daw:songIndex'
const LAST_KEY  = 'transit-daw:lastSongId'
const songKey   = (id) => `transit-daw:song:${id}`

function _read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch (e) {
    console.warn(`[persistence] read failed for ${key}`, e)
    return fallback
  }
}

function _write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.warn(`[persistence] write failed for ${key}`, e)
    return false
  }
}

function _delete(key) {
  try { localStorage.removeItem(key) } catch {}
}

// ── Index ───────────────────────────────────────────────────────────────────

export function listSongs() {
  const idx = _read(INDEX_KEY, [])
  if (!Array.isArray(idx)) return []
  return [...idx].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

function _updateIndex(meta) {
  const idx = _read(INDEX_KEY, [])
  const arr = Array.isArray(idx) ? idx.filter(s => s.id !== meta.id) : []
  arr.push({ id: meta.id, name: meta.name, updatedAt: meta.updatedAt })
  _write(INDEX_KEY, arr)
}

function _removeFromIndex(id) {
  const idx = _read(INDEX_KEY, [])
  if (!Array.isArray(idx)) return
  _write(INDEX_KEY, idx.filter(s => s.id !== id))
}

// ── Songs ───────────────────────────────────────────────────────────────────

export function loadSong(id) {
  if (!id) return null
  return _read(songKey(id), null)
}

export function saveSong(song) {
  if (!song?.id) throw new Error('saveSong: missing id')
  const now = Date.now()
  const out = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: song.createdAt ?? now,
    ...song,
    updatedAt: now,
  }
  _write(songKey(out.id), out)
  _updateIndex({ id: out.id, name: out.name, updatedAt: out.updatedAt })
  return out
}

export function deleteSong(id) {
  if (!id) return
  _delete(songKey(id))
  _removeFromIndex(id)
  if (getLastSongId() === id) clearLastSongId()
}

// ── Last-loaded pointer ─────────────────────────────────────────────────────

export function getLastSongId() {
  try { return localStorage.getItem(LAST_KEY) } catch { return null }
}

export function setLastSongId(id) {
  if (!id) { clearLastSongId(); return }
  try { localStorage.setItem(LAST_KEY, String(id)) } catch {}
}

export function clearLastSongId() {
  _delete(LAST_KEY)
}

// ── Utilities ───────────────────────────────────────────────────────────────

export function newSongId() {
  return `song_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}
