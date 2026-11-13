'use client'

// React side of the reference loop (signed-in Free and Pro). Owns the song-saved metadata
// (`reference`, see lib/referenceTrack.js), resolves the audio, and mirrors both
// into the engine. Kept out of MixerTab so that file doesn't grow another dozen
// handlers.
//
// The audio is looked up in this browser's IndexedDB first (lib/referenceStore.js)
// and then in the cloud (lib/referenceCloud.js): the account's own stored loop,
// or the loop of a song opened from a share link. An upload is stored on the
// device and then sent to the account, where the plan caps how many are kept
// (limits.referenceLoops). The cloud copy is best-effort: a loop that can't be
// stored there (no slot, too large, offline) keeps playing from the device.
//
// `engineGen` changes whenever MixerTab builds a fresh TransitEngine (new
// session, preset load), so the buffer and config are re-pushed onto it.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { decodeCustomAudio } from './customAudio.js'
import { putReference, getReference, deleteReference } from './referenceStore.js'
import {
  fetchLoopLibrary, uploadLoop, downloadLoop, deleteCloudLoop, getLoopShareSource,
} from './referenceCloud.js'
import { REFERENCE_CLOUD_MAX_BYTES, loopLimitMessage, loopSlotsLeft } from './referenceLoops.js'
import {
  DEFAULT_REFERENCE, normalizeReference, guessBars, bpmForBars, computePeaks,
  durationBucket, formatOf,
} from './referenceTrack.js'
import { trackProductEvent } from './productAnalytics.js'

function sessionId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

async function decodeReferenceFile(file) {
  const raw = Tone.getContext().rawContext
  return decodeCustomAudio(file, 'reference', buf => raw.decodeAudioData(buf), raw)
}

function channelsOf(audio) {
  return Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
}

