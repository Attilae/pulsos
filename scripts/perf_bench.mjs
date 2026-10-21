#!/usr/bin/env node
// Playback performance benchmark: plays the real app headlessly and reports the
// two budgets that fail on slow laptops (docs/performance-audit-2026-10-21.md):
//
//   audio  render capacity: the share of each audio deadline the graph used,
//          read from Chrome DevTools' WebAudio domain (mean and max %);
//   ui     frame times and Long Animation Frames while playing, optionally with
//          the main thread slowed by --cpu (DevTools CPU throttling).
//
// Playwright is not a project dependency. Install it without saving
// (package.json and the lockfile stay untouched), or have it installed globally:
//   npm i --no-save playwright@1.56.1
//   node scripts/perf_bench.mjs --url http://localhost:3000/
// Serve a production build (npm run build && npm run start); dev mode is slower.
//
// Options: --url, --lanes 6, --view daw|map, --cpu 1, --secs 10,
//          --latency default|interactive|balanced|playback, --runs 1
// Numbers are relative to the machine running them. Compare a change against
// its base on the same machine, and repeat runs: audio readings on shared cloud
// VMs wander by about ±5 points.

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]])
  return acc
}, []))
const opt = {
  url: args.url ?? 'http://localhost:3000/',
  lanes: Number(args.lanes ?? 6),
  view: args.view ?? 'daw',
  cpu: Number(args.cpu ?? 1),
  secs: Number(args.secs ?? 10),
  latency: args.latency ?? 'default',
  runs: Number(args.runs ?? 1),
}

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  // Fall back to a global install (ESM imports don't search the global root).
  try {
    const { execSync } = await import('node:child_process')
    const { pathToFileURL } = await import('node:url')
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
    const mod = await import(pathToFileURL(`${root}/playwright/index.mjs`).href)
    chromium = mod.chromium ?? mod.default?.chromium
  } catch {
    console.error('perf_bench needs Playwright: npm i --no-save playwright@1.56.1')
    process.exit(1)
  }
}

async function run() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => {
    // Skip the onboarding tour and first-run notice.
    localStorage.setItem('transit-daw:tourStatus', 'skipped')
    localStorage.setItem('leid-intro-seen', '1')
    window.__bench = { loaf: [], frames: [] }
    try {
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__bench.loaf.push({ d: e.duration, b: e.blockingDuration }) })
        .observe({ type: 'long-animation-frame' })
    } catch {}
  })
  const cdp = await page.context().newCDPSession(page)
  const contexts = []
  cdp.on('WebAudio.contextCreated', e => { if (e.context.contextType === 'realtime') contexts.push(e.context.contextId) })
  await cdp.send('WebAudio.enable')

  const url = new URL(opt.url)
  url.searchParams.set('latency', opt.latency)
  await page.goto(url.toString())
  await page.waitForSelector('button:has-text("Play")', { timeout: 60_000 })
  await page.waitForTimeout(2000)

  // Fresh sessions start with every lane disabled; enable the first N.
  for (const btn of (await page.$$('button[aria-label^="Enable "]')).slice(0, opt.lanes)) {
    await btn.click()
    await page.waitForTimeout(150)
  }
  if (opt.view === 'map') {
    await page.getByRole('button', { name: 'Map', exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(3000)
  }
  if (opt.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.cpu })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(2500)

  await page.evaluate(() => {
    const b = window.__bench
    b.loaf.length = 0
    let last = performance.now()
    const tick = (t) => { b.frames.push(t - last); last = t; if (!b.stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  const capacity = []
  const t0 = Date.now()
  while (Date.now() - t0 < opt.secs * 1000) {
    for (const id of contexts) {
      try { capacity.push((await cdp.send('WebAudio.getRealtimeData', { contextId: id })).realtimeData.renderCapacity) } catch {}
    }
    await page.waitForTimeout(500)
  }
  const ui = await page.evaluate(() => {
    const b = window.__bench
    b.stop = true
    const f = b.frames.slice(1).sort((x, y) => x - y)
    const q = p => (f.length ? Math.round(f[Math.min(f.length - 1, Math.floor(f.length * p))]) : null)
    return {
      fps: f.length ? Math.round(1000 / (f.reduce((s, x) => s + x, 0) / f.length)) : null,
      frameP50: q(0.5), frameP95: q(0.95), frameMax: q(1),
      longFrames: b.loaf.length,
      longFrameMax: Math.round(Math.max(0, ...b.loaf.map(l => l.d))),
      blockingMs: Math.round(b.loaf.reduce((s, l) => s + l.b, 0)),
    }
  })
  await browser.close()
  const mean = capacity.length ? capacity.reduce((s, x) => s + x, 0) / capacity.length : null
  return {
    ...opt,
    audioCapacityMeanPct: mean == null ? null : Math.round(mean * 1000) / 10,
    audioCapacityMaxPct: capacity.length ? Math.round(Math.max(...capacity) * 1000) / 10 : null,
    ...ui,
  }
}

for (let i = 0; i < opt.runs; i++) console.log(JSON.stringify(await run()))
