import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PERF_BUDGETS, parseLatencyHint, createHistogram, histAdd, histPercentile, summarizeFrames,
  dropoutFromLag, perMinute, ratePerMinute, noiseFloorMs, classifyGpu, perfVerdict, packProfile, HIST_MAX_MS,
} from '../lib/perfStats.js'

const healthy = {
  device: { os: 'win', browser: 'chrome', cores: 4, memoryGb: 8, gpuClass: 'integrated', charging: false },
  workload: { activeLanes: 6, workletLanes: 0, view: 'daw' },
  playMs: 61_000,
  audio: { sampleRate: 48000, latencyHint: 'interactive', baseLatencyMs: 10, dropoutMsPerMin: 0, lateTicksPerMin: 0 },
  ui: { fps: 60, p95: 17, longFramesPerMin: 0, blockingMsPerMin: 0 },
}


test('parseLatencyHint accepts the three Web Audio hints only', () => {
  assert.equal(parseLatencyHint('playback'), 'playback')
  assert.equal(parseLatencyHint(' Balanced '), 'balanced')
  assert.equal(parseLatencyHint('interactive'), 'interactive')
  assert.equal(parseLatencyHint('default'), null)
  assert.equal(parseLatencyHint('0.05'), null)
  assert.equal(parseLatencyHint(null), null)
})

test('histogram percentiles and frame summary', () => {
  const h = createHistogram()
  for (let i = 0; i < 95; i++) histAdd(h, 16.7)
  for (let i = 0; i < 5; i++) histAdd(h, 120)
  assert.equal(histPercentile(h, 0.5), 17)
  assert.equal(histPercentile(h, 0.95), 17)
  assert.equal(histPercentile(h, 0.96), 120)
  const s = summarizeFrames(h)
  assert.equal(s.frames, 100)
  assert.equal(s.max, 120)
  assert.equal(s.fps, Math.round(1000 / ((95 * 16.7 + 5 * 120) / 100)))
})

test('histogram clamps outliers into the last bucket and ignores junk', () => {
  const h = createHistogram()
  histAdd(h, 5000)
  histAdd(h, NaN)
  histAdd(h, -1)
  assert.equal(h.count, 1)
  assert.equal(histPercentile(h, 1), HIST_MAX_MS)
  assert.equal(summarizeFrames(createHistogram()).p95, null)
})

test('clock lag below the noise floor is not a dropout', () => {
  assert.equal(dropoutFromLag(10), 0)
  assert.equal(dropoutFromLag(-5), 0)
  assert.equal(dropoutFromLag(PERF_BUDGETS.dropoutNoiseMs + 70), 70)
  assert.equal(perMinute(30, 30_000), 60)
  assert.equal(perMinute(30, 0), 0)
})

test('the noise floor grows with the output buffer', () => {
  assert.equal(noiseFloorMs(null), PERF_BUDGETS.dropoutNoiseMs)
  assert.equal(noiseFloorMs(10), PERF_BUDGETS.dropoutNoiseMs)   // 'interactive'
  assert.equal(noiseFloorMs(23), 56)                             // 'playback' in Chrome
})

test('rates stay null until there is enough data to trust', () => {
  // The case that falsely failed a healthy session: 15 ms in the first 14 s.
  assert.equal(ratePerMinute(15, 14_000), null)
  assert.equal(ratePerMinute(15, 30_000), 30)
  assert.equal(ratePerMinute(1, 60_000), 1)
  assert.equal(perfVerdict({ ...healthy, audio: { ...healthy.audio, dropoutMsPerMin: null, lateTicksPerMin: null } }).verdict, 'ok')
})

test('classifyGpu spots software rendering and common laptop GPUs', () => {
  assert.equal(classifyGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'software')
  assert.equal(classifyGpu('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)'), 'software')
  assert.equal(classifyGpu('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'integrated')
  assert.equal(classifyGpu('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'integrated')
  assert.equal(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11)'), 'discrete')
  assert.equal(classifyGpu('Apple M4 Pro'), 'integrated')
  assert.equal(classifyGpu(''), 'unknown')
})

test('perfVerdict orders issues by what a listener notices first', () => {
  assert.deepEqual(perfVerdict(healthy), { verdict: 'ok', issues: [] })
  const bad = {
    ...healthy,
    device: { ...healthy.device, gpuClass: 'software' },
    audio: { ...healthy.audio, dropoutMsPerMin: 500, lateTicksPerMin: 3 },
    ui: { ...healthy.ui, p95: 120 },
  }
  assert.deepEqual(perfVerdict(bad), {
    verdict: 'audio-dropouts',
    issues: ['audio-dropouts', 'late-notes', 'janky-ui', 'software-gpu'],
  })
  // Long frames alone are enough to call the UI slow.
  assert.equal(perfVerdict({ ...healthy, ui: { ...healthy.ui, longFramesPerMin: 30 } }).verdict, 'janky-ui')
  // Exactly on budget passes.
  assert.equal(perfVerdict({ ...healthy, audio: { ...healthy.audio, dropoutMsPerMin: PERF_BUDGETS.dropoutMsPerMin } }).verdict, 'ok')
})

test('packProfile fits one analytics value and survives missing fields', () => {
  const p = packProfile(healthy)
  assert.ok(p.startsWith('v1 os:win br:chrome c:4 m:8 gpu:integrated bat:bat sr:48 lh:inte bl:10'))
  assert.match(p, /lanes:6 wk:0 view:daw play:61s drop:0 late:0 st:- fps:60 p95:17/)
  assert.ok(p.length <= 255)
  const empty = packProfile({})
  assert.ok(empty.startsWith('v1 os:- br:-'))
  assert.ok(empty.length <= 255)
  const huge = packProfile({ ...healthy, device: { ...healthy.device, os: 'x'.repeat(400) } })
  assert.equal(huge.length, 255)
})
