#!/usr/bin/env node
// Builds the Phase 0 map workloads from the committed city presets (7ec8c80).
//
//   node digital-product/design/design-plans/map-view/implementation-2026-11-04/validation/build-fixtures.mjs
//
// Each fixture is a city-preset-shaped file ({name, cityId, state}) that capture.mjs
// serves in place of /presets/<city>.json, so the app loads it through its own
// "Load city preset" path (MixerTab.applyPreset). No product code is involved.
//
// Lane selection is deterministic: the preset's own lanes first, then the
// remaining routes ordered by type (metro, tram, hev, trolley, bus), then by most
// stops, then id. Added lanes copy every per-track setting of preset lane i % n,
// so instruments, effects, sends and tempo stay fixed between runs.
//
// Signed out, the Free plan caps audible lanes at 6 (FREE_LIMITS.activeLanes).
// The 24-lane fixture therefore carries 24 mapped lanes with the first 6 enabled
// and the other 18 disabled (dashed previews). 24 *audible* lanes need a Pro or
// superadmin session; record that gap rather than claim it was measured.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../../../../..')
const outDir = path.join(here, 'fixtures')
fs.mkdirSync(outDir, { recursive: true })

const TYPE_ORDER = ['metro', 'tram', 'hev', 'trolley', 'bus']
const AUDIBLE_CAP = 6

function build(cityId, laneCount) {
  const preset = JSON.parse(fs.readFileSync(path.join(root, `public/presets/${cityId}.json`), 'utf8'))
  const lines = JSON.parse(fs.readFileSync(path.join(root, `public/data/lines.${cityId}.slim.json`), 'utf8'))
  const state = structuredClone(preset.state)
  const base = state.routeIds
  const extra = lines.routes
    .filter(r => !base.includes(r.id) && r.stops?.length >= 2)
    .sort((a, b) => (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
      || (b.stops.length - a.stops.length) || a.id.localeCompare(b.id))
    .slice(0, laneCount - base.length)
  if (base.length + extra.length < laneCount) throw new Error(`${cityId}: only ${base.length + extra.length} routes`)

  const perTrackKeys = Object.keys(state).filter(k => {
    const v = state[k]
    return v && typeof v === 'object' && !Array.isArray(v) && base.some(id => id in v)
  })
  extra.forEach((r, i) => {
    const src = base[i % base.length]
    for (const k of perTrackKeys) if (src in state[k]) state[k][r.id] = structuredClone(state[k][src])
    state.laneManifest.push({ id: r.id, sourceId: null, kind: 'base' })
  })
  state.routeIds = [...base, ...extra.map(r => r.id)]
  state.routeIds.forEach((id, i) => { state.muted[id] = i >= AUDIBLE_CAP })
  state.soloRoutes = []
  // Labels would collide with copied names; keep them only on the preset's lanes.
  if (state.trackLabels) for (const r of extra) delete state.trackLabels[r.id]

  const fixture = { name: `Phase 0 ${cityId} ${laneCount} lanes`, cityId, state }
  const file = path.join(outDir, `${cityId}-${laneCount}.json`)
  fs.writeFileSync(file, JSON.stringify(fixture, null, 1))
  const lanes = state.routeIds.map(id => {
    const r = lines.routes.find(x => x.id === id)
    return `${r.name}(${r.type},${r.stops.length}${state.muted[id] ? ',off' : ''})`
  })
  console.log(`${path.relative(root, file)}: ${state.routeIds.length} lanes, ${state.routeIds.filter(id => !state.muted[id]).length} enabled, ${state.bpm} BPM`)
  console.log(`  ${lanes.join(' ')}`)
}

for (const city of ['berlin', 'newyork']) for (const n of [6, 24]) build(city, n)
