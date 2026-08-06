// AI Composer — turns a natural-language prompt into a structured "plan" that
// maps 1:1 onto the existing MixerTab handlers (tempo, harmony, per-track
// instruments, FX buses + sends). The vocabulary is generated from the same
// constants the engine uses, so it never drifts from what the app supports.

import {
  SYNTH_DEFAULTS, SAMPLER_PRESET_LIST, DRUM_VOICES, ARP_STYLES, ARP_RATES,
  SIDECHAIN_ANY_DRUM, SIDECHAIN_PAD_SOURCES, DRUMS_ROUTE_ID,
  PITCH_CONTOURS as ENGINE_PITCH_CONTOURS,
} from '../engine.js'
import { FX_BUSES, FX_PARAM_SPECS } from '../fxTrack.js'
import { PAD_DEFS, STEP_LEVELS, STEPS, SOURCE_STEPS } from '../engines/drumEngine.js'
import { LANE_TAG_PRESETS } from '../laneTags.js'
import { NOTE_ROOTS, SCALE_TYPES } from '@/components/DawView.jsx'

// Same-origin Next route handler (keeps the OpenRouter key server-side).
const COMPOSE_URL = '/api/compose'

export const SYNTH_TYPES         = Object.keys(SYNTH_DEFAULTS)
const SCALE_TYPE_KEYS            = SCALE_TYPES.map(([k]) => k)
const SAMPLER_PRESET_IDS         = SAMPLER_PRESET_LIST.map(p => p.id)
const DRUM_VOICE_IDS              = DRUM_VOICES.map(voice => voice.id)
const DRUM_PAD_IDS                = PAD_DEFS.map(p => p.id)
const LANE_TAG_BY_NAME            = new Map(LANE_TAG_PRESETS.map(tag => [tag.text, tag]))
export const TRACK_SPEEDS        = [0.25, 0.5, 1, 1.5, 2, 3, 4]
export const GRID_RESOLUTIONS    = ['4n', '8n', '8t', '16n', '16t', '32n']
export const PITCH_CONTOURS      = ENGINE_PITCH_CONTOURS
export const GRID_TOTAL_CELLS    = 64
export const FILTER_TYPES         = ['lowpass', 'highpass', 'bandpass', 'notch']

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
  attack:       [0.001, 2],
  decay:        [0.001, 2],
  sustain:      [0, 1],
  release:      [0.01, 4],
  filterFreq:   [20, 20000],
  filterQ:      [0.1, 20],
  sidechainDb:  [-40, 0],
  sidechainAtk: [0.001, 0.2],
  sidechainRel: [0.02, 1.5],
}

const clamp = (v, [min, max]) => Math.max(min, Math.min(max, v))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

function validHarmony(h) {
  return h && typeof h === 'object' &&
    NOTE_ROOTS.includes(h.root) && SCALE_TYPE_KEYS.includes(h.scaleType)
}
const normHarmony = (h) => ({ root: h.root, scaleType: h.scaleType })

function nearestStepLevel(value) {
  return STEP_LEVELS.reduce((best, level) =>
    Math.abs(level - value) < Math.abs(best - value) ? level : best
  , STEP_LEVELS[0])
}

function expandDrumSteps(steps) {
  const block = steps.map(value => nearestStepLevel(clamp(value, [0, 1])))
  return Array.from({ length: SOURCE_STEPS }, (_, index) => block[index % STEPS])
}

