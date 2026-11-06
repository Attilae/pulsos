// Phase 2 interaction check: lane focus, stops, keyboard, line click and the
// phone sheet, and that none of it changes lane enable/solo/volume state.
//
//   NODE_PATH=<dir>/node_modules node focus-check.cjs [outDir] [url]
//
// Needs a running app (dev or prod), Playwright outside the repo and Chrome.
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const OUT = path.resolve(__dirname, process.argv[2] ?? 'screenshots-phase2'); fs.mkdirSync(OUT, { recursive: true })
const FIX = path.join(__dirname, 'fixtures')
const URL_ = process.argv[3] ?? 'http://localhost:3011/'
const log = (...a) => console.log(...a)
const viewToggle = (page, label) => page.locator('.mtransport-view button:visible, button[aria-pressed]:visible').filter({ hasText: new RegExp(`^${label}$`) }).first()

async function load(page, fixture, phone) {
  const [city] = fixture.split('-')
  const body = fs.readFileSync(path.join(FIX, `${fixture}.json`), 'utf8')
  await page.route(`**/presets/${city}.json`, r => r.fulfill({ status: 200, contentType: 'application/json', body }))
  await page.addInitScript(([c]) => {
    localStorage.setItem('transit-daw:tourStatus', 'skipped'); localStorage.setItem('leid-intro-seen', '1'); localStorage.setItem('leid-theme', 'dark')
    if (sessionStorage.getItem('p2')) return; sessionStorage.setItem('p2', '1'); localStorage.setItem('leid.cityId', c)
  }, [city === 'berlin' ? 'budapest' : 'berlin'])
  await page.goto(URL_)
  if (phone) {
    await page.locator('.mtransport-view').waitFor({ timeout: 90_000 })
    if (!(await page.locator('select[aria-label="City"]:visible').count())) await page.getByRole('button', { name: /more|menu/i }).first().click()
  }
  const select = page.locator('select[aria-label="City"]:visible').first()
  await select.waitFor({ timeout: 90_000 }); await page.waitForTimeout(1500)
  await select.selectOption(city)
  await page.getByRole('button', { name: /Load city preset/ }).click()
  await page.getByRole('dialog', { name: /Start in/ }).waitFor({ state: 'detached', timeout: 30_000 })
  await page.keyboard.press('Escape').catch(() => {})
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
  await page.waitForTimeout(1000)
}
// Audio-relevant UI state from the lane view: enable/solo pressed states and volumes.
async function laneState(page, phone) {
  await viewToggle(page, phone ? 'Lanes' : 'DAW').click(); await page.waitForTimeout(600)
  const st = await page.evaluate(() => {
    const q = s => [...document.querySelectorAll(s)].filter(e => e.offsetParent).map(e => `${e.getAttribute('aria-label')}=${e.getAttribute('aria-pressed') ?? e.value}`)
    return [...q('button[aria-label^="Enable "]'), ...q('button[aria-label*="olo"]'), ...q('input[type=range][aria-label*="olume"]')].join('|')
  })
  await viewToggle(page, 'Map').click(); await page.waitForTimeout(2500)
  return st
}
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `${n}.png`) })
const probe = page => page.evaluate(() => ({
  pressed: [...document.querySelectorAll('button.map-lane[aria-pressed="true"]')].map(b => b.getAttribute('aria-label')),
  card: document.querySelector('.map-focus')?.getAttribute('aria-label') ?? null,
  focusPaths: document.querySelectorAll('.leaflet-focus-pane path').length,
  stopMarkers: document.querySelectorAll('.leaflet-focus-pane path.leaflet-interactive').length,
  label: document.querySelector('.map-stop-label')?.textContent ?? null,
  zoom: window.__leidMapZoom ?? null,
  active: document.activeElement?.className + ' ' + (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.slice(0, 30)),
}))

