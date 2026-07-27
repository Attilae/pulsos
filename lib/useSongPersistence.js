// Owns the song save/load/autosave lifecycle for the Mixer tab.
//
// Now DB-backed (via lib/persistence.js → /api/presets) and async:
//   - Hydrate from lastSongId once routes + a signed-in session are ready
//   - Debounced autosave (800 ms) once hydrated and signed in
//   - save / saveAs / open / newSong / deleteSong / listSongs (all async)
//   - Track currentSong metadata + dirty / saving / saveError for the header
//     save indicator (dirty tracking runs signed-out too, where nothing can
//     be persisted and the warning matters most)
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listSongs as listSongsRaw,
  loadSong, saveSong, deleteSong as deleteSongRaw,
  shareSong, unshareSong, loadShared, shareUrl,
  getLastSongId, setLastSongId, clearLastSongId,
  newSongId,
} from './persistence.js'
import { buildSnapshot } from './songState.js'
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
  cityId: song.cityId ?? song.state?.cityId ?? null,
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

export function useSongPersistence({ state, applyPreset, routes, onReset }) {
  const { data: session, isPending: sessionPending } = useSession()
  const userId = session?.user?.id ?? null
  // Only whether routes have arrived matters for hydration, not their identity: a
  // preset apply replaces `routes`, and depending on that would make the effect
  // re-run and cancel itself on the very pass that is applying.
  const routesReady = !!routes

  const [currentSong, setCurrentSong]  = useState(null)
  const [dirty, setDirty]              = useState(false)
  const [saving, setSaving]            = useState(false)
  const [saveError, setSaveError]      = useState(null)
  const [autosaveOn, setAutosaveOnRaw] = useState(_readAutosavePref)
  const [songs, setSongs]              = useState([])

  // Hydration guard — true once the initial load attempt finishes.
  const hydratedRef = useRef(false)
  // Who the last hydration pass loaded for. Keyed by userId (rather than a
  // sticky boolean) so signing in mid-session still loads lastSongId, while
  // 'shared' pins an imported share link against being clobbered by that re-run.
  //   undefined = never | null = signed-out | <userId> | 'shared'
  const loadedForRef = useRef(undefined)
  // Concurrent writes (a manual ⌘S overlapping the autosave debounce) must not
  // let the earlier one's completion clear `saving` while the later is in flight.
  const inflightRef = useRef(0)
  // The snapshot we consider "saved". Autosave fires on a *difference* from this,
  // not on any change at all — otherwise applying a song or wiping the session
  // looks like a user edit worth persisting, which is how a city switch used to
  // overwrite the open song with an empty state. null = adopt the next snapshot.
  const baselineRef = useRef(null)

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
    if (!routesReady) return                       // wait for routes
    if (sessionPending) return                     // wait until we know if we're signed in,
                                                   // so the indicator doesn't flash "Unsaved"
    if (loadedForRef.current === 'shared') return  // an imported link owns the session
    if (loadedForRef.current === userId) return

    ;(async () => {
      const sharedId = _consumeSharedParam()
      if (sharedId) {
        // Claim before awaiting: applyPreset is async and changes `routes`, so an
        // unclaimed re-run of this effect could apply the same song twice.
        loadedForRef.current = 'shared'
        hydratedRef.current = true
        const shared = await loadShared(sharedId)
        if (shared) {
          baselineRef.current = null
          await applyPreset(shared)
          setCurrentSong(null)      // detached/unsaved — Save As to own a copy
        }
        if (userId) await refreshSongs()
        setDirty(!!shared)          // imported = unsaved changes
        return
      }

      if (!userId) {
        // Signed out: nothing to load, but dirty tracking still has to start —
        // this work can't be persisted at all, which is exactly when the user
        // most needs to be told it's unsaved. Leaves `dirty` untouched.
        loadedForRef.current = null
        hydratedRef.current = true
        return
      }

      loadedForRef.current = userId
      hydratedRef.current = true
      await refreshSongs()
      const lastId = getLastSongId()
      if (lastId) {
        const song = await loadSong(lastId)
        if (song) {
          baselineRef.current = null
          await applyPreset(song)
          setCurrentSong(_meta(song))
        } else {
          clearLastSongId()
        }
      }
      setDirty(false)
    })()
  }, [routesReady, userId, sessionPending, applyPreset, refreshSongs])

  // ── Mark dirty + debounced autosave ───────────────────────────────────────
  const debounceRef = useRef(null)
  // Stable JSON key so the effect only fires on real change.
  const snapshotJson = useMemo(() => {
    try { return JSON.stringify(buildSnapshot(state)) } catch { return '' }
  }, [state])

  // Single write path — owns the saving/error/dirty bookkeeping so every caller
  // (autosave included) reports progress the same way. saveSong() is the only
  // persistence call that throws.
  const persist = useCallback(async (song) => {
    // A song only ever belongs to the city it was authored in. If the snapshot has
    // drifted to another city the attachment is stale (a switch we failed to
    // detach on), and writing would replace the saved song with a foreign one.
    if (song?.cityId && song?.state?.cityId && song.cityId !== song.state.cityId) {
      console.warn('[persistence] city mismatch — detaching instead of overwriting', song.id)
      setCurrentSong(null)
      clearLastSongId()
      return null
    }
    inflightRef.current++
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await saveSong(song)
      setCurrentSong(_meta(saved))
      setLastSongId(saved.id)
      baselineRef.current = JSON.stringify(song.state)
      setDirty(false)
      refreshSongs()
      return saved
    } catch (e) {
      setSaveError(e)
      throw e
    } finally {
      if (--inflightRef.current === 0) setSaving(false)
    }
  }, [refreshSongs])

  useEffect(() => {
    if (!hydratedRef.current) return
    // First snapshot after an apply/reset becomes the new "saved" reference rather
    // than an edit — nothing the user did produced it.
    if (baselineRef.current == null) {
      baselineRef.current = snapshotJson
      setDirty(false)
      return
    }
    if (snapshotJson === baselineRef.current) { setDirty(false); return }
    setDirty(true)
    if (!autosaveOn || !currentSong) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      // persist() surfaces the failure via saveError; catch so it can't escape
      // the timer callback as an unhandled rejection.
      try {
        await persist({ ...currentSong, state: buildSnapshot(state) })
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
    return persist({ ...currentSong, state: buildSnapshot(state) })
  }, [state, currentSong, persist, userId])

  const saveAs = useCallback(async (name) => {
    if (!userId) return null
    const trimmed = (name ?? '').trim() || 'Untitled'
    return persist({ id: newSongId(), name: trimmed, state: buildSnapshot(state) })
  }, [state, persist, userId])

  const rename = useCallback(async (name) => {
    if (!userId) return null
    if (!currentSong) return null
    const trimmed = (name ?? '').trim() || currentSong.name
    return persist({ ...currentSong, name: trimmed, state: buildSnapshot(state) })
  }, [state, currentSong, persist, userId])

  const open = useCallback(async (id) => {
    const song = await loadSong(id)
    if (!song) return null
    // Claim the session so a late hydration pass can't clobber this song.
    loadedForRef.current = userId ?? 'shared'
    hydratedRef.current = true
    baselineRef.current = null   // the applied snapshot is the new saved baseline
    await applyPreset(song)
    setCurrentSong(_meta(song))
    setLastSongId(song.id)
    setDirty(false)
    return song
  }, [applyPreset, userId])

  const newSong = useCallback(async () => {
    // Preserve the previous session before clearing, so nothing is lost:
    //   - attached song   → persist any pending edits to it
    //   - unsaved edits    → keep them as a new timestamped session
    // (Signed-out users can't persist — SongMenu warns them first.)
    if (userId) {
      // Not persist(): that would attach currentSong a moment before we detach
      // it below. Report progress via the counter directly instead.
      inflightRef.current++
      setSaving(true)
      setSaveError(null)
      try {
        if (currentSong) {
          await saveSong({ ...currentSong, state: buildSnapshot(state) })
        } else if (dirty) {
          const name = `Session ${new Date().toLocaleString()}`
          await saveSong({ id: newSongId(), name, state: buildSnapshot(state) })
        }
        await refreshSongs()
      } catch (e) {
        setSaveError(e)
        console.warn('[newSong] failed to preserve previous session', e)
      } finally {
        if (--inflightRef.current === 0) setSaving(false)
      }
    }

    // Reset to a clean, empty state and detach (Save As later to keep a copy).
    // Detaching is what stops autosave from writing the wiped session over the
    // song we just preserved.
    baselineRef.current = null
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
    currentSong, dirty, saving, saveError, autosaveOn, setAutosaveOn, songs,
    save, saveAs, rename, open, newSong, deleteSong, refreshSongs,
    share, unshare, shareUrl,
    signedIn: !!userId,
  }
}
