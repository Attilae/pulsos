#!/usr/bin/env node
// Phase 0 screenshot capture for the map view.
//
//   node capture.mjs --url http://localhost:3011/ [--only berlin-6] [--out screenshots]
//
// Needs Playwright (not a project dependency) and Google Chrome. Install
// Playwright anywhere outside the repo and point NODE_PATH at it, e.g.
//   (cd /tmp/pw && npm i playwright@1.56.1) && NODE_PATH=/tmp/pw/node_modules node capture.mjs
//
// For each fixture (see build-fixtures.mjs) the script serves the fixture in place
// of /presets/<city>.json, starts on a different city, picks the target city and
// chooses "Load city preset", so the song goes through the app's own preset path.
// It then shows the map and captures three states: all-off, stopped with the
// fixture's lanes enabled, and playing (after a few seconds of playback).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1]])
  return acc
}, []))
const URL_ = args.url ?? 'http://localhost:3011/'
const OUT = path.resolve(here, args.out ?? 'screenshots')
const ONLY = args.only ? args.only.split(',') : null
const THEMES = (args.themes ?? 'dark,light').split(',')
const VIEWPORTS = Object.entries({
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180, isMobile: false, hasTouch: true },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
}).filter(([k]) => !args.viewports || args.viewports.split(',').includes(k))
const FIXTURES = (args.fixtures ?? 'berlin-6,newyork-6').split(',').filter(f => !ONLY || ONLY.includes(f))
fs.mkdirSync(OUT, { recursive: true })

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  log('  saved', path.relative(here, file))
}

// Geometry of the map and its overlays, so sizing/placement findings are numbers.
async function probe(page) {
  return page.evaluate(() => {
    const box = sel => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visibility: cs.visibility, pointerEvents: cs.pointerEvents }
    }
    return {
      viewport: { w: innerWidth, h: innerHeight },
      wrapper: box('.map-wrapper'),
      container: box('.map-container'),
      leaflet: box('.leaflet-container'),
      maplibreCanvas: box('.leaflet-container canvas.maplibregl-canvas') ?? box('.maplibregl-canvas'),
      // New markup first (phase 1+), then the 7ec8c80 baseline selectors.
      legend: box('.map-panel') ?? box('.map-lanes-disclosure') ?? box('.map-track-status'),
      zoom: box('.map-controls') ?? box('.leaflet-control-zoom'),
      attribution: box('.map-attribution') ?? box('.leaflet-control-attribution'),
      notice: box('.map-notices'),
      routePaths: document.querySelectorAll('.leaflet-overlay-pane path').length,
      routeCanvases: document.querySelectorAll('.leaflet-overlay-pane canvas').length,
      markers: document.querySelectorAll('.leaflet-marker-pane > *').length,
      center: window.__leidMap?.getCenter?.() ?? null,
    }
  })
}

