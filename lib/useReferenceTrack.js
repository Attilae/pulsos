'use client'

// React side of the reference loop (Pro). Owns the song-saved metadata
// (`reference`, see lib/referenceTrack.js), resolves the audio from this
// browser's IndexedDB (lib/referenceStore.js), and mirrors both into the engine.
// Kept out of MixerTab so that file doesn't grow another dozen handlers.
//
// `engineGen` changes whenever MixerTab builds a fresh TransitEngine (new
// session, preset load), so the buffer and config are re-pushed onto it.

import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import { decodeCustomAudio } from './customAudio.js'
import { putReference, getReference, deleteReference } from './referenceStore.js'
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
  const bpmRef = useRef(bpm)
  useEffect(() => { bpmRef.current = bpm }, [bpm])

  // Resolve the audio for the current id: from memory (just uploaded / same
  // song reopened), else from IndexedDB. A Free plan never decodes it.
  const id = reference?.id ?? null
  useEffect(() => {
    setError(null)
    if (!id) { setStatus('none'); return undefined }
    if (!allowed) { setStatus('locked'); return undefined }
    if (loadedRef.current?.id === id) { setLoaded(loadedRef.current); setStatus('ready'); return undefined }
    let cancelled = false
    setStatus('loading')
    ;(async () => {
      try {
        const file = await getReference(id)
        if (cancelled) return
        if (!file) { setStatus('missing'); return }
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

  // Throws an Error whose message is meant for the UI.
  const upload = useCallback(async (file) => {
    if (!file) return
    if (!allowed) {
      trackProductEvent('reference_track_upload_blocked', {})
      openUpgrade?.('reference_track')
      throw new Error('Pro feature')
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
  }, [allowed, openUpgrade])

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

  return {
    reference, status, error, unsaved,
    peaks: playable?.peaks ?? null,
    setReference, upload, update, matchBpm, remove, forget,
  }
}
