// Pure maths behind the performance monitor (lib/perfMonitor.js): frame-time
// histograms, the budgets a session is judged against, and the compact profile
// string sent as a field event. No DOM, no Tone, so test/perf-stats.test.js can
// pin the thresholds. Rationale and measurements: docs/performance-audit-2026-10-21.md.

// What "too slow" means. Each one maps to something a listener notices:
// - audio dropouts: the audio clock fell behind wall time, i.e. the render
//   thread missed deadlines and the output played silence or garbage (clicks);
// - late notes: Tone's scheduler tick arrived more than `lookAhead` after the
//   previous one, so notes in that gap were scheduled after their own start;
// - UI: the 95th-percentile frame or the rate of long animation frames.
export const PERF_BUDGETS = {
  // Clock lag below this is measurement noise; see noiseFloorMs.
  dropoutNoiseMs: 30,
  // Rates from less data than this swing wildly (15 ms in 14 s reads as
  // 60 ms/min), so they stay null and can't fail a session.
  minRateWindowMs: 20_000,
  // Audible dropouts per minute of running audio before a session is flagged.
  dropoutMsPerMin: 20,
  lateTicksPerMin: 1,
  frameP95Ms: 50,
  longFramesPerMin: 10,
}

export const LATENCY_HINTS = ['interactive', 'balanced', 'playback']

/** `?latency=` / stored override → a Web Audio latencyHint, or null for the default. */
export function parseLatencyHint(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return LATENCY_HINTS.includes(v) ? v : null
}

// ── Frame-time histogram ───────────────────────────────────────────────────
// 1 ms buckets up to HIST_MAX_MS; anything longer lands in the last bucket.
// Fixed memory however long the session runs.
export const HIST_MAX_MS = 1000

export function createHistogram() {
  return { buckets: new Uint32Array(HIST_MAX_MS + 1), count: 0, sum: 0, max: 0 }
}

export function histAdd(h, ms) {
  if (!Number.isFinite(ms) || ms < 0) return
  h.buckets[Math.min(HIST_MAX_MS, Math.round(ms))]++
  h.count++
  h.sum += ms
  if (ms > h.max) h.max = ms
}

/** Value at quantile q (0..1), in whole ms; null when empty. */
export function histPercentile(h, q) {
  if (!h.count) return null
  const target = Math.max(1, Math.ceil(h.count * q))
  let seen = 0
  for (let i = 0; i < h.buckets.length; i++) {
    seen += h.buckets[i]
    if (seen >= target) return i
  }
  return HIST_MAX_MS
}

export function summarizeFrames(h) {
  if (!h.count) return { frames: 0, fps: null, p50: null, p95: null, p99: null, max: null }
  return {
    frames: h.count,
    fps: Math.round(1000 / (h.sum / h.count)),
    p50: histPercentile(h, 0.5),
    p95: histPercentile(h, 0.95),
    p99: histPercentile(h, 0.99),
    max: Math.round(h.max),
  }
}

// ── Audio clock ────────────────────────────────────────────────────────────

/**
 * Dropout time implied by how far the audio clock has fallen behind wall time.
 * The render thread never skips frames: when it misses a deadline the device
 * plays silence and the context clock simply falls behind. Verified in
 * Chromium: a worklet burning 4 ms per 2.9 ms quantum produced 887 ms of lag in
 * 3 s, an idle graph under 3 ms.
 */
export function dropoutFromLag(lagMs, noiseMs = PERF_BUDGETS.dropoutNoiseMs) {
  return Math.max(0, lagMs - noiseMs)
}

/**
 * The clock only advances once per output callback, and both ends of the
 * measurement can be off by one, so the noise floor grows with the buffer:
 * two buffers plus margin, never below dropoutNoiseMs.
 */
export function noiseFloorMs(baseLatencyMs) {
  const buffer = Number.isFinite(baseLatencyMs) ? baseLatencyMs : 0
  return Math.max(PERF_BUDGETS.dropoutNoiseMs, 2 * buffer + 10)
}

