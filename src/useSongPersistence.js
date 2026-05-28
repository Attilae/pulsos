// Owns the song save/load/autosave lifecycle for the Mixer tab.
//
// Responsibilities:
//   - On first render after routes + engine are ready, hydrate from lastSongId
//   - Debounced autosave (800 ms) on any state change once hydrated
//   - Expose save / saveAs / open / newSong / deleteSong / listSongs
//   - Track `currentSong` metadata + `dirty` flag

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listSongs as listSongsRaw,
  loadSong, saveSong, deleteSong as deleteSongRaw,
  getLastSongId, setLastSongId, clearLastSongId,
  newSongId,
} from './persistence.js'
import { buildSnapshot, applySnapshot } from './songState.js'

const AUTOSAVE_DEBOUNCE_MS = 800

const AUTOSAVE_TOGGLE_KEY = 'transit-daw:autosaveEnabled'

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

export function useSongPersistence({ state, setters, engineRef, routes }) {
  const [currentSong, setCurrentSong] = useState(null) // {id, name, createdAt, updatedAt}
  const [dirty, setDirty]             = useState(false)
  const [autosaveOn, setAutosaveOnRaw] = useState(_readAutosavePref)
  const [songs, setSongs]             = useState(() => listSongsRaw())

  // Hydration guard — true once initial load attempt finishes (regardless of
  // whether a song was found). Until then, no autosave runs.
  const hydratedRef = useRef(false)

  const setAutosaveOn = useCallback((v) => {
    setAutosaveOnRaw(v)
    _writeAutosavePref(v)
  }, [])

  const refreshSongs = useCallback(() => {
    setSongs(listSongsRaw())
  }, [])

  // ── Hydration: load lastSongId once routes are ready ─────────────────────
  useEffect(() => {
    if (hydratedRef.current) return
    if (!routes) return       // wait for routes to be fetched
    const lastId = getLastSongId()
    if (lastId) {
      const song = loadSong(lastId)
      if (song) {
        applySnapshot(song, setters, engineRef.current, routes)
        setCurrentSong({
          id: song.id,
          name: song.name,
          createdAt: song.createdAt,
          updatedAt: song.updatedAt,
        })
      } else {
        clearLastSongId()
      }
    }
    hydratedRef.current = true
    setDirty(false)
  }, [routes, setters, engineRef])

  // ── Mark dirty + debounced autosave ──────────────────────────────────────
  const debounceRef = useRef(null)
  // Build a stable JSON-stringified key from the snapshot so the effect only
  // fires on real change (React state setters can produce identical objects).
  const snapshotJson = useMemo(() => {
    try { return JSON.stringify(buildSnapshot(state)) } catch { return '' }
  }, [state])

  useEffect(() => {
    if (!hydratedRef.current) return
    setDirty(true)
    if (!autosaveOn || !currentSong) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const snap = buildSnapshot(state)
      const saved = saveSong({
        ...currentSong,
        state: snap,
      })
      setCurrentSong({
        id: saved.id,
        name: saved.name,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      })
      setLastSongId(saved.id)
      setDirty(false)
      refreshSongs()
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotJson, autosaveOn, currentSong?.id])

  // ── Imperative API ───────────────────────────────────────────────────────

  const save = useCallback(() => {
    if (!currentSong) return null    // SongMenu will prompt saveAs() instead
    const snap = buildSnapshot(state)
    const saved = saveSong({ ...currentSong, state: snap })
    setCurrentSong({
      id: saved.id,
      name: saved.name,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    })
    setLastSongId(saved.id)
    setDirty(false)
    refreshSongs()
    return saved
  }, [state, currentSong, refreshSongs])

  const saveAs = useCallback((name) => {
    const trimmed = (name ?? '').trim() || 'Untitled'
    const snap = buildSnapshot(state)
    const id = newSongId()
    const now = Date.now()
    const saved = saveSong({
      id, name: trimmed, createdAt: now, state: snap,
    })
    setCurrentSong({
      id: saved.id,
      name: saved.name,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    })
    setLastSongId(saved.id)
    setDirty(false)
    refreshSongs()
    return saved
  }, [state, refreshSongs])

  const rename = useCallback((name) => {
    if (!currentSong) return null
    const trimmed = (name ?? '').trim() || currentSong.name
    const snap = buildSnapshot(state)
    const saved = saveSong({ ...currentSong, name: trimmed, state: snap })
    setCurrentSong({
      id: saved.id,
      name: saved.name,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    })
    refreshSongs()
    return saved
  }, [state, currentSong, refreshSongs])

  const open = useCallback((id) => {
    const song = loadSong(id)
    if (!song) return null
    applySnapshot(song, setters, engineRef.current, routes)
    setCurrentSong({
      id: song.id,
      name: song.name,
      createdAt: song.createdAt,
      updatedAt: song.updatedAt,
    })
    setLastSongId(song.id)
    setDirty(false)
    return song
  }, [setters, engineRef, routes])

  const newSong = useCallback(() => {
    // Detach from current song — does not reset existing state. The user can
    // continue tweaking, then Save As to capture a fresh copy.
    setCurrentSong(null)
    clearLastSongId()
    setDirty(true)
  }, [])

  const deleteSong = useCallback((id) => {
    deleteSongRaw(id)
    if (currentSong?.id === id) setCurrentSong(null)
    refreshSongs()
  }, [currentSong, refreshSongs])

  return {
    currentSong,
    dirty,
    autosaveOn,
    setAutosaveOn,
    songs,
    save,
    saveAs,
    rename,
    open,
    newSong,
    deleteSong,
    refreshSongs,
  }
}
