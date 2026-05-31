// AI Composer — turns a natural-language prompt into a structured "plan" that
// maps 1:1 onto the existing MixerTab handlers (tempo, harmony, per-track
// instruments, FX buses + sends). The vocabulary is generated from the same
// constants the engine uses, so it never drifts from what the app supports.

import { SYNTH_DEFAULTS, SAMPLER_PRESET_LIST } from '../engine.js'
import { FX_BUSES, FX_PARAM_SPECS } from '../fxTrack.js'
import { NOTE_ROOTS, SCALE_TYPES } from '../DawView.jsx'

const COMPOSE_URL = 'http://localhost:3005/api/compose'

export const SYNTH_TYPES         = Object.keys(SYNTH_DEFAULTS)
const SCALE_TYPE_KEYS            = SCALE_TYPES.map(([k]) => k)
const SAMPLER_PRESET_IDS         = SAMPLER_PRESET_LIST.map(p => p.id)

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

export function buildSystemPrompt(routes) {
  return `You are the composer engine for "Transit DAW", a web app that turns Budapest public-transport activity into generative music. Each transit line is a track; each station arrival triggers a note.

Your job: read the user's musical request (style, mood, tempo, instrumentation) and translate it into a single JSON configuration that assigns sounds and effects to the transit lines that are ALREADY loaded. You do NOT create new tracks — you only configure the existing routes listed below.

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
- NOTE: per-stop pitch is derived automatically from each stop's geography (latitude → scale degree, longitude → octave register) — it is not configurable.
- FX buses (busId — params with ranges):
${fxBusDocs()}

RANGES (clamp to these):
- bpm: 40..240 (integer)
- masterVolume & track volume: -40..6 dB (0 = unity; pads/perc usually -12..-6)
- pan: -1 (left) .. 1 (right)
- octave: -2..2 (integer)
- glide: 0..1 seconds
- FX wet and send level: 0..1

OUTPUT — return ONLY a JSON object (no markdown, no commentary) with this shape. Omit any field you don't want to change:
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
      "drone": { "enabled": false, "root": "A2" }
    }
  ],
  "fx": [
    {
      "busId": "reverb",
      "wet": 0.6,
      "params": { "irType": "cave", "decay": 5 },
      "sends": [ { "routeId": "<id>", "level": 0.4 } ]
    }
  ]
}

Be musical and deliberate: choose a tempo and harmony that fit the request, give every loaded route a sound, and add 1–3 FX buses with sensible sends. Reference only routeIds from the list above.`
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export async function requestComposition(userPrompt, routes) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(routes) },
    { role: 'user',   content: userPrompt },
  ]

  const res = await fetch(COMPOSE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ messages }),
  })

  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.error ?? '' } catch { /* ignore */ }
    throw new Error(detail || `Composer request failed (${res.status})`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Validation — keep only real routeIds, in-range numbers, and known enums so
// nothing unexpected ever reaches the engine handlers.
// ---------------------------------------------------------------------------

export function validatePlan(raw, routes) {
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

  for (const t of raw?.tracks ?? []) {
    if (!routeIds.has(t?.routeId)) { dropped.push(`track for unknown route "${t?.routeId}"`); continue }
    const track = { routeId: t.routeId }

    if (SYNTH_TYPES.includes(t.synthType)) track.synthType = t.synthType
    else if (t.synthType) dropped.push(`synthType "${t.synthType}"`)

    if (track.synthType === 'Sampler' && SAMPLER_PRESET_IDS.includes(t.samplerPreset)) {
      track.samplerPreset = t.samplerPreset
    }

    if (isNum(t.volume)) track.volume = clamp(t.volume, RANGES.volume)
    if (isNum(t.pan))    track.pan    = clamp(t.pan, RANGES.pan)
    if (isNum(t.octave)) track.octave = Math.round(clamp(t.octave, RANGES.octave))
    if (isNum(t.glide))  track.glide  = clamp(t.glide, RANGES.glide)
    if (typeof t.legato === 'boolean') track.legato = t.legato

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

    out.tracks.push(track)
  }

  for (const f of raw?.fx ?? []) {
    if (!busIds.has(f?.busId)) { dropped.push(`fx for unknown bus "${f?.busId}"`); continue }
    const fx    = { busId: f.busId, params: {}, sends: [] }
    const specs = FX_PARAM_SPECS[f.busId] ?? []

    if (isNum(f.wet)) fx.wet = clamp(f.wet, RANGES.wet)

    for (const [pid, val] of Object.entries(f.params ?? {})) {
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
      if (isNum(s.level)) fx.sends.push({ routeId: s.routeId, level: clamp(s.level, RANGES.send) })
    }

    out.fx.push(fx)
  }

  return { plan: out, dropped }
}
