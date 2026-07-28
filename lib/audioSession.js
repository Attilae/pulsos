'use client'

// Audio session lifecycle — the layer every engine goes through to make sound.
//
// Desktop browsers need one thing: resume the AudioContext from a user gesture.
// Mobile (iOS especially) needs three more, none of which the app used to do:
//
//   1. Escape the "ambient" audio session. Safari starts a page's Web Audio in
//      a category the hardware ring/silent switch mutes, so a muted iPhone
//      plays a perfectly healthy graph into nothing. `navigator.audioSession`
//      fixes this properly on Safari 16.4+; older iOS needs the keep-alive
//      <audio> trick below.
//   2. Resume after backgrounding. iOS suspends the context when the tab goes
//      away and nothing brought it back, so returning to the tab left the
//      playhead moving in silence.
//   3. Tell the user when none of that worked — see probeOutputPeak() and
//      components/AudioTroubleshooter.jsx. The mute switch is NOT detectable
//      from JS, so the honest play is to prove the graph *is* producing signal
//      and let the user check the hardware.
//
// unlockAudio() must be called from inside a user gesture. The synchronous
// steps run first, before any await, because awaiting spends the activation.
import * as Tone from 'tone'
import { isIOS } from './shared/platform.js'

// ── Observable state (for useSyncExternalStore) ─────────────────────────────

let snapshot = {
  contextState: 'suspended',  // 'suspended' | 'running' | 'closed'
  unlocked: false,            // unlockAudio() has succeeded at least once
  sessionType: null,          // what we asked navigator.audioSession for
  keepAlive: false,           // the iOS <audio> element is playing
  peakDb: null,               // last probeOutputPeak() result, null = never probed
}
const listeners = new Set()

function update(patch) {
  const next = { ...snapshot, ...patch }
  // Reference equality is the store's change signal — don't churn on no-ops.
  let changed = false
  for (const k of Object.keys(patch)) if (snapshot[k] !== next[k]) changed = true
  if (!changed) return
  snapshot = next
  for (const cb of listeners) cb()
}

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSnapshot() { return snapshot }
export function getServerSnapshot() { return snapshot }

// ── Context helpers ─────────────────────────────────────────────────────────

function rawContext() {
  try { return Tone.getContext().rawContext } catch { return null }
}

// Resolves either way — callers decide what to do by inspecting ctx.state,
// never by trusting that an audio promise settled.
function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, ms)),
  ])
}

function syncContextState() {
  const ctx = rawContext()
  if (ctx) update({ contextState: ctx.state })
}

// ── iOS: escape the ambient audio session ───────────────────────────────────

// Safari 16.4+. One line, and it is the *correct* fix — everything below it is
// a workaround for older iOS.
function applyPlaybackSession() {
  try {
    if (typeof navigator !== 'undefined' && navigator.audioSession) {
      navigator.audioSession.type = 'playback'
      update({ sessionType: 'playback' })
      return true
    }
  } catch { /* setting an unsupported type throws in some builds */ }
  return false
}

let keepAliveEl = null
let keepAliveUrl = null
let wantKeepAlive = false

// A half-second buffer holding a single 2 Hz sine at ±2 LSB (~-84 dBFS):
// inaudible, but NOT digital silence. Some WebKit builds treat an all-zero
// stream as "no audio" and never promote the page's audio session, which is
// the whole point of playing it.
function keepAliveSrc() {
  if (keepAliveUrl) return keepAliveUrl
  const sampleRate = 8000
  const frames = sampleRate / 2
  const bytes = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(bytes)
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  str(0, 'RIFF');  view.setUint32(4, 36 + frames * 2, true)
  str(8, 'WAVE');  str(12, 'fmt ')
  view.setUint32(16, 16, true)          // PCM chunk size
  view.setUint16(20, 1, true)           // format: PCM
  view.setUint16(22, 1, true)           // channels: mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)           // block align
  view.setUint16(34, 16, true)          // bits per sample
  str(36, 'data'); view.setUint32(40, frames * 2, true)
  // One full cycle across the buffer, so it loops without a click.
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * i) / frames) * 2), true)
  }
  keepAliveUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  return keepAliveUrl
}

function startKeepAlive() {
  // Only where it's actually needed. A permanently-playing media element hands
  // the page lock-screen transport controls and can capture desktop media
  // keys — unwanted anywhere Safari's audioSession API already did the job.
  if (typeof document === 'undefined') return
  if (!isIOS() || snapshot.sessionType === 'playback') return

  wantKeepAlive = true
  if (!keepAliveEl) {
    const el = document.createElement('audio')
    el.src = keepAliveSrc()
    el.loop = true
    el.volume = 0.001
    el.preload = 'auto'
    el.setAttribute('playsinline', '')
    el.setAttribute('aria-hidden', 'true')
    keepAliveEl = el
  }
  // Not awaited: the play() call must be *initiated* inside the gesture, and a
  // rejection here is survivable (the context may still be audible).
  keepAliveEl.play().then(
    () => update({ keepAlive: true }),
    () => update({ keepAlive: false }),
  )

  // Without metadata iOS shows a blank Now Playing card; name it deliberately.
  try {
    if (navigator.mediaSession && window.MediaMetadata) {
      navigator.mediaSession.metadata = new window.MediaMetadata({ title: 'Leið', artist: 'Transit instrument' })
    }
  } catch {}
}

