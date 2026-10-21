// Field performance monitor. Watches the things that go wrong on slow machines
// and the M4 development machine never shows:
//
// - audio dropouts: the audio clock falling behind wall time (perfStats.js);
// - late notes: gaps in Tone's scheduler tick longer than its lookAhead, which
//   happen when the main thread stalls and make notes start late;
// - UI: frame times and Long Animation Frames while playing;
// - the device: cores, memory, GPU class (software rendering is common on
//   Windows laptops whose driver Chrome blocklists), power source.
//
// Everything is passive and cheap (a 1 s sampler, one tick listener, one rAF
// loop only while playing), so it runs for every sampled visitor. A session that
// played for MIN_PLAY_MS sends one `perf_session` event; `?perf=1` shows the
// numbers on screen (components/PerfHud.jsx). Framework-free, like audioSession.js.

import * as Tone from 'tone'
import { trackProductEvent } from './productAnalytics.js'
import {
  createHistogram, histAdd, summarizeFrames, dropoutFromLag, noiseFloorMs, ratePerMinute,
  classifyGpu, perfVerdict, packProfile,
} from './perfStats.js'

const SAMPLE_MS = 1000
const MIN_PLAY_MS = 30_000
const MAX_WORST_FRAMES = 5
// Right after Play the DAW re-renders every lane and the first Part windows are
// scheduled, which can stall the scheduler once. That's startup cost (reported
// as startStallMs), not the steady-state lateness late-note counting is for.
const WARMUP_MS = 2000
const HUD_KEY = 'leid-perf-hud'

let started = false
let reportSent = false
const listeners = new Set()

const state = {
  device: null,
  workload: {},
  // audio clock
  baseline: null,           // { wall, audio } at the start of the current running stretch
  lagCarryMs: 0,            // dropout from earlier running stretches
  lagMs: 0,
  runningMs: 0,
  lastSampleWall: null,
  lagHistory: [],           // [{ wall, dropout }] for the last minute, HUD's "now" figure
  // scheduler
  lastTick: null,
  tickPlayingSince: null,
  lateTicks: 0,
  lateMaxMs: 0,
  startStallMs: 0,
  // ui
  frames: createHistogram(),
  rafId: 0,
  lastFrame: null,
  longFrames: 0,
  blockingMs: 0,
  worstFrames: [],
  playMs: 0,
  playSince: null,
}

const nowMs = () => performance.now()

function rawContext() {
  try { return Tone.getContext().rawContext } catch { return null }
}

function transportPlaying() {
  try { return Tone.getTransport().state === 'started' } catch { return false }
}

// ── Device facts (once) ────────────────────────────────────────────────────

function gpuRenderer() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (!gl) return 'none'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return String(name ?? '')
  } catch { return '' }
}

function osAndBrowser() {
  const ua = navigator.userAgent ?? ''
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? ''
  const os = /win/i.test(platform) || /Windows/.test(ua) ? 'win'
    : /mac/i.test(platform) || /Mac OS X/.test(ua) ? 'mac'
    : /android/i.test(ua) ? 'android'
    : /iPhone|iPad|iPod/.test(ua) ? 'ios'
    : /linux|cros/i.test(platform + ua) ? 'linux' : 'other'
  const browser = /Edg\//.test(ua) ? 'edge'
    : /Firefox\//.test(ua) ? 'firefox'
    : /Chrome\//.test(ua) ? 'chrome'
    : /Safari\//.test(ua) ? 'safari' : 'other'
  return { os, browser }
}

function collectDevice() {
  const renderer = gpuRenderer()
  const device = {
    ...osAndBrowser(),
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: navigator.deviceMemory ?? null,
    gpu: renderer.slice(0, 120),
    gpuClass: classifyGpu(renderer),
    charging: null,
    batteryLevel: null,
  }
  navigator.getBattery?.().then((b) => {
    const read = () => { device.charging = b.charging; device.batteryLevel = Math.round(b.level * 100) }
    read()
    b.addEventListener?.('chargingchange', read)
  }).catch(() => {})
  return device
}

// ── Audio clock sampler ────────────────────────────────────────────────────

function noise() {
  const ctx = rawContext()
  return noiseFloorMs(ctx?.baseLatency != null ? ctx.baseLatency * 1000 : null)
}

