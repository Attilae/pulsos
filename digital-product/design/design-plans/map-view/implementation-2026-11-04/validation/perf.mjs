#!/usr/bin/env node
// Phase 0 map performance runs against a production build.
//
//   npm run build && npx next start --port 3012     # dev server stopped first (shared .next)
//   NODE_PATH=<dir>/node_modules node perf.mjs --url http://localhost:3012/ \
//     [--fixtures berlin-6,berlin-24,newyork-6,newyork-24] [--runs 3] [--warmup 20] [--secs 60]
//     [--viewport desktop|phone] [--cpu 1] [--trace 1] [--out perf]
//
// Each run opens a fresh headed Chrome window (a real GPU and vsync, unlike headless),
// loads the fixture through "Load city preset", shows the map, presses Play, waits
// `warmup` seconds, resets window.leidPerf and its own counters, then measures for
// `secs` seconds:
//   - window.leidPerf.report(): audio dropouts, late ticks, frame histogram, LoAF (app monitor)
//   - its own rAF frame intervals and Long Animation Frames (same method as perf_bench.mjs)
//   - audio render capacity from DevTools' WebAudio domain, sampled every 500 ms
// With --trace 1, run 1 of each workload also records a 10 s Performance trace into
// traces/ (gitignored), loadable in DevTools' Performance panel.
// Audio is muted at the browser (--mute-audio); the graph still renders in real time.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]])
  return acc
}, []))
const opt = {
  url: args.url ?? 'http://localhost:3012/',
  fixtures: (args.fixtures ?? 'berlin-6,berlin-24,newyork-6,newyork-24').split(','),
  runs: Number(args.runs ?? 3),
  warmup: Number(args.warmup ?? 20),
  secs: Number(args.secs ?? 60),
  viewport: args.viewport ?? 'desktop',
  cpu: Number(args.cpu ?? 1),
  trace: args.trace === '1' || args.trace === 'true',
  out: path.resolve(here, args.out ?? 'perf'),
}
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
}
fs.mkdirSync(opt.out, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const viewToggle = (page, label) => page
  .locator('.mtransport-view button:visible, button[aria-pressed]:visible')
  .filter({ hasText: new RegExp(`^${label}$`) }).first()

async function loadFixture(page, fixture) {
  const [city] = fixture.split('-')
  const body = fs.readFileSync(path.join(here, 'fixtures', `${fixture}.json`), 'utf8')
  await page.route(`**/presets/${city}.json`, r => r.fulfill({ status: 200, contentType: 'application/json', body }))
  await page.addInitScript(([c]) => {
    localStorage.setItem('transit-daw:tourStatus', 'skipped')
    localStorage.setItem('leid-intro-seen', '1')
    localStorage.setItem('leid-theme', 'dark')
    localStorage.setItem('leid.cityId', c)
  }, [city === 'berlin' ? 'budapest' : 'berlin'])
  step = 'goto'; await page.goto(opt.url)
  // Wait for the picker to render; only the phone layout hides it behind a menu.
  // (Checking count() straight after goto raced hydration and opened the header drawer.)
  if (opt.viewport === 'phone') {
    await page.locator('.mtransport-view').waitFor({ timeout: 60_000 })
    if (!(await page.locator('select[aria-label="City"]:visible').count())) await page.getByRole('button', { name: /more|menu/i }).first().click()
  }
  const select = page.locator('select[aria-label="City"]:visible').first()
  step = 'city select'; await select.waitFor({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  await select.selectOption(city)
  step = 'load preset'; await page.getByRole('button', { name: /Load city preset/ }).click()
  await page.getByRole('dialog', { name: /Start in/ }).waitFor({ state: 'detached', timeout: 30_000 })
  await page.waitForTimeout(1500)
  step = 'map view'; await viewToggle(page, 'Map').click()
  await page.waitForTimeout(5000) // tiles + detail polylines
}

let step = ''
async function run(browser, fixture, i) {
  const ctx = await browser.newContext({ ...VIEWPORTS[opt.viewport] })
  const page = await ctx.newPage()
  try { return await measure(browser, ctx, page, fixture, i) } catch (e) {
    const shot = path.join(opt.out, `FAILED_${fixture}_${i + 1}.png`)
    await page.screenshot({ path: shot }).catch(() => {})
    throw new Error(`[${step}] ${String(e.message).split('\n')[0]} (screenshot ${path.basename(shot)})`)
  } finally { await ctx.close().catch(() => {}) }
}

async function measure(browser, ctx, page, fixture, i) {
  await page.addInitScript(() => {
    window.__bench = { loaf: [], frames: [], stop: false }
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__bench.loaf.push({ d: e.duration, b: e.blockingDuration }) })
        .observe({ type: 'long-animation-frame' })
    } catch {}
  })
  const cdp = await ctx.newCDPSession(page)
  const audioContexts = []
  cdp.on('WebAudio.contextCreated', e => { if (e.context.contextType === 'realtime') audioContexts.push(e.context.contextId) })
  await cdp.send('WebAudio.enable')

  await loadFixture(page, fixture)
  const mapped = await page.evaluate(() => ({
    svgPaths: document.querySelectorAll('.leaflet-overlay-pane path').length,
    canvases: document.querySelectorAll('.leaflet-overlay-pane canvas').length,
    legendRows: document.querySelectorAll('.map-track-status .map-status-name').length,
  }))
  if (opt.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.cpu })
  step = 'play'; await page.locator('button[aria-label="Play"]:visible, button:visible:text-is("Play")').first().click()
  await page.waitForTimeout(opt.warmup * 1000)

  await page.evaluate(() => {
    window.leidPerf?.reset()
    const b = window.__bench
    b.loaf.length = 0; b.frames.length = 0
    let last = performance.now()
    const tick = t => { b.frames.push(t - last); last = t; if (!b.stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  let traceFile = null
  if (opt.trace && i === 0) {
    fs.mkdirSync(path.join(here, 'traces'), { recursive: true })
    traceFile = path.join(here, 'traces', `${fixture}_${opt.viewport}_cpu${opt.cpu}.json`)
    await browser.startTracing(page, { path: traceFile, screenshots: false })
  }
  const capacity = []
  const t0 = Date.now()
  let traced = !traceFile
  while (Date.now() - t0 < opt.secs * 1000) {
    for (const id of audioContexts) {
      try { capacity.push((await cdp.send('WebAudio.getRealtimeData', { contextId: id })).realtimeData.renderCapacity) } catch {}
    }
    if (!traced && Date.now() - t0 > 10_000) { await browser.stopTracing(); traced = true }
    await page.waitForTimeout(500)
  }
  if (!traced) await browser.stopTracing()

  const bench = await page.evaluate(() => {
    const b = window.__bench
    b.stop = true
    const f = b.frames.slice(1).sort((x, y) => x - y)
    const q = p => (f.length ? +f[Math.min(f.length - 1, Math.floor(f.length * p))].toFixed(1) : null)
    return {
      frames: f.length,
      fps: f.length ? Math.round(1000 / (f.reduce((s, x) => s + x, 0) / f.length)) : null,
      frameP50: q(0.5), frameP95: q(0.95), frameP99: q(0.99), frameMax: q(1),
      over33ms: f.filter(x => x > 33.4).length,
      longFrames: b.loaf.length,
      longFrameMax: Math.round(Math.max(0, ...b.loaf.map(l => l.d))),
      blockingMs: Math.round(b.loaf.reduce((s, l) => s + l.b, 0)),
    }
  })
  const leid = await page.evaluate(() => window.leidPerf?.report() ?? null)
  await page.locator('button[aria-label="Stop"]:visible, button:visible:text-is("Stop")').first().click().catch(() => {})
  const mean = capacity.length ? capacity.reduce((s, x) => s + x, 0) / capacity.length : null
  const sorted = [...capacity].sort((a, b) => a - b)
  return {
    fixture, run: i + 1, viewport: opt.viewport, cpu: opt.cpu, warmupSec: opt.warmup, secs: opt.secs,
    mapped,
    audioCapacity: {
      samples: capacity.length,
      meanPct: mean == null ? null : +(mean * 100).toFixed(1),
      p95Pct: sorted.length ? +(sorted[Math.floor(sorted.length * 0.95)] * 100).toFixed(1) : null,
      maxPct: sorted.length ? +(sorted.at(-1) * 100).toFixed(1) : null,
    },
    bench,
    leidPerf: leid,
    trace: traceFile && path.relative(here, traceFile),
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const file = path.join(opt.out, `${opt.viewport}_cpu${opt.cpu}_${stamp}.jsonl`)
log(`writing ${path.relative(here, file)} · ${os.cpus()[0].model} · chrome ${browser.version()}`)
for (const fixture of opt.fixtures) {
  for (let i = 0; i < opt.runs; i++) {
    try {
      const r = await run(browser, fixture, i)
      fs.appendFileSync(file, JSON.stringify(r) + '\n')
      log(fixture, `run ${i + 1}`, `fps ${r.bench.fps} p95 ${r.bench.frameP95}ms LoAF ${r.bench.longFrames}`,
        `audio ${r.audioCapacity.meanPct}% (max ${r.audioCapacity.maxPct})`,
        `dropout ${r.leidPerf?.audio?.dropoutMs}ms late ${r.leidPerf?.audio?.lateTicks}`, `verdict ${r.leidPerf?.verdict}`)
    } catch (e) {
      log(fixture, `run ${i + 1} FAILED`, String(e.message).split('\n')[0])
      fs.appendFileSync(file, JSON.stringify({ fixture, run: i + 1, failure: String(e.message).split('\n')[0] }) + '\n')
    }
  }
}
await browser.close()
log('done')