async function loadFixture(page, fixture, viewportName, theme) {
  const [city] = fixture.split('-')
  const startCity = city === 'berlin' ? 'budapest' : 'berlin'
  const body = fs.readFileSync(path.join(here, 'fixtures', `${fixture}.json`), 'utf8')
  await page.route(`**/presets/${city}.json`, r => r.fulfill({ status: 200, contentType: 'application/json', body }))
  await page.addInitScript(([c]) => {
    if (sessionStorage.getItem('phase0-init')) return
    sessionStorage.setItem('phase0-init', '1')
    localStorage.setItem('leid.cityId', c)
  }, [startCity])
  await page.goto(URL_)
  // Wait for the picker to render; only the phone layout may hide it behind a menu.
  // (Checking count() straight after goto can race hydration and open the header drawer.)
  if (viewportName === 'phone') {
    await page.locator('.mtransport-view').waitFor({ timeout: 60_000 })
    if (!(await page.locator('select[aria-label="City"]:visible').count())) await page.getByRole('button', { name: /more|menu/i }).first().click()
  }
  const select = page.locator('select[aria-label="City"]:visible').first()
  await select.waitFor({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  await select.selectOption(city)
  await page.getByRole('button', { name: /Load city preset/ }).click()
  await page.getByRole('dialog', { name: /Start in/ }).waitFor({ state: 'detached', timeout: 30_000 })
  await page.keyboard.press('Escape').catch(() => {})
  // The stored theme now survives dev StrictMode (ThemeContext reads storage
  // first); this check only guards against a regression.
  const applied = await page.evaluate(() => document.documentElement.dataset.theme)
  if (applied !== theme) log(`  WARNING: theme ${applied}, expected ${theme}`)
  // Hide the Next dev-mode indicator so it doesn't cover controls in screenshots.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
  await page.waitForTimeout(viewportName === 'phone' ? 2500 : 1500)
}

// The view toggle: aria-pressed buttons in the desktop header, role=tab in the phone transport bar.
// (A plain "Map" role lookup would hit the top-level Map tab instead.)
const viewToggle = (page, label) => page
  .locator('.mtransport-view button:visible, button[aria-pressed]:visible')
  .filter({ hasText: new RegExp(`^${label}$`) }).first()

async function showMap(page) {
  await viewToggle(page, 'Map').click()
  await page.waitForTimeout(4000) // tiles + detail polylines
}

// Lane toggles live in the lane view (DAW on desktop/tablet, Lanes on phone), not on the map.
// Disabling records which lanes were on; enabling restores exactly that set (the lane view
// groups lanes by type, so "the first six buttons" is not the fixture's audible set).
async function setLanes(page, vpName, restore = null) {
  const laneView = vpName === 'phone' ? 'Lanes' : 'DAW'
  await viewToggle(page, laneView).click()
  await page.waitForTimeout(800)
  const wasOn = []
  for (const b of await page.locator('button[aria-label^="Enable "]').all()) {
    if (!(await b.isVisible())) continue
    const label = await b.getAttribute('aria-label')
    const pressed = (await b.getAttribute('aria-pressed')) === 'true'
    if (pressed) wasOn.push(label)
    const want = restore ? restore.includes(label) : false
    if (pressed !== want) { await b.click(); await page.waitForTimeout(80) }
  }
  log(`  ${restore ? `restored ${restore.length}` : `disabled ${wasOn.length}`} lanes`)
  await showMap(page)
  return wasOn
}

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] })
  const report = []
  for (const fixture of FIXTURES) for (const theme of THEMES) for (const [vpName, vp] of VIEWPORTS) {
    const tag = `${fixture}_${theme}_${vpName}`
    log(tag)
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 2 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
    await page.addInitScript(([t]) => {
      localStorage.setItem('transit-daw:tourStatus', 'skipped')
      localStorage.setItem('leid-intro-seen', '1')
      localStorage.setItem('leid-theme', t)
    }, [theme])
    const entry = { tag, states: {} }
    try {
      await loadFixture(page, fixture, vpName, theme)
      await showMap(page)
      await shot(page, `${tag}_stopped`)
      entry.states.stopped = await probe(page)

      const audible = await setLanes(page, vpName)
      await shot(page, `${tag}_alloff`)
      entry.states.alloff = await probe(page)
      await setLanes(page, vpName, audible)

      await page.getByRole('button', { name: 'Play', exact: true }).first().click()
      await page.waitForTimeout(6000)
      await shot(page, `${tag}_playing`)
      entry.states.playing = await probe(page)
      await page.getByRole('button', { name: 'Stop', exact: true }).first().click().catch(() => {})
    } catch (e) {
      entry.failure = String(e.message).split('\n')[0]
      log('  FAILED', entry.failure)
      await shot(page, `${tag}_FAILED`).catch(() => {})
    }
    entry.errors = [...new Set(errors)].slice(0, 10)
    report.push(entry)
    await ctx.close()
  }
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(report, null, 1))
  log('wrote', path.relative(here, path.join(OUT, 'probe.json')))
}

await run()