function stopKeepAlive() {
  wantKeepAlive = false
  try { keepAliveEl?.pause() } catch {}
  update({ keepAlive: false })
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

let initialised = false

/** Idempotent. Installs the listeners that keep audio alive across tab changes. */
export function initAudioSession() {
  if (initialised || typeof document === 'undefined') return
  initialised = true

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { syncContextState(); return }
    // Coming back: iOS suspended the context and paused the keep-alive element.
    // Only revive if the user had unlocked audio and hasn't stopped since.
    if (!snapshot.unlocked) return
    const ctx = rawContext()
    if (ctx && ctx.state === 'suspended') ctx.resume().then(syncContextState, syncContextState)
    if (wantKeepAlive) keepAliveEl?.play().catch(() => {})
    syncContextState()
  })

  window.addEventListener('pagehide', () => {
    // A page restored from the back/forward cache gets a fresh context state;
    // force the next play through unlockAudio() rather than assuming.
    update({ unlocked: false })
  })

  const ctx = rawContext()
  if (ctx) {
    ctx.addEventListener?.('statechange', syncContextState)
    update({ contextState: ctx.state })
  }
}

/**
 * Bring audio up. MUST be called synchronously from a user gesture handler —
 * as the first statement, before any other await.
 * @returns {Promise<boolean>} whether the context ended up running
 */
export async function unlockAudio() {
  initAudioSession()

  // Synchronous first, while the user activation is still ours to spend.
  applyPlaybackSession()
  startKeepAlive()

  // Tone.start() resolves when the context reaches 'running'. If the browser
  // won't grant that — no real user activation, or an autoplay policy we can't
  // satisfy — the promise can stay pending indefinitely rather than rejecting,
  // which would hang the caller's Play handler and leave the transport showing
  // "▶" with no explanation. Time-box it and let the caller check the state.
  await withTimeout(Tone.start(), 3000)

  const ctx = rawContext()
  if (ctx && ctx.state !== 'running') {
    await withTimeout(ctx.resume(), 3000)
  }

  const running = ctx?.state === 'running'
  update({ contextState: ctx?.state ?? 'suspended', unlocked: running })
  return running
}

/** Called when playback stops, so we stop holding the OS audio session open. */
export function releaseAudioSession() {
  stopKeepAlive()
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

let analyser = null
let analyserBuf = null

function ensureAnalyser() {
  if (analyser) return analyser
  const ctx = rawContext()
  if (!ctx) return null
  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyserBuf = new Float32Array(analyser.fftSize)
  // Tone's Destination is tappable as a source (lib/audioExport.js does the
  // same to record the mix). The analyser is a sink, so nothing is doubled.
  try { Tone.getDestination().connect(analyser) } catch { analyser = null }
  return analyser
}

/**
 * Peak output level over `ms`, in dBFS. -Infinity means digital silence.
 * This is what lets the troubleshooter distinguish "the app is making no sound"
 * from "the app is making sound your phone isn't playing".
 */
export async function probeOutputPeak(ms = 400) {
  const node = ensureAnalyser()
  if (!node) return null
  const deadline = performance.now() + ms
  let peak = 0
  await new Promise(resolve => {
    const sample = () => {
      node.getFloatTimeDomainData(analyserBuf)
      for (let i = 0; i < analyserBuf.length; i++) {
        const v = Math.abs(analyserBuf[i])
        if (v > peak) peak = v
      }
      if (performance.now() < deadline) requestAnimationFrame(sample)
      else resolve()
    }
    requestAnimationFrame(sample)
  })
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity
  update({ peakDb: db })
  return db
}

/** Synchronous snapshot of everything we can actually determine. */
export function getDiagnostics() {
  const ctx = rawContext()
  let masterDb = null
  let masterMuted = false
  try {
    const dest = Tone.getDestination()
    masterDb = dest.volume.value
    masterMuted = !!dest.mute
  } catch {}
  return {
    ...snapshot,
    contextState: ctx?.state ?? 'closed',
    sampleRate: ctx?.sampleRate ?? null,
    masterDb,
    masterMuted,
    ios: isIOS(),
    // Deliberately absent: any claim about the hardware ring/silent switch.
    // There is no API for it and every published detection trick is unreliable.
  }
}

export function disposeAudioSession() {
  stopKeepAlive()
  try { Tone.getDestination().disconnect(analyser) } catch {}
  analyser = null
  analyserBuf = null
  if (keepAliveUrl) { URL.revokeObjectURL(keepAliveUrl); keepAliveUrl = null }
  keepAliveEl = null
}