function sampleAudioClock() {
  const ctx = rawContext()
  const wall = nowMs()
  const running = ctx?.state === 'running' && !document.hidden
  if (!running) {
    // Close the stretch: keep what it measured, re-baseline when it resumes.
    if (state.baseline) state.lagCarryMs += dropoutFromLag(state.lagMs, noise())
    state.baseline = null
    state.lagMs = 0
    state.lastSampleWall = null
    return
  }
  const audio = ctx.currentTime
  if (!state.baseline) {
    state.baseline = { wall, audio }
    state.lastSampleWall = wall
    return
  }
  state.runningMs += wall - state.lastSampleWall
  state.lastSampleWall = wall
  state.lagMs = (wall - state.baseline.wall) - (audio - state.baseline.audio) * 1000
  const dropout = totalDropoutMs()
  state.lagHistory.push({ wall, dropout })
  while (state.lagHistory.length && wall - state.lagHistory[0].wall > 60_000) state.lagHistory.shift()
}

function totalDropoutMs() {
  return state.lagCarryMs + dropoutFromLag(state.lagMs, noise())
}

// ── Scheduler ticks ────────────────────────────────────────────────────────

function onTick() {
  const t = nowMs()
  const last = state.lastTick
  state.lastTick = t
  if (!transportPlaying()) { state.tickPlayingSince = null; return }
  // The gap that spans the start also spans the graph build, which happens
  // before the transport starts and so can't make a note late. Start counting
  // from the first tick with the transport already running.
  if (state.tickPlayingSince == null) { state.tickPlayingSince = t; return }
  if (last == null || document.hidden) return
  const gap = t - last
  if (t - state.tickPlayingSince < WARMUP_MS) {
    if (gap > state.startStallMs) state.startStallMs = gap
    return
  }
  const lookAheadMs = (Tone.getContext().lookAhead ?? 0.1) * 1000
  const over = gap - lookAheadMs
  if (over > 0) {
    state.lateTicks++
    if (over > state.lateMaxMs) state.lateMaxMs = over
  }
}

// ── Frames while playing ───────────────────────────────────────────────────

function frame(t) {
  state.rafId = requestAnimationFrame(frame)
  if (state.lastFrame != null && !document.hidden) histAdd(state.frames, t - state.lastFrame)
  state.lastFrame = t
}

function syncPlayback() {
  const playing = transportPlaying() && !document.hidden
  const t = nowMs()
  if (playing && state.playSince == null) {
    state.playSince = t
    state.lastFrame = null
    state.rafId = requestAnimationFrame(frame)
  } else if (!playing && state.playSince != null) {
    state.playMs += t - state.playSince
    state.playSince = null
    cancelAnimationFrame(state.rafId)
    state.rafId = 0
    maybeSendReport()
  }
}

function observeLongFrames() {
  const record = (entry, styleLayout, scripts) => {
    if (state.playSince == null) return
    state.longFrames++
    state.blockingMs += entry.blockingDuration ?? Math.max(0, entry.duration - 50)
    state.worstFrames.push({ ms: Math.round(entry.duration), styleLayoutMs: styleLayout, scripts })
    state.worstFrames.sort((a, b) => b.ms - a.ms)
    state.worstFrames.length = Math.min(state.worstFrames.length, MAX_WORST_FRAMES)
  }
  const types = PerformanceObserver.supportedEntryTypes ?? []
  try {
    if (types.includes('long-animation-frame')) {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const end = e.startTime + e.duration
          const styleLayout = e.styleAndLayoutStart ? Math.round(end - e.styleAndLayoutStart) : null
          const scripts = (e.scripts ?? []).slice(0, 3).map(s => ({
            ms: Math.round(s.duration),
            fn: s.sourceFunctionName || s.invoker || '',
            src: String(s.sourceURL ?? '').split('/').pop(),
          }))
          record(e, styleLayout, scripts)
        }
      }).observe({ type: 'long-animation-frame' })
    } else if (types.includes('longtask')) {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) record(e, null, []) })
        .observe({ type: 'longtask' })
    }
  } catch {}
}

// ── Report ─────────────────────────────────────────────────────────────────

