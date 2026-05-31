// Owns the song save/load/autosave lifecycle for the Mixer tab.
//
// Now DB-backed (via lib/persistence.js → /api/presets) and async:
//   - Hydrate from lastSongId once routes + a signed-in session are ready
//   - Debounced autosave (800 ms) once hydrated and signed in
//   - save / saveAs / open / newSong / deleteSong / listSongs (all async)
//   - Track currentSong metadata + dirty flag
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listSongs as listSongsRaw,
  loadSong, saveSong, deleteSong as deleteSongRaw,
  getLastSongId, setLastSongId, clearLastSongId,
  newSongId,
} from './persistence.js'
import { buildSnapshot, applySnapshot } from './songState.js'
import { useSession } from './auth-client.js'

const AUTOSAVE_DEBOUNCE_MS = 800
const AUTOSAVE_TOGGLE_KEY  = 'transit-daw:autosaveEnabled'

function _readAutosavePref() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_TOGGLE_KEY)
    if (raw == null) return true
    return raw === '1' || raw === 'true'
  } catch { return true }
}

function _writeAutosavePref(v) {
  try { localStorage.setItem(AUTOSAVE_TOGGLE_KEY, v ? '1' : '0') } catch {}
}

const _meta = (song) => ({
  id: song.id, name: song.name, createdAt: song.createdAt, updatedAt: song.updatedAt,
})

export function useSongPersistence({ state, setters, engineRef, routes }) {
  const { data: session } = useSession()
  const userId = session?.user?.id ?? null

  const [currentSong, setCurrentSong]  = useState(null)
  const [dirty, setDirty]              = useState(false)
  const [autosaveOn, setAutosaveOnRaw] = useState(_readAutosavePref)
  const [songs, setSongs]              = useState([])

  // Hydration guard — true once the initial load attempt finishes.
  const hydratedRef = useRef(false)

  const setAutosaveOn = useCallback((v) => {
    setAutosaveOnRaw(v)
    _writeAutosavePref(v)
  }, [])

  const refreshSongs = useCallback(async () => {
    setSongs(await listSongsRaw())
  }, [])

  // ── Hydration: load lastSongId once routes + session are ready ────────────
  useEffect(() => {
    if (hydratedRef.current) return
    if (!routes) return        // wait for routes
    if (!userId) return        // wait for sign-in (re-runs when session resolves)

    let cancelled = false
    ;(async () => {
      await refreshSongs()
      const lastId = getLastSongId()
      if (lastId) {
        const song = await loadSong(lastId)
        if (cancelled) return
        if (song) {
          applySnapshot(song, setters, engineRef.current, routes)
          setCurrentSong(_meta(song))
        } else {
          clearLastSongId()
        }
      }
      if (cancelled) return
      hydratedRef.current = true
      setDirty(false)
    })()

    return () => { cancelled = true }
  }, [routes, userId, setters, engineRef, refreshSongs])

  // ── Mark dirty + debounced autosave ───────────────────────────────────────
  const debounceRef = useRef(null)
  // Stable JSON key so the effect only fires on real change.
  const snapshotJson = useMemo(() => {
    try { return JSON.stringify(buildSnapshot(state)) } catch { return '' }
  }, [state])

  useEffect(() => {
    if (!hydratedRef.current) return
    setDirty(true)
    if (!autosaveOn || !currentSong) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const saved = await saveSong({ ...currentSong, state: buildSnapshot(state) })
        setCurrentSong(_meta(saved))
        setLastSongId(saved.id)
        setDirty(false)
        refreshSongs()
      } catch (e) {
        console.warn('[autosave] failed', e)
      }
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotJson, autosaveOn, currentSong?.id])

  // ── Imperative API (async) ─────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!userId) return null          // signed out — header prompts sign-in
    if (!currentSong) return null     // SongMenu prompts saveAs() instead
    const saved = await saveSong({ ...currentSong, state: buildSnapshot(state) })
    setCurrentSong(_meta(saved))
    setLastSongId(saved.id)
    setDirty(false)
    refreshSongs()
    return saved
  }, [state, currentSong, refreshSongs, userId])

  const saveAs = useCallback(async (name) => {
    if (!userId) return null
    const trimmed = (name ?? '').trim() || 'Untitled'
    const saved = await saveSong({
      id: newSongId(), name: trimmed, state: buildSnapshot(state),
    })
    setCurrentSong(_meta(saved))
    setLastSongId(saved.id)
    setDirty(false)
    refreshSongs()
    return saved
  }, [state, refreshSongs, userId])

  const rename = useCallback(async (name) => {
    if (!userId) return null
    if (!currentSong) return null
    const trimmed = (name ?? '').trim() || currentSong.name
    const saved = await saveSong({ ...currentSong, name: trimmed, state: buildSnapshot(state) })
    setCurrentSong(_meta(saved))
    refreshSongs()
    return saved
  }, [state, currentSong, refreshSongs, userId])

  const open = useCallback(async (id) => {
    const song = await loadSong(id)
    if (!song) return null
    applySnapshot(song, setters, engineRef.current, routes)
    setCurrentSong(_meta(song))
    setLastSongId(song.id)
    setDirty(false)
    return song
  }, [setters, engineRef, routes])

  const newSong = useCallback(() => {
    // Detach from current song without resetting state — Save As captures a copy.
    setCurrentSong(null)
    clearLastSongId()
    setDirty(true)
  }, [])

  const deleteSong = useCallback(async (id) => {
    await deleteSongRaw(id)
    if (currentSong?.id === id) setCurrentSong(null)
    refreshSongs()
  }, [currentSong, refreshSongs])

  return {
    currentSong, dirty, autosaveOn, setAutosaveOn, songs,
    save, saveAs, rename, open, newSong, deleteSong, refreshSongs,
    signedIn: !!userId,
  }
}