function normalizeSidechainSource(source, plannedRouteIds, destinationId) {
  if (source === 'drums' || source === SIDECHAIN_ANY_DRUM) return SIDECHAIN_ANY_DRUM
  if (typeof source === 'string' && source.startsWith('drums:')) {
    const padId = source.slice('drums:'.length)
    return DRUM_PAD_IDS.includes(padId) ? `${DRUMS_ROUTE_ID}:${padId}` : null
  }
  if (SIDECHAIN_PAD_SOURCES.some(item => item.value === source)) return source
  if (plannedRouteIds.has(source) && source !== destinationId) return source
  return null
}

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
- drumVoice (only when synthType="Drums", a one-shot voice on a transit lane): ${DRUM_VOICE_IDS.join(', ')}
- scale root: ${NOTE_ROOTS.join(', ')}
- scaleType: ${SCALE_TYPE_KEYS.join(', ')}
- speed: ${TRACK_SPEEDS.join(', ')}
- gridResolution: ${GRID_RESOLUTIONS.join(', ')}
- loopRegion: {startCell, endCell} on a fixed 0..64 grid; endCell is exclusive and must be greater than startCell. Prefer bar edges 0, 16, 32, 48, 64.
- pitchVariety.contour: ${PITCH_CONTOURS.join(', ')}; pitchVariety.variety: 0..1. Geographic maps latitude; demand maps stop usage/service to pitch; variety also introduces geography-derived velocity differences. At 0 the original pitch mapping and flat velocity are preserved.
- filter.type: ${FILTER_TYPES.join(', ')}; frequency: 20..20000 Hz; Q: 0.1..20.
- label: ${[...LANE_TAG_BY_NAME.keys()].join(', ')} (the lane's visible musical role).
- sidechain.source: "drums" (any pad), one of ${DRUM_PAD_IDS.map(id => `"drums:${id}"`).join(', ')}, or another active routeId. A lane cannot sidechain from itself.
- drums.patterns: a compact 16-step pattern for any of these pads: ${DRUM_PAD_IDS.join(', ')}. Every step is a velocity in {${STEP_LEVELS.join(', ')}}. The loop repeats across the Map timeline.
- FX buses (busId — params with ranges):
${fxBusDocs()}

MAP/DAW CAPABILITIES:
- This AI schema can set per-track instruments (including samplers and one-shot drum voices), level, pan, scale, octave, glide, legato, amp envelope, insert filter, arpeggiator, granular layer, speed, loop window, note-grid resolution, pitch/velocity variety, role label, and sidechain ducking.
- It can program the Map tab's shared six-pad drum backing, set its lane level/filter, route the drum lane to FX using routeId "drums" in an FX send, and use the whole kit or an individual pad as a sidechain trigger. Use sidechain for rhythmic movement when it suits the request; if a drum source is used, also provide an enabled drum pattern.
- The Map/DAW also has an eight-band EQ, authored per-stop pitch/velocity, duplicate and merged chord lanes, automation lanes, solo/disable controls, and MIDI/WAV export. Those precision/manual operations are not in this schema because stop ids and editable lane topology are not supplied to you. Do not claim you changed them.

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
- envelope: attack 0.001..2 s, decay 0.001..2 s, sustain 0..1, release 0.01..4 s
- sidechain: amountDb -40..0 dB, attack 0.001..0.2 s, release 0.02..1.5 s

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
      "drumVoice": null,
      "volume": -6,
      "pan": -0.3,
      "octave": -1,
      "glide": 0.1,
      "legato": false,
      "envelope": { "attack": 0.02, "decay": 0.2, "sustain": 0.6, "release": 1.2 },
      "filter": { "type": "lowpass", "frequency": 4200, "Q": 1.2 },
      "scale": { "root": "A", "scaleType": "dorian" },
      "drone": { "enabled": false, "root": "A2" },
      "arp": { "enabled": false, "style": "up", "rate": "16n", "gate": 0.5, "octaves": 1, "steps": 3, "distance": 2 },
      "granular": { "enabled": false, "mix": 0.5, "grainSize": 0.09, "overlap": 0.05, "playbackRate": 1, "loopStart": 0, "loopEnd": 1, "jitter": 0.2, "reverse": false, "attack": 0.1, "release": 1 },
      "speed": 1,
      "loopRegion": { "startCell": 0, "endCell": 64 },
      "gridResolution": "16n",
      "pitchVariety": { "contour": "geographic", "variety": 0 },
      "label": "Lead",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -10, "attack": 0.005, "release": 0.2 }
    }
  ],
  "drums": {
    "enabled": true,
    "volume": -8,
    "filter": { "type": "lowpass", "frequency": 14000, "Q": 0.7 },
    "patterns": [
      { "padId": "kick", "steps": [1,0,0,0, 0.7,0,0,0, 1,0,0,0, 0.7,0,0,0] },
      { "padId": "hat", "steps": [0.7,0,0.4,0, 0.7,0,0.4,0, 0.7,0,0.4,0, 0.7,0,0.4,0] }
    ]
  },
  "fx": [
    {
      "busId": "reverb",
      "wet": 0.6,
      "params": [ { "paramId": "irType", "value": "cave" }, { "paramId": "decay", "value": 5 } ],
      "sends": [ { "routeId": "<id-or-drums>", "level": 0.4 } ]
    }
  ]
}