async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  await load(page, 'berlin-6', false)
  await viewToggle(page, 'Map').click(); await page.waitForTimeout(4000)
  const before = await laneState(page, false)
  await page.getByRole('button', { name: 'Play', exact: true }).first().click(); await page.waitForTimeout(2000)

  const rows = page.locator('button.map-lane')
  log('rows', await rows.count(), await rows.first().getAttribute('aria-label'))
  await rows.nth(3).click(); await page.waitForTimeout(500)
  log('A focus row 3', await probe(page)); await shot(page, 'd1_focused')
  await page.getByRole('button', { name: 'Fit route' }).click(); await page.waitForTimeout(1500)
  log('B fit route', await probe(page)); await shot(page, 'd2_fit')
  await page.getByRole('button', { name: 'Zoom in' }).click(); await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Zoom in' }).click(); await page.waitForTimeout(1200)
  log('C zoomed', await probe(page))
  await page.locator('.map-focus-disclosure').click()
  const stops = page.locator('.map-stop'); log('stop list', await stops.count())
  await stops.nth(2).click(); await page.waitForTimeout(600)
  log('D stop selected', await probe(page), await page.locator('.map-focus-stop').textContent()); await shot(page, 'd3_stop')
  // pan away so the stop is offscreen, then Show stop
  const m = page.locator('.leaflet-container'); const b = await m.boundingBox()
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5); await page.mouse.down(); await page.mouse.move(b.x + 50, b.y + 60, { steps: 8 }); await page.mouse.up()
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5); await page.mouse.down(); await page.mouse.move(b.x + 50, b.y + 60, { steps: 8 }); await page.mouse.up()
  await page.waitForTimeout(800)
  const showBtn = page.getByRole('button', { name: 'Show stop' })
  log('E after pan: show stop button', await showBtn.count())
  if (await showBtn.count()) { await showBtn.click(); await page.waitForTimeout(1200); log('F show stop', await probe(page), 'btn', await showBtn.count()); await shot(page, 'd3b_showstop') }
  // keyboard: focus a different lane row with Tab/Enter
  await rows.nth(0).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  log('G keyboard Enter row0', await probe(page)); await shot(page, 'd4_keyboard')
  await page.keyboard.press('Enter'); await page.waitForTimeout(300)
  log('H Enter again toggles off', (await probe(page)).pressed)
  // click on a route line: a point on a non-focused path
  await page.getByRole('button', { name: 'Fit mix' }).click(); await page.waitForTimeout(1500)
  const pt = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive')]
    for (const p of paths) {
      const len = p.getTotalLength(); if (len < 200) continue
      const q = p.getPointAtLength(len * 0.4); const ctm = p.getScreenCTM()
      const x = q.x * ctm.a + ctm.e, y = q.y * ctm.d + ctm.f
      const hit = document.elementFromPoint(x, y)
      if (hit === p) return { x, y, stroke: p.getAttribute('stroke') }
    }
    return null
  })
  log('line point', pt)
  if (pt) { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(500); log('I clicked line', await probe(page)); await shot(page, 'd5_lineclick') }
  await page.getByRole('button', { name: 'Clear focus' }).click(); await page.waitForTimeout(300)
  log('J cleared', await probe(page))
  const playing = await page.getByRole('button', { name: 'Stop', exact: true }).count()
  await page.getByRole('button', { name: 'Stop', exact: true }).first().click().catch(() => {})
  const after = await laneState(page, false)
  log('K still playing during visual actions:', playing > 0, '| lane state unchanged:', before === after, before.length)
  if (before !== after) log('before', before, '\nafter', after)
  log('errors', [...new Set(errors)].slice(0, 6))
  await ctx.close()
}

async function phone(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await load(page, 'berlin-6', true)
  await viewToggle(page, 'Map').click(); await page.waitForTimeout(4000)
  const before = await laneState(page, true)
  await page.locator('.map-lanes-disclosure').tap(); await page.waitForTimeout(600)
  const rows = page.locator('[role=dialog] button.map-lane'); log('P rows in sheet', await rows.count())
  await shot(page, 'p1_sheet')
  await rows.nth(1).tap(); await page.waitForTimeout(800)
  log('P2 sheet open?', await page.locator('[role=dialog]').count(), await probe(page))
  await shot(page, 'p2_chip')
  await page.getByRole('button', { name: 'Fit route' }).tap(); await page.waitForTimeout(1500)
  await shot(page, 'p3_fit')
  log('P3 canvas count', await page.evaluate(() => document.querySelectorAll('.leaflet-container canvas:not(.maplibregl-canvas)').length))
  await page.getByRole('button', { name: 'Clear focus' }).tap(); await page.waitForTimeout(400)
  log('P4 cleared', (await probe(page)).card)
  const after = await laneState(page, true)
  log('P5 lane state unchanged:', before === after)
  log('errors', [...new Set(errors)].slice(0, 6))
  await ctx.close()
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
  try { await desktop(browser) } catch (e) { log('DESKTOP FAIL', e.message.split('\n')[0]) }
  if (!process.env.SKIP_PHONE) try { await phone(browser) } catch (e) { log('PHONE FAIL', e.message.split('\n')[0]) }
  await browser.close()
})()
