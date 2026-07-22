// AI Composer — turns a natural-language prompt into a structured "plan" that
// maps 1:1 onto the existing MixerTab handlers (tempo, harmony, per-track
// instruments, FX buses + sends). The vocabulary is generated from the same
// constants the engine uses, so it never drifts from what the app supports.

import { SYNTH_DEFAULTS, SAMPLER_PRESET_LIST, ARP_STYLES, ARP_RATES } from '../engine.js'
import { FX_BUSES, FX_PARAM_SPECS } from '../fxTrack.js'
import { NOTE_ROOTS, SCALE_TYPES } from '@/components/DawView.jsx'

// Same-origin Next route handler (keeps the OpenRouter key server-side).
const COMPOSE_URL = '/api/compose'

export const SYNTH_TYPES         = Object.keys(SYNTH_DEFAULTS)
const SCALE_TYPE_KEYS            = SCALE_TYPES.map(([k]) => k)
const SAMPLER_PRESET_IDS         = SAMPLER_PRESET_LIST.map(p => p.id)
export const TRACK_SPEEDS        = [0.25, 0.5, 1, 1.5, 2, 3, 4]
export const GRID_RESOLUTIONS    = ['4n', '8n', '8t', '16n', '16t', '32n']
export const PITCH_CONTOURS      = ['geographic', 'randomWalk', 'arch']
export const GRID_TOTAL_CELLS    = 64

// Native ranges, kept in sync with the handlers in MixerTab.jsx / fxTrack.js.
const RANGES = {
  bpm:          [40, 240],
  volume:       [-40, 6],
  masterVolume: [-40, 6],
  pan:          [-1, 1],
  octave:       [-2, 2],
  glide:        [0, 1],
  send:         [0, 1],
  wet:          [0, 1],
  pitchVariety: [0, 1],
}

const clamp = (v, [min, max]) => Math.max(min, Math.min(max, v))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function validHarmony(h) {
  return h && typeof h === 'object' &&
    NOTE_ROOTS.includes(h.root) && SCALE_TYPE_KEYS.includes(h.scaleType)
}
const normHarmony = (h) => ({ root: h.root, scaleType: h.scaleType })

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function fxBusDocs() {
  return FX_BUSES.map(b => {
    const specs  = FX_PARAM_SPECS[b.id] ?? []
    const params = specs.map(s =>
      s.kind === 'enum'
        ? `${s.id} ∈ {${s.values.join(', ')}}`
        : `${s.id} (${s.min}..${s.max}${s.unit ? ' ' + s.unit : ''})`
    )
    return `- "${b.id}" (${b.label})${params.length ? ' — params: ' + params.join('; ') : ''}`
  }).join('\n')
}

function routeDocs(routes) {
  if (!routes?.length) return '(no routes loaded yet)'
  return routes
    .map(r => `- routeId="${r.id}" | name="${r.name ?? r.shortName ?? r.id}" | type=${r.type}`)
    .join('\n')
}