export function perMinute(value, elapsedMs) {
  if (!(elapsedMs > 0)) return 0
  return value / (elapsedMs / 60000)
}

/** perMinute, rounded to 0.1, or null while there's too little data to trust. */
export function ratePerMinute(value, elapsedMs, minMs = PERF_BUDGETS.minRateWindowMs) {
  if (!(elapsedMs >= minMs)) return null
  return Math.round(perMinute(value, elapsedMs) * 10) / 10
}

// ── Device ─────────────────────────────────────────────────────────────────

/** Coarse class of a WebGL UNMASKED_RENDERER string. */
export function classifyGpu(renderer) {
  const r = String(renderer ?? '').toLowerCase()
  if (!r) return 'unknown'
  // Chrome's blocklisted-driver fallbacks: every paint and composite on the CPU.
  if (/swiftshader|llvmpipe|basic render|software|softpipe|microsoft basic/.test(r)) return 'software'
  if (/nvidia|geforce|quadro|rtx|radeon rx|radeon pro|\brx \d/.test(r)) return 'discrete'
  if (/apple|intel|uhd|iris|hd graphics|adreno|mali|powervr|radeon(\(tm\))? graphics|vega \d/.test(r)) return 'integrated'
  return 'unknown'
}

// ── Verdict + field profile ────────────────────────────────────────────────

/**
 * Judge a report against PERF_BUDGETS. Issues are ordered by what a listener
 * notices first; `verdict` is the worst, or 'ok'.
 */
export function perfVerdict(report, budgets = PERF_BUDGETS) {
  const issues = []
  const a = report.audio ?? {}
  const u = report.ui ?? {}
  if ((a.dropoutMsPerMin ?? 0) > budgets.dropoutMsPerMin) issues.push('audio-dropouts')
  if ((a.lateTicksPerMin ?? 0) >= budgets.lateTicksPerMin) issues.push('late-notes')
  if ((u.p95 ?? 0) > budgets.frameP95Ms || (u.longFramesPerMin ?? 0) > budgets.longFramesPerMin) issues.push('janky-ui')
  if (report.device?.gpuClass === 'software') issues.push('software-gpu')
  return { verdict: issues[0] ?? 'ok', issues }
}

const round1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '-')
const intOr = v => (Number.isFinite(v) ? Math.round(v) : '-')

/**
 * One line, at most 255 characters (Vercel Analytics' value limit, and Pro
 * allows only two properties per event): enough to group sessions by device
 * class and see what failed. The full JSON stays in the on-device HUD.
 */
export function packProfile(report) {
  const d = report.device ?? {}
  const a = report.audio ?? {}
  const u = report.ui ?? {}
  const w = report.workload ?? {}
  const parts = [
    'v1',
    `os:${d.os ?? '-'}`, `br:${d.browser ?? '-'}`,
    `c:${d.cores ?? '-'}`, `m:${d.memoryGb ?? '-'}`, `gpu:${d.gpuClass ?? '-'}`,
    `bat:${d.charging == null ? '-' : d.charging ? 'ac' : 'bat'}`,
    `sr:${a.sampleRate ? Math.round(a.sampleRate / 1000) : '-'}`,
    `lh:${(a.latencyHint ?? '-').slice(0, 4)}`, `bl:${a.baseLatencyMs ?? '-'}`,
    `lanes:${w.activeLanes ?? '-'}`, `wk:${w.workletLanes ?? '-'}`, `view:${w.view ?? '-'}`,
    `play:${intOr((report.playMs ?? 0) / 1000)}s`,
    `drop:${round1(a.dropoutMsPerMin)}`, `late:${round1(a.lateTicksPerMin)}`, `st:${intOr(a.startStallMs)}`,
    `fps:${u.fps ?? '-'}`, `p95:${u.p95 ?? '-'}`, `lf:${round1(u.longFramesPerMin)}`,
    `blk:${intOr(u.blockingMsPerMin)}`,
  ]
  return parts.join(' ').slice(0, 255)
}
