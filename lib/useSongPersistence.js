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
  shareSong, unshareSong, loadShared, shareUrl,
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
  id: song.id, name: song.name, shareId: song.shareId ?? null,
  createdAt: song.createdAt, updatedAt: song.updatedAt,
})

// Read + strip the ?shared=<id> query param (so a refresh after editing an
// imported song doesn't re-import it).
function _consumeSharedParam() {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const shareId = url.searchParams.get('shared')
  if (!shareId) return null
  url.searchParams.delete('shared')
  window.history.replaceState({}, '', url.toString())
  return shareId
}

export function useSongPersistence({ state, setters, engineRef, routes, onReset }) {
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

  // ── Hydration ──────────────────────────────────────────────────────────────
  // Priority: a ?shared=<id> link (public, no sign-in needed) → otherwise the
  // signed-in user's lastSongId.
  useEffect(() => {
    if (hydratedRef.current) return
    if (!routes) return        // wait for routes

    let cancelled = false
    ;(async () => {
      const sharedId = _consumeSharedParam()
      if (sharedId) {
        const shared = await loadShared(sharedId)
        if (cancelled) return
        if (shared) {
          applySnapshot(shared, setters, engineRef.current, routes)
          setCurrentSong(null)      // detached/unsaved — Save As to own a copy
        }
        if (userId) await refreshSongs()
        hydratedRef.current = true
        setDirty(!!shared)          // imported = unsaved changes
        return
      }

      if (!userId) return           // no shared link — wait for sign-in
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

  const newSong = useCallback(async () => {
    // Preserve the previous session before clearing, so nothing is lost:
    //   - attached song   → persist any pending edits to it
    //   - unsaved edits    → keep them as a new timestamped session
    // (Signed-out users can't persist — SongMenu warns them first.)
    if (userId) {
      try {
        if (currentSong) {
          await saveSong({ ...currentSong, state: buildSnapshot(state) })
        } else if (dirty) {
          const name = `Session ${new Date().toLocaleString()}`
          await saveSong({ id: newSongId(), name, state: buildSnapshot(state) })
        }
        await refreshSongs()
      } catch (e) {
        console.warn('[newSong] failed to preserve previous session', e)
      }
    }

    // Reset to a clean, empty state and detach (Save As later to keep a copy).
    onReset?.()
    setCurrentSong(null)
    clearLastSongId()
    setDirty(false)
  }, [userId, currentSong, dirty, state, refreshSongs, onReset])

  const deleteSong = useCallback(async (id) => {
    await deleteSongRaw(id)
    if (currentSong?.id === id) setCurrentSong(null)
    refreshSongs()
  }, [currentSong, refreshSongs])

  // Enable a public share link for the current (saved) song → returns the URL.
  const share = useCallback(async () => {
    if (!userId || !currentSong?.id) return null
    const shareId = await shareSong(currentSong.id)
    setCurrentSong(c => (c ? { ...c, shareId } : c))
    refreshSongs()
    return shareUrl(shareId)
  }, [userId, currentSong?.id, refreshSongs])

  const unshare = useCallback(async () => {
    if (!userId || !currentSong?.id) return
    await unshareSong(currentSong.id)
    setCurrentSong(c => (c ? { ...c, shareId: null } : c))
    refreshSongs()
  }, [userId, currentSong?.id, refreshSongs])

  return {
    currentSong, dirty, autosaveOn, setAutosaveOn, songs,
    save, saveAs, rename, open, newSong, deleteSong, refreshSongs,
    share, unshare, shareUrl,
    signedIn: !!userId,
  }
}