export function getPerfReport() {
  const ctx = rawContext()
  let toneCtx = null
  try { toneCtx = Tone.getContext() } catch {}
  const playMs = state.playMs + (state.playSince != null ? nowMs() - state.playSince : 0)
  const runningMs = state.runningMs
  const dropout = totalDropoutMs()
  const recent = state.lagHistory.length
    ? dropout - (state.lagHistory.find(s => nowMs() - s.wall <= 10_000)?.dropout ?? dropout)
    : 0
  const ui = summarizeFrames(state.frames)
  const report = {
    at: new Date().toISOString(),
    device: state.device,
    workload: state.workload,
    playMs: Math.round(playMs),
    audio: {
      state: ctx?.state ?? null,
      sampleRate: ctx?.sampleRate ?? null,
      latencyHint: toneCtx?.latencyHint ?? null,
      baseLatencyMs: ctx?.baseLatency != null ? Math.round(ctx.baseLatency * 1000) : null,
      outputLatencyMs: ctx?.outputLatency != null ? Math.round(ctx.outputLatency * 1000) : null,
      lookAheadMs: toneCtx ? Math.round(toneCtx.lookAhead * 1000) : null,
      runningSec: Math.round(runningMs / 1000),
      noiseFloorMs: Math.round(noise()),
      dropoutMs: Math.round(dropout),
      dropoutMsPerMin: ratePerMinute(dropout, runningMs),
      dropoutMsLast10s: Math.round(recent),
      lateTicks: state.lateTicks,
      lateTicksPerMin: ratePerMinute(state.lateTicks, playMs),
      lateMaxMs: Math.round(state.lateMaxMs),
      startStallMs: Math.round(state.startStallMs),
    },
    ui: {
      ...ui,
      longFrames: state.longFrames,
      longFramesPerMin: ratePerMinute(state.longFrames, playMs),
      blockingMsPerMin: ratePerMinute(state.blockingMs, playMs),
      worstFrames: state.worstFrames,
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    },
  }
  return { ...report, ...perfVerdict(report) }
}

function maybeSendReport() {
  if (reportSent || !state.sampled) return
  const report = getPerfReport()
  if (report.playMs < MIN_PLAY_MS) return
  reportSent = true
  trackProductEvent('perf_session', { verdict: report.verdict, profile: packProfile(report) })
}

/** Reset the counters (the HUD's Reset; the device facts stay). */
export function resetPerf() {
  Object.assign(state, {
    baseline: null, lagCarryMs: 0, lagMs: 0, runningMs: 0, lastSampleWall: null, lagHistory: [],
    lateTicks: 0, lateMaxMs: 0, startStallMs: 0, frames: createHistogram(), longFrames: 0, blockingMs: 0,
    worstFrames: [], playMs: 0, playSince: state.playSince != null ? nowMs() : null,
  })
  notify()
}

/** What is playing, for grouping reports: lane count, worklet lanes, view. */
export function setPerfWorkload(workload) {
  state.workload = { ...state.workload, ...workload }
}

export function subscribePerf(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notify() {
  for (const fn of listeners) { try { fn() } catch {} }
}

/** Is the on-screen HUD wanted? `?perf=1` turns it on for this browser, `?perf=0` off. */
export function perfHudEnabled() {
  if (typeof window === 'undefined') return false
  try {
    const q = new URLSearchParams(window.location.search).get('perf')
    if (q === '1') localStorage.setItem(HUD_KEY, '1')
    if (q === '0') localStorage.removeItem(HUD_KEY)
    return localStorage.getItem(HUD_KEY) === '1'
  } catch { return false }
}

export function hidePerfHud() {
  try { localStorage.removeItem(HUD_KEY) } catch {}
}

/**
 * Idempotent. `sampleRate` (0..1) decides whether this page load reports to
 * analytics; the HUD measures either way.
 */
export function startPerfMonitor({ sampleRate = 1 } = {}) {
  if (started || typeof window === 'undefined') return
  started = true
  state.sampled = Math.random() < sampleRate
  state.device = collectDevice()
  try { Tone.getContext().on('tick', onTick) } catch {}
  observeLongFrames()
  setInterval(() => {
    sampleAudioClock()
    syncPlayback()
    notify()
  }, SAMPLE_MS)
  document.addEventListener('visibilitychange', () => { sampleAudioClock(); syncPlayback() })
  window.addEventListener('pagehide', () => {
    if (state.playSince != null) { state.playMs += nowMs() - state.playSince; state.playSince = null }
    maybeSendReport()
  })
  window.leidPerf = { report: getPerfReport, reset: resetPerf, profile: () => packProfile(getPerfReport()) }
}
