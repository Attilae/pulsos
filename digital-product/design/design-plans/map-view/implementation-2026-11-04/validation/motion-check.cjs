// Phase 3 motion gate: bounded rings, reduced motion (map toggle and OS
// setting) switched while playing, rapid stop/start, a hidden tab and dense
// attacks. Reads window.leidMapFx.stats() (MapView) to confirm no layers,
// timers or ticker subscribers are left behind.
//
//   NODE_PATH=<dir>/node_modules node motion-check.cjs [outDir] [url]
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const OUT = path.resolve(__dirname, process.argv[2] ?? 'screenshots-phase3'); fs.mkdirSync(OUT, { recursive: true })
const FIX = path.join(__dirname, 'fixtures')
const URL_ = process.argv[3] ?? 'http://localhost:3011/'
const log = (...a) => console.log(...a)
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`) }
const viewToggle = (page, l) => page.locator('button[aria-pressed]:visible').filter({ hasText: new RegExp(`^${l}$`) }).first()
const stats = page => page.evaluate(() => window.leidMapFx?.stats?.() ?? null)
const sleep = (page, ms) => page.waitForTimeout(ms)

async function load(page, fixture) {
  const [city] = fixture.split('-')
  const body = fs.readFileSync(path.join(FIX, `${fixture}.json`), 'utf8')
  await page.route(`**/presets/${city}.json`, r => r.fulfill({ status: 200, contentType: 'application/json', body }))
  await page.addInitScript(([c]) => {
    localStorage.setItem('transit-daw:tourStatus', 'skipped'); localStorage.setItem('leid-intro-seen', '1'); localStorage.setItem('leid-theme', 'dark')
    localStorage.removeItem('leid-reduce-motion')
    if (sessionStorage.getItem('p3')) return; sessionStorage.setItem('p3', '1'); localStorage.setItem('leid.cityId', c)
  }, [city === 'berlin' ? 'budapest' : 'berlin'])
  await page.goto(URL_)
  const sel = page.locator('select[aria-label="City"]:visible').first(); await sel.waitFor({ timeout: 90_000 }); await sleep(page, 1500)
  await sel.selectOption(city); await page.getByRole('button', { name: /Load city preset/ }).click()
  await page.getByRole('dialog', { name: /Start in/ }).waitFor({ state: 'detached', timeout: 30_000 })
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
  await viewToggle(page, 'Map').click(); await sleep(page, 4000)
}
const play = page => page.getByRole('button', { name: 'Play', exact: true }).first().click()
const stop = page => page.getByRole('button', { name: 'Stop', exact: true }).first().click()
// Max of each stat over a window, sampled every 50ms.
async function sampleMax(page, ms) {
  return page.evaluate(ms => new Promise(res => {
    const max = {}; const t0 = performance.now()
    const tick = () => {
      const s = window.leidMapFx.stats(); s.ringNodes = document.querySelectorAll('.map-ring').length
      for (const k in s) max[k] = Math.max(max[k] ?? 0, s[k])
      if (performance.now() - t0 < ms) setTimeout(tick, 50); else res(max)
    }
    tick()
  }), ms)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await load(page, 'berlin-6')
  const idle = await stats(page)
  check('stopped: no dynamic map work', idle.heads === 0 && idle.ringLayers === 0 && idle.pendingTimers === 0 && idle.currentStops === 0, JSON.stringify(idle))
  const baseSubs = idle.tickerSubscribers

  // ── Full motion ──
  await play(page); await sleep(page, 3000)
  const full = await sampleMax(page, 6000)
  check('playing: heads move, rings appear', full.heads > 0 && full.rings > 0, JSON.stringify(full))
  check('rings capped at 8 (layers and DOM)', full.rings <= 8 && full.ringLayers <= 8 && full.ringNodes <= 8)
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.1 })
  await sleep(page, 400); await page.screenshot({ path: path.join(OUT, 'rings_10pct.png') })
  const slow = await page.evaluate(() => [...document.querySelectorAll('.map-ring span')].flatMap(n => n.getAnimations()).map(a => Math.round(a.effect.getTiming().duration)))
  check('ring animations are 220ms each', slow.length > 0 && slow.every(d => d === 220), `${slow.length} running at 10%`)
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 })
  const loops = await page.evaluate(() => document.getAnimations().filter(a => a.effect?.getTiming?.().iterations === Infinity && a.effect?.target?.closest?.('.map-wrapper')).length)
  check('no infinite CSS loops on the map', loops === 0, `${loops}`)

  // ── Reduce motion via the map toggle, while playing ──
  await page.getByRole('button', { name: 'Reduce motion' }).click(); await sleep(page, 1500)
  const red = await sampleMax(page, 3000)
  const redNow = await stats(page)
  check('reduced: no heads, trails or rings', red.heads === 0 && red.ringLayers === 0 && red.ringNodes === 0, JSON.stringify(red))
  check('reduced: static current-stop markers shown', redNow.currentStops > 0, `${redNow.currentStops}`)
  // Count marker moves: at most 2 changes per second (+1 for window edges).
  const moves = await page.evaluate(() => new Promise(res => {
    const pane = document.querySelector('.leaflet-playhead-pane'); let n = 0
    const times = []
    const mo = new MutationObserver(recs => { const t = Math.round(performance.now()); if (!times.includes(t)) { times.push(t); n++ } })
    mo.observe(pane, { subtree: true, attributes: true, attributeFilter: ['d'] })
    setTimeout(() => { mo.disconnect(); res({ n, times }) }, 4000)
  }))
  check('reduced: current stops change at most twice a second', moves.n <= 9, `${moves.n} update batches in 4s`)
  await page.screenshot({ path: path.join(OUT, 'reduced_current_stops.png') })
  check('reduced: ticker subscriber removed', redNow.tickerSubscribers < full.tickerSubscribers, `${redNow.tickerSubscribers} vs ${full.tickerSubscribers}`)
  await page.getByRole('button', { name: 'Reduce motion' }).click(); await sleep(page, 1500)
  const back = await stats(page)
  check('toggle off: heads return, current stops cleared', back.heads > 0 && back.currentStops === 0, JSON.stringify(back))

  // ── OS setting while playing ──
  await page.emulateMedia({ reducedMotion: 'reduce' }); await sleep(page, 1200)
  const os = await stats(page)
  const btn = await page.getByRole('button', { name: 'Reduce motion' }).evaluate(b => [b.disabled, b.getAttribute('aria-pressed')])
  check('OS reduce applies live and locks the toggle on', os.heads === 0 && btn[0] === true && btn[1] === 'true', JSON.stringify({ os, btn }))
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await sleep(page, 1200)
  check('OS reduce off: motion returns', (await stats(page)).heads > 0)

  // ── Hidden tab (visibilitychange) ──
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(page, 600)
  const hid = await stats(page)
  check('hidden tab: no subscriptions, timers or layers', hid.heads === 0 && hid.ringLayers === 0 && hid.pendingTimers === 0 && hid.tickerSubscribers <= full.tickerSubscribers - 1, JSON.stringify(hid))
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
  await sleep(page, 50)
  const ret = await stats(page)
  check('return: no historical rings replayed', ret.rings === 0, JSON.stringify(ret))
  await sleep(page, 1500)
  check('return: current phase drawn', (await stats(page)).heads > 0)

  // ── Dense attacks: 240 BPM ──
  // BPM is locked while playing: stop, set it, play.
  const bpm = page.locator('#mixer-bpm')
  if (await bpm.count()) {
    await stop(page); await sleep(page, 300)
    await bpm.fill('240'); await bpm.press('Enter'); await play(page); await sleep(page, 2000)
    const dense = await sampleMax(page, 6000)
    check('dense (240 BPM): rings stay capped', dense.rings <= 8 && dense.ringNodes <= 8 && dense.pendingTimers <= 8, JSON.stringify(dense))
    await stop(page); await sleep(page, 300)
    await bpm.fill('128'); await bpm.press('Enter'); await play(page); await sleep(page, 1500)
  } else check('dense: BPM input found', false)

  // ── Rapid stop/start ──
  for (let i = 0; i < 10; i++) { await stop(page); await sleep(page, 120); await play(page); await sleep(page, 120) }
  await sleep(page, 1500)
  const after = await stats(page)
  check('rapid stop/start: one head per line, no extra subscribers', after.heads <= full.heads && after.tickerSubscribers <= full.tickerSubscribers, JSON.stringify(after))
  await stop(page); await sleep(page, 800)
  const end = await stats(page)
  check('stopped again: everything cleared', end.heads === 0 && end.ringLayers === 0 && end.pendingTimers === 0 && end.currentStops === 0 && end.tickerSubscribers === baseSubs, JSON.stringify(end))
  // ── Focus card enter/exit (160ms in, 100ms out) ──
  await page.locator('button.map-lane').first().click(); await sleep(page, 300)
  const anim = await page.locator('.map-focus').evaluate(el => getComputedStyle(el).animationName + ' ' + getComputedStyle(el).animationDuration)
  // Checked in-page: the 100ms exit is shorter than a Playwright round trip.
  const leaving = await page.evaluate(() => new Promise(res => {
    [...document.querySelectorAll('.map-focus button')].find(b => b.textContent === 'Clear focus').click()
    setTimeout(() => res(document.querySelectorAll('.map-focus--leaving').length), 30)
  }))
  await sleep(page, 250)
  const gone = await page.locator('.map-focus').count()
  check('focus card fades in (160ms) and out (100ms), then unmounts', anim === 'map-focus-in 0.16s' && leaving === 1 && gone === 0, `${anim}; leaving ${leaving}; after ${gone}`)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  const failed = results.filter(r => !r.ok).length
  log(`\n${results.length - failed}/${results.length} passed`)
  await browser.close()
  process.exit(failed ? 1 : 0)
})()