// status: 'none' | 'loading' | 'ready' | 'missing' | 'locked' | 'error'
export function useReferenceTrack({ engineRef, engineGen, allowed, openUpgrade, bpm, setBpm }) {
  const [reference, setReference] = useState(null)
  const [loaded, setLoaded] = useState(null)   // { id, audio, peaks } for the current id
  const [status, setStatus] = useState('none')
  const [error, setError] = useState(null)
  const [unsaved, setUnsaved] = useState(false) // played this session, not stored on the device
  const loadedRef = useRef(null)
  // The account's stored loops: { userId, loops, limit, plan, maxBytes, access, enabled }.
  const [library, setLibrary] = useState(null)
  const libraryRef = useRef(null)
  // Cloud state of one loop id: { id, state, message }.
  //   'uploading' | 'full' | 'too_large' | 'error'  (anything else is derived)
  const [sync, setSync] = useState(null)
  const filesRef = useRef(new Map())   // id → File, for a later "store in account"

  const refreshLibrary = useCallback(async () => {
    try {
      const next = await fetchLoopLibrary()
      libraryRef.current = next
      setLibrary(next)
      return next
    } catch (err) {
      console.warn('[reference] library unavailable', err)
      return libraryRef.current
    }
  }, [])

  useEffect(() => {
    if (!allowed) { libraryRef.current = null; setLibrary(null); return }
    refreshLibrary()
  }, [allowed, refreshLibrary])
  const bpmRef = useRef(bpm)
  useEffect(() => { bpmRef.current = bpm }, [bpm])

  // Resolve the audio for the current id: from memory (just uploaded / same
  // song reopened), else IndexedDB, else the cloud. A guest only gets the loop
  // of a song they opened from a share link.
  const id = reference?.id ?? null
  useEffect(() => {
    setError(null)
    if (!id) { setStatus('none'); return undefined }
    if (!allowed && !getLoopShareSource()) { setStatus('locked'); return undefined }
    if (loadedRef.current?.id === id) { setLoaded(loadedRef.current); setStatus('ready'); return undefined }
    let cancelled = false
    setStatus('loading')
    ;(async () => {
      try {
        let file = null
        try { file = await getReference(id) } catch (err) { if (err?.code !== 'unavailable') console.warn('[reference] local lookup failed', err) }
        if (cancelled) return
        if (!file) {
          file = await downloadLoop(id)
          if (cancelled) return
          if (!file) { setStatus(allowed ? 'missing' : 'locked'); return }
          // Cache it so the next visit doesn't download it again.
          putReference(file, id).catch(() => {})
        }
        filesRef.current.set(id, file)
        const audio = await decodeReferenceFile(file)
        if (cancelled) return
        const next = { id, audio, peaks: computePeaks(channelsOf(audio)) }
        loadedRef.current = next
        setLoaded(next)
        setUnsaved(false)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        if (err?.code === 'unavailable') { setStatus('missing'); return }
        setError(err?.message ?? "Couldn't load the reference loop")
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [id, allowed])

  // 'ready' is only reached by someone allowed to hear it (see the effect above).
  const playable = status === 'ready' && loaded?.id === id ? loaded : null

  // Config first, so a buffer arriving in the same commit schedules with it.
  const bars = reference?.bars ?? DEFAULT_REFERENCE.bars
  const offsetSec = reference?.offsetSec ?? 0
  const volumeDb = reference?.volumeDb ?? DEFAULT_REFERENCE.volumeDb
  const muted = reference?.muted ?? false
  useEffect(() => {
    engineRef.current?.setReferenceConfig({ bars, offsetSec, volumeDb, muted })
  }, [engineRef, engineGen, bars, offsetSec, volumeDb, muted])

  const audio = playable?.audio ?? null
  useEffect(() => {
    engineRef.current?.setReferenceBuffer(audio)
  }, [engineRef, engineGen, audio])

  // Send a loop to the account. Never throws: the outcome lands in `sync`.
  const storeInAccount = useCallback(async (loopId, file, durationSec) => {
    if (!allowed || !file || !loopId) return
    const lib = libraryRef.current ?? await refreshLibrary()
    if (!lib?.enabled) return
    if (file.size > (lib.maxBytes ?? REFERENCE_CLOUD_MAX_BYTES)) {
      setSync({ id: loopId, state: 'too_large', message: `Loops over ${Math.round((lib.maxBytes ?? REFERENCE_CLOUD_MAX_BYTES) / 1048576)} MB stay on this device.` })
      return
    }
    const has = lib.loops.some(l => l.id === loopId)
    if (!has && loopSlotsLeft(lib.loops.length, lib.limit) <= 0) {
      setSync({ id: loopId, state: 'full', message: loopLimitMessage(lib.limit, lib.plan) })
      trackProductEvent('reference_track_cloud_full', { plan: lib.plan })
      return
    }
    setSync({ id: loopId, state: 'uploading', message: null })
    try {
      await uploadLoop(file, { id: loopId, userId: lib.userId, durationSec, access: lib.access })
      await refreshLibrary()
      setSync(prev => (prev?.id === loopId ? null : prev))
      trackProductEvent('reference_track_cloud_stored', { plan: lib.plan })
    } catch (err) {
      console.warn('[reference] cloud upload failed', err)
      if (err?.code === 'loop_limit') await refreshLibrary()
      setSync({
        id: loopId,
        state: err?.code === 'loop_limit' ? 'full' : err?.code === 'too_large' ? 'too_large' : 'error',
        message: err?.message ?? "Couldn't store the loop in your account",
      })
    }
  }, [allowed, refreshLibrary])

  // Throws an Error whose message is meant for the UI.
  const upload = useCallback(async (file) => {
    if (!file) return
    if (!allowed) {
      trackProductEvent('reference_track_upload_blocked', {})
      openUpgrade?.('reference_track')
      throw new Error('Sign in or create a free account to upload your loop')
    }
    const audio = await decodeReferenceFile(file)
    let id
    let stored = true
    try {
      ({ id } = await putReference(file))
    } catch (err) {
      // Private mode / quota: still play it for this session.
      console.warn('[reference] not stored on this device', err)
      id = sessionId()
      stored = false
    }
    const next = { id, audio, peaks: computePeaks(channelsOf(audio)) }
    loadedRef.current = next
    setLoaded(next)
    setUnsaved(!stored)
    filesRef.current.set(id, file)
    storeInAccount(id, file, audio.duration)
    const barsGuess = guessBars(audio.duration, bpmRef.current)
    setReference(prev => normalizeReference({
      ...DEFAULT_REFERENCE,
      // A re-upload (replace / missing on this device) keeps the mix settings.
      ...(prev ? { volumeDb: prev.volumeDb, muted: false, includeInExport: prev.includeInExport } : {}),
      id,
      name: file.name ?? 'loop',
      durationSec: audio.duration,
      bars: prev?.durationSec && Math.abs(prev.durationSec - audio.duration) < 0.05 ? prev.bars : barsGuess,
      offsetSec: prev?.durationSec && Math.abs(prev.durationSec - audio.duration) < 0.05 ? prev.offsetSec : 0,
    }))
    trackProductEvent('reference_track_loaded', {
      format: formatOf(file.name),
      duration: durationBucket(audio.duration),
      bars: barsGuess,
      stored,
    })
  }, [allowed, openUpgrade, storeInAccount])

  const update = useCallback((patch) => {
    setReference(prev => (prev ? normalizeReference({ ...prev, ...patch }) : prev))
  }, [])

  const matchBpm = useCallback(() => {
    if (!reference) return
    const next = bpmForBars(reference.durationSec - (reference.offsetSec ?? 0), reference.bars)
    if (next == null) return
    setBpm(next)
    trackProductEvent('reference_track_bpm_matched', { bars: reference.bars })
  }, [reference, setBpm])

  // Detach from the song; the file stays on the device for other songs.
  const remove = useCallback(() => setReference(null), [])

  // Detach and delete the stored file.
  const forget = useCallback(async () => {
    const current = reference?.id
    setReference(null)
    if (loadedRef.current?.id === current) loadedRef.current = null
    setLoaded(null)
    if (current) {
      try { await deleteReference(current) } catch (err) { console.warn('[reference] delete failed', err) }
    }
  }, [reference])

  // Store the current loop in the account (it was added before cloud storage,
  // a slot was freed, or an earlier upload failed).
  const storeCurrent = useCallback(() => {
    const file = id ? filesRef.current.get(id) : null
    if (file) storeInAccount(id, file, reference?.durationSec ?? 0)
  }, [id, reference?.durationSec, storeInAccount])

  // Delete a loop from the account. This device's copy is left alone, so a
  // song that is open keeps playing.
  const deleteStored = useCallback(async (loopId) => {
    await deleteCloudLoop(loopId)
    setSync(prev => (prev?.id === loopId ? null : prev))
    await refreshLibrary()
  }, [refreshLibrary])

  // 'synced' | 'uploading' | 'device' | 'full' | 'too_large' | 'error' | null
  const stored = !!id && !!library?.loops.some(l => l.id === id)
  let cloud = null
  if (id && allowed && library?.enabled && status === 'ready') {
    if (sync?.id === id) cloud = sync.state
    else cloud = stored ? 'synced' : 'device'
  }

  return {
    reference, status, error, unsaved,
    peaks: playable?.peaks ?? null,
    cloud,
    cloudMessage: sync?.id === id ? sync.message : null,
    canStore: !!id && filesRef.current.has(id),
    library,
    setReference, upload, update, matchBpm, remove, forget, storeCurrent, deleteStored,
  }
}