export function buildSystemPrompt(routes, options = {}) {
  const cityName = options.cityName || 'the selected city'
  const maxTracks = Math.max(1, Math.min(routes?.length || 1, options.maxTracks ?? 8))
  return `You are the loop-planning engine for "Leið", a web DAW that turns public transport in ${cityName} into generative music. Each transit line is a track and its stops become notes on a four-bar, 64-cell timeline.

Translate the user's request into one focused, playable loop using only the routes below. The tracks array is the complete active arrangement: listed routes will be enabled and omitted routes will be disabled. Choose at most ${maxTracks} tracks. Never invent route ids.

CURRENTLY LOADED ROUTES (use these exact routeId values, never invent ids):
${routeDocs(routes)}

GENERAL MAPPING GUIDANCE (follow unless the user overrides it):
- metro lines → pitched melodic/keys/bass instruments (the harmonic core)
- tram lines → short rhythmic/percussive sounds (high stop frequency = rhythm)
- bus lines → soft pads / ambient textures (background layer)
- hev (suburban) → low, slow melodic voices
Spread tracks across the stereo field and balance levels so nothing masks the melody.

VOCABULARY (only use these exact values):
- synthType: ${SYNTH_TYPES.join(', ')}
- samplerPreset (only when synthType="Sampler"): ${SAMPLER_PRESET_IDS.join(', ')}
- scale root: ${NOTE_ROOTS.join(', ')}
- scaleType: ${SCALE_TYPE_KEYS.join(', ')}
- speed: ${TRACK_SPEEDS.join(', ')}
- gridResolution: ${GRID_RESOLUTIONS.join(', ')}
- loopRegion: {startCell, endCell} on a fixed 0..64 grid; endCell is exclusive and must be greater than startCell. Prefer bar edges 0, 16, 32, 48, 64.
- pitchVariety.contour: ${PITCH_CONTOURS.join(', ')}; pitchVariety.variety: 0..1. Geographic at 0 preserves the route's natural stop melody.
- FX buses (busId — params with ranges):
${fxBusDocs()}

MAP/DAW CAPABILITIES:
- Per-track instruments, sampler presets, level, pan, scale, octave, glide, legato, arpeggiator, granular layer, speed, loop window, note-grid resolution, and geographic pitch contour.
- Per-track filters, eight-band EQ, ADSR, authored stop pitch/velocity, duplicate/merged chord lanes, automation lanes, and shared drum backing also exist, but are edited by the user and are not part of this AI schema.
- The app can solo/disable lanes and export MIDI/WAV. Do not describe unsupported actions or create automation, duplicates, stop edits, EQ curves, or drum patterns.

RANGES (clamp to these):
- bpm: 40..240 (integer)
- masterVolume & track volume: -40..6 dB (0 = unity; pads/perc usually -12..-6)
- pan: -1 (left) .. 1 (right)
- octave: -2..2 (integer)
- glide: 0..1 seconds
- FX wet and send level: 0..1
- arp.style: ${ARP_STYLES.join(', ')}
- arp.rate: ${ARP_RATES.join(', ')} (Tone divisions; 8t/16t are triplets)
- arp.gate: 0.05..2, arp.octaves: 1..4, arp.steps: 1..6, arp.distance: 1..4 (scale degrees between chord tones; 2 = thirds)
- granular: optional per-track grain-cloud layer rendered from the track's own instrument, layered on top of its notes — good for evolving pads / ambient halos. granular.mix: 0..1, granular.grainSize: 0.01..0.5 s, granular.overlap: 0.01..0.5 s, granular.playbackRate: 0.25..4, granular.loopStart/loopEnd: 0..1, granular.jitter: 0..1, granular.reverse: bool, granular.attack: 0..2 s, granular.release: 0.01..6 s

OUTPUT — return only the JSON object required by the response schema. Use null for optional settings you do not want to change:
{
  "summary": "one short sentence describing the vibe you created",
  "bpm": 80,
  "harmony": { "root": "A", "scaleType": "dorian" },
  "masterVolume": -3,
  "tracks": [
    {
      "routeId": "<one of the ids above>",
      "synthType": "FMSynth",
      "samplerPreset": "piano",
      "volume": -6,
      "pan": -0.3,
      "octave": -1,
      "glide": 0.1,
      "legato": false,
      "scale": { "root": "A", "scaleType": "dorian" },
      "drone": { "enabled": false, "root": "A2" },
      "arp": { "enabled": false, "style": "up", "rate": "16n", "gate": 0.5, "octaves": 1, "steps": 3, "distance": 2 },
      "granular": { "enabled": false, "mix": 0.5, "grainSize": 0.09, "overlap": 0.05, "playbackRate": 1, "loopStart": 0, "loopEnd": 1, "jitter": 0.2, "reverse": false, "attack": 0.1, "release": 1 },
      "speed": 1,
      "loopRegion": { "startCell": 0, "endCell": 64 },
      "gridResolution": "16n",
      "pitchVariety": { "contour": "geographic", "variety": 0 }
    }
  ],
  "fx": [
    {
      "busId": "reverb",
      "wet": 0.6,
      "params": [ { "paramId": "irType", "value": "cave" }, { "paramId": "decay", "value": 5 } ],
      "sends": [ { "routeId": "<id>", "level": 0.4 } ]
    }
  ]
}

Be musical and concise: choose a tempo, harmony, loop window, and note density that fit the request. Use only the tracks the loop needs, return them in musical priority order, and add no more than three FX buses.`
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export async function requestComposition(userPrompt, routes, options = {}) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(routes, options) },
    { role: 'user',   content: userPrompt },
  ]

  const res = await fetch(COMPOSE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messages }),
  })

  if (!res.ok) {
    let payload = null
    try { payload = await res.json() } catch { /* ignore */ }
    const error = new Error(payload?.error || `Composer request failed (${res.status})`)
    error.code = payload?.code
    error.status = res.status
    throw error
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Validation — keep only real routeIds, in-range numbers, and known enums so
// nothing unexpected ever reaches the engine handlers.
// ---------------------------------------------------------------------------

export function validatePlan(raw, routes, options = {}) {
  const dropped  = []
  const routeIds = new Set((routes ?? []).map(r => r.id))
  const busIds   = new Set(FX_BUSES.map(b => b.id))
  const out      = { tracks: [], fx: [] }

  if (typeof raw?.summary === 'string') out.summary = raw.summary
  if (isNum(raw?.bpm))          out.bpm          = Math.round(clamp(raw.bpm, RANGES.bpm))
  if (isNum(raw?.masterVolume)) out.masterVolume = clamp(raw.masterVolume, RANGES.masterVolume)

  if (raw?.harmony) {
    if (validHarmony(raw.harmony)) out.harmony = normHarmony(raw.harmony)
    else dropped.push('harmony (invalid root/scaleType)')
  }

  const seenRouteIds = new Set()
  const maxTracks = options.activeLaneLimit ?? Infinity
  for (const t of raw?.tracks ?? []) {
    if (!routeIds.has(t?.routeId)) { dropped.push(`track for unknown route "${t?.routeId}"`); continue }
    if (seenRouteIds.has(t.routeId)) { dropped.push(`duplicate track "${t.routeId}"`); continue }
    if (out.tracks.length >= maxTracks) { dropped.push(`track "${t.routeId}" exceeds the active-lane limit`); continue }
    seenRouteIds.add(t.routeId)
    const track = { routeId: t.routeId }

    if (SYNTH_TYPES.includes(t.synthType)) track.synthType = t.synthType
    else if (t.synthType) dropped.push(`synthType "${t.synthType}"`)

    if (track.synthType === 'Sampler' && SAMPLER_PRESET_IDS.includes(t.samplerPreset)) {
      track.samplerPreset = t.samplerPreset
    }

    if (t.granular && typeof t.granular === 'object') {
      const g = {}
      if (typeof t.granular.enabled === 'boolean') g.enabled = t.granular.enabled
      if (typeof t.granular.reverse === 'boolean') g.reverse = t.granular.reverse
      if (isNum(t.granular.mix))          g.mix          = clamp(t.granular.mix, [0, 1])
      if (isNum(t.granular.grainSize))    g.grainSize    = clamp(t.granular.grainSize, [0.01, 0.5])
      if (isNum(t.granular.overlap))      g.overlap      = clamp(t.granular.overlap, [0.01, 0.5])
      if (isNum(t.granular.playbackRate)) g.playbackRate = clamp(t.granular.playbackRate, [0.25, 4])
      if (isNum(t.granular.loopStart))    g.loopStart    = clamp(t.granular.loopStart, [0, 1])
      if (isNum(t.granular.loopEnd))      g.loopEnd      = clamp(t.granular.loopEnd, [0, 1])
      if (isNum(t.granular.jitter))       g.jitter       = clamp(t.granular.jitter, [0, 1])
      if (isNum(t.granular.attack))       g.attack       = clamp(t.granular.attack, [0, 2])
      if (isNum(t.granular.release))      g.release      = clamp(t.granular.release, [0.01, 6])
      if (Object.keys(g).length) track.granular = g
    }

    if (isNum(t.volume)) track.volume = clamp(t.volume, RANGES.volume)
    if (isNum(t.pan))    track.pan    = clamp(t.pan, RANGES.pan)
    if (isNum(t.octave)) track.octave = Math.round(clamp(t.octave, RANGES.octave))
    if (isNum(t.glide))  track.glide  = clamp(t.glide, RANGES.glide)
    if (typeof t.legato === 'boolean') track.legato = t.legato

    if (TRACK_SPEEDS.includes(t.speed)) track.speed = t.speed
    else if (t.speed != null) dropped.push(`speed on "${t.routeId}"`)

    if (t.loopRegion && typeof t.loopRegion === 'object') {
      if (isNum(t.loopRegion.startCell) && isNum(t.loopRegion.endCell)) {
        const startCell = Math.round(clamp(t.loopRegion.startCell, [0, GRID_TOTAL_CELLS - 1]))
        const endCell = Math.round(clamp(t.loopRegion.endCell, [1, GRID_TOTAL_CELLS]))
        if (endCell > startCell) track.loopRegion = { startCell, endCell }
        else dropped.push(`loopRegion on "${t.routeId}"`)
      } else {
        dropped.push(`loopRegion on "${t.routeId}"`)
      }
    }

    if (GRID_RESOLUTIONS.includes(t.gridResolution)) track.gridResolution = t.gridResolution
    else if (t.gridResolution != null) dropped.push(`gridResolution on "${t.routeId}"`)

    if (t.pitchVariety && typeof t.pitchVariety === 'object') {
      const contour = PITCH_CONTOURS.includes(t.pitchVariety.contour) ? t.pitchVariety.contour : null
      if (contour && isNum(t.pitchVariety.variety)) {
        track.pitchVariety = {
          contour,
          variety: clamp(t.pitchVariety.variety, RANGES.pitchVariety),
        }
      } else {
        dropped.push(`pitchVariety on "${t.routeId}"`)
      }
    }

    if (t.scale) {
      if (validHarmony(t.scale)) track.scale = normHarmony(t.scale)
      else dropped.push(`scale on "${t.routeId}"`)
    }

    if (t.drone && typeof t.drone === 'object') {
      const d = {}
      if (typeof t.drone.enabled === 'boolean') d.enabled = t.drone.enabled
      if (typeof t.drone.root === 'string')     d.root    = t.drone.root
      if ('enabled' in d) track.drone = d
    }

    if (t.arp && typeof t.arp === 'object') {
      const a = {}
      if (typeof t.arp.enabled === 'boolean')  a.enabled  = t.arp.enabled
      if (ARP_STYLES.includes(t.arp.style))    a.style    = t.arp.style
      if (ARP_RATES.includes(t.arp.rate))      a.rate     = t.arp.rate
      if (isNum(t.arp.gate))     a.gate     = clamp(t.arp.gate, [0.05, 2])
      if (isNum(t.arp.octaves))  a.octaves  = Math.round(clamp(t.arp.octaves, [1, 4]))
      if (isNum(t.arp.steps))    a.steps    = Math.round(clamp(t.arp.steps, [1, 6]))
      if (isNum(t.arp.distance)) a.distance = Math.round(clamp(t.arp.distance, [1, 4]))
      if (Object.keys(a).length) track.arp = a
    }

    out.tracks.push(track)
  }

  const plannedRouteIds = new Set(out.tracks.map(track => track.routeId))
  for (const f of raw?.fx ?? []) {
    if (!busIds.has(f?.busId)) { dropped.push(`fx for unknown bus "${f?.busId}"`); continue }
    const fx    = { busId: f.busId, params: {}, sends: [] }
    const specs = FX_PARAM_SPECS[f.busId] ?? []

    if (isNum(f.wet)) fx.wet = clamp(f.wet, RANGES.wet)

    const params = Array.isArray(f.params)
      ? f.params.map(item => [item?.paramId, item?.value])
      : Object.entries(f.params ?? {})
    for (const [pid, val] of params) {
      const spec = specs.find(s => s.id === pid)
      if (!spec) { dropped.push(`${f.busId} param "${pid}"`); continue }
      if (spec.kind === 'enum') {
        if (spec.values.includes(val)) fx.params[pid] = val
        else dropped.push(`${f.busId}.${pid} = "${val}"`)
      } else if (isNum(val)) {
        fx.params[pid] = clamp(val, [spec.min, spec.max])
      }
    }

    for (const s of f.sends ?? []) {
      if (!routeIds.has(s?.routeId)) { dropped.push(`send from unknown route "${s?.routeId}"`); continue }
      if (!plannedRouteIds.has(s.routeId)) { dropped.push(`send from inactive route "${s.routeId}"`); continue }
      if (isNum(s.level)) fx.sends.push({ routeId: s.routeId, level: clamp(s.level, RANGES.send) })
    }

    out.fx.push(fx)
  }

  return { plan: out, dropped }
}