Be musical and concise: choose a tempo, harmony, loop window, and note density that fit the request. Use only the tracks the loop needs, return them in musical priority order, and add no more than three unique FX buses. Use null for drums when no drum change is needed.`
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

  if (raw?.drums && typeof raw.drums === 'object') {
    const drums = {}
    if (typeof raw.drums.enabled === 'boolean') drums.enabled = raw.drums.enabled
    if (isNum(raw.drums.volume)) drums.volume = clamp(raw.drums.volume, RANGES.volume)
    if (raw.drums.filter && typeof raw.drums.filter === 'object') {
      const filter = {}
      if (FILTER_TYPES.includes(raw.drums.filter.type)) filter.type = raw.drums.filter.type
      if (isNum(raw.drums.filter.frequency)) filter.frequency = clamp(raw.drums.filter.frequency, RANGES.filterFreq)
      if (isNum(raw.drums.filter.Q)) filter.Q = clamp(raw.drums.filter.Q, RANGES.filterQ)
      if (Object.keys(filter).length) drums.filter = filter
    }

    const patterns = Object.fromEntries(DRUM_PAD_IDS.map(id => [id, new Array(SOURCE_STEPS).fill(0)]))
    const seenPads = new Set()
    for (const pattern of raw.drums.patterns ?? []) {
      if (!DRUM_PAD_IDS.includes(pattern?.padId)) { dropped.push(`drum pattern for unknown pad "${pattern?.padId}"`); continue }
      if (seenPads.has(pattern.padId)) { dropped.push(`duplicate drum pattern "${pattern.padId}"`); continue }
      seenPads.add(pattern.padId)
      if (!Array.isArray(pattern.steps) || pattern.steps.length !== STEPS || pattern.steps.some(value => !isNum(value))) {
        dropped.push(`drum pattern "${pattern.padId}" must have ${STEPS} numeric steps`)
        continue
      }
      patterns[pattern.padId] = expandDrumSteps(pattern.steps)
    }
    drums.patterns = patterns
    if ('enabled' in drums) out.drums = drums
  }

  if (typeof raw?.summary === 'string') out.summary = raw.summary
  if (isNum(raw?.bpm))          out.bpm          = Math.round(clamp(raw.bpm, RANGES.bpm))
  if (isNum(raw?.masterVolume)) out.masterVolume = clamp(raw.masterVolume, RANGES.masterVolume)

  if (raw?.harmony) {
    if (validHarmony(raw.harmony)) out.harmony = normHarmony(raw.harmony)
    else dropped.push('harmony (invalid root/scaleType)')
  }

  const seenRouteIds = new Set()
  const pendingSidechains = []
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
    if (track.synthType === 'Drums' && DRUM_VOICE_IDS.includes(t.drumVoice)) {
      track.drumVoice = t.drumVoice
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
      if (g.loopStart != null && g.loopEnd != null && g.loopEnd <= g.loopStart) {
        delete g.loopStart
        delete g.loopEnd
        dropped.push(`granular loop bounds on "${t.routeId}"`)
      }
      if (Object.keys(g).length) track.granular = g
    }

    if (isNum(t.volume)) track.volume = clamp(t.volume, RANGES.volume)
    if (isNum(t.pan))    track.pan    = clamp(t.pan, RANGES.pan)
    if (isNum(t.octave)) track.octave = Math.round(clamp(t.octave, RANGES.octave))
    if (isNum(t.glide))  track.glide  = clamp(t.glide, RANGES.glide)
    if (typeof t.legato === 'boolean') track.legato = t.legato

    if (t.envelope && typeof t.envelope === 'object') {
      const envelope = {}
      if (isNum(t.envelope.attack))  envelope.attack  = clamp(t.envelope.attack, RANGES.attack)
      if (isNum(t.envelope.decay))   envelope.decay   = clamp(t.envelope.decay, RANGES.decay)
      if (isNum(t.envelope.sustain)) envelope.sustain = clamp(t.envelope.sustain, RANGES.sustain)
      if (isNum(t.envelope.release)) envelope.release = clamp(t.envelope.release, RANGES.release)
      if (Object.keys(envelope).length) track.envelope = envelope
    }

    if (t.filter && typeof t.filter === 'object') {
      const filter = {}
      if (FILTER_TYPES.includes(t.filter.type)) filter.type = t.filter.type
      else if (t.filter.type != null) dropped.push(`filter type on "${t.routeId}"`)
      if (isNum(t.filter.frequency)) filter.frequency = clamp(t.filter.frequency, RANGES.filterFreq)
      if (isNum(t.filter.Q)) filter.Q = clamp(t.filter.Q, RANGES.filterQ)
      if (Object.keys(filter).length) track.filter = filter
    }

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

    if (typeof t.label === 'string') {
      const label = LANE_TAG_BY_NAME.get(t.label)
      if (label) track.label = { ...label }
      else dropped.push(`label "${t.label}" on "${t.routeId}"`)
    }

    if (t.sidechain && typeof t.sidechain === 'object') {
      pendingSidechains.push({ track, input: t.sidechain })
    }

    out.tracks.push(track)
  }

  const plannedRouteIds = new Set(out.tracks.map(track => track.routeId))
  for (const { track, input } of pendingSidechains) {
    if (typeof input.enabled !== 'boolean') continue
    const sidechain = { enabled: input.enabled }
    let source = normalizeSidechainSource(input.source, plannedRouteIds, track.routeId)
    if (source?.startsWith(DRUMS_ROUTE_ID) && !out.drums?.enabled) source = null
    if (source) sidechain.source = source
    else if (input.enabled) dropped.push(`sidechain source "${input.source}" on "${track.routeId}"`)
    if (isNum(input.amountDb)) sidechain.amountDb = clamp(input.amountDb, RANGES.sidechainDb)
    if (isNum(input.attack)) sidechain.attack = clamp(input.attack, RANGES.sidechainAtk)
    if (isNum(input.release)) sidechain.release = clamp(input.release, RANGES.sidechainRel)
    if (!input.enabled || source) track.sidechain = sidechain
  }

  const seenBusIds = new Set()
  for (const f of raw?.fx ?? []) {
    if (!busIds.has(f?.busId)) { dropped.push(`fx for unknown bus "${f?.busId}"`); continue }
    if (seenBusIds.has(f.busId)) { dropped.push(`duplicate fx bus "${f.busId}"`); continue }
    if (out.fx.length >= 3) { dropped.push(`fx bus "${f.busId}" exceeds the three-bus limit`); continue }
    seenBusIds.add(f.busId)
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
      const sendRouteId = s?.routeId === 'drums' ? DRUMS_ROUTE_ID : s?.routeId
      const drumsActive = sendRouteId === DRUMS_ROUTE_ID && out.drums?.enabled
      if (!routeIds.has(sendRouteId) && !drumsActive) { dropped.push(`send from unknown route "${s?.routeId}"`); continue }
      if (!plannedRouteIds.has(sendRouteId) && !drumsActive) { dropped.push(`send from inactive route "${s?.routeId}"`); continue }
      if (isNum(s.level)) fx.sends.push({ routeId: sendRouteId, level: clamp(s.level, RANGES.send) })
    }

    out.fx.push(fx)
  }

  return { plan: out, dropped }
}
