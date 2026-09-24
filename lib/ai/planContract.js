// AI plan contract — the vocabulary, prompt text and validator that turn a model's
// JSON "plan" into something the app can apply. Pure: it imports only Tone-free
// spec modules, so it runs in the browser (AI Composer panel), in route handlers,
// and in the MCP server (lib/server/mcpTools.js) alike. The vocabulary is built
// from the same constants the engine uses, so it never drifts from what the app
// supports.

import { SYNTH_DEFAULTS, SAMPLER_PRESET_LIST, DRUM_VOICES, SIDECHAIN_ANY_DRUM, SIDECHAIN_PAD_SOURCES, DRUMS_ROUTE_ID, SYNTH_TYPES, OSC_TYPES, TONE_SUPPORT } from '../soundSpecs.js'
import { ARP_STYLES, ARP_RATES, PITCH_CONTOURS as ENGINE_PITCH_CONTOURS } from '../mappings.js'
import { FX_BUSES, FX_PARAM_SPECS } from '../fxSpecs.js'
import { PAD_DEFS, STEP_LEVELS, STEPS, SOURCE_STEPS } from '../drumSpecs.js'
import { LANE_TAG_PRESETS } from '../laneTags.js'
import { normalizeNoteChance, normalizeLoopPattern, MAX_PATTERN_PLAY, MAX_PATTERN_REST } from '../laneGating.js'
import { NOTE_ROOTS, SCALE_TYPES } from '../harmony.js'
import { musicalPolicyText, recipeContextText, soundContextText } from './musicalPolicy.js'

export const SCALE_TYPE_KEYS     = SCALE_TYPES.map(([k]) => k)
export const SAMPLER_PRESET_IDS  = SAMPLER_PRESET_LIST.map(p => p.id)
export const DRUM_VOICE_IDS      = DRUM_VOICES.map(voice => voice.id)
export const DRUM_PAD_IDS        = PAD_DEFS.map(p => p.id)
const LANE_TAG_BY_NAME            = new Map(LANE_TAG_PRESETS.map(tag => [tag.text, tag]))
export const TRACK_SPEEDS        = [0.25, 0.5, 1, 1.5, 2, 3, 4]
export const GRID_RESOLUTIONS    = ['4n', '8n', '8t', '16n', '16t', '32n']
export const PITCH_CONTOURS      = ENGINE_PITCH_CONTOURS
export const LABEL_NAMES         = LANE_TAG_PRESETS.map(tag => tag.text)
export const MAX_FX_BUSES        = 3
export const GRID_TOTAL_CELLS    = 64
export const FILTER_TYPES        = ['lowpass', 'highpass', 'bandpass', 'notch']

// Native ranges, kept in sync with the handlers in MixerTab.jsx / fxSpecs.js.
export const RANGES = {
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
  // FM/AM tone. The synth editor allows an index up to 100; plans stop at 40,
  // past which a two-operator patch is mostly harsh noise.
  harmonicity:     [0.1, 20],
  modulationIndex: [0, 40],
}

export { SYNTH_TYPES, OSC_TYPES, TONE_SUPPORT }
const TONE_KEYS = ['oscillator', 'harmonicity', 'modulationIndex', 'modEnvelope']

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

// The unit a plan value is written in. A spec's `unit` describes the UI display,
// which multiplies the stored value by `displayScale` — delay time and reverb
// pre-delay are stored in seconds but shown in ms. The model writes stored values.
const STORAGE_UNITS = { 1000: { ms: 's' } }
export function planParamUnit(spec) {
  if (spec.displayScale && spec.unit) return STORAGE_UNITS[spec.displayScale]?.[spec.unit] ?? spec.unit
  return spec.unit
}

export function fxBusDocs() {
  return FX_BUSES.map(b => {
    const specs  = FX_PARAM_SPECS[b.id] ?? []
    const params = specs.map(s => {
      if (s.kind === 'enum') return `${s.id} ∈ {${s.values.join(', ')}}`
      const unit = planParamUnit(s)
      return `${s.id} (${s.min}..${s.max}${unit ? ' ' + unit : ''})`
    })
    return `- "${b.id}" (${b.label})${params.length ? ' — params: ' + params.join('; ') : ''}`
  }).join('\n')
}

function routeDocs(routes) {
  if (!routes?.length) return '(no routes loaded yet)'
  // Stop count is the one number the model needs to judge note density: a lane
  // plays one note per stop per pass (see NOTE DENSITY in the prompt).
  return routes
    .map(r => {
      const stops = r.stops?.length ? ` | stops=${r.stops.length}` : ''
      return `- routeId="${r.id}" | name="${r.name ?? r.shortName ?? r.id}" | type=${r.type}${stops}`
    })
    .join('\n')
}

// Notes one pass of the 4-bar loop can hold at each grid resolution; stops past
// the last cell are dropped (mappings.snapStopsToGrid).
const GRID_CELLS_PER_PASS = { '4n': 16, '8n': 32, '8t': 24, '16n': 64, '16t': 48, '32n': 128 }

// A drone holds one absolute note, so it needs an octave and must sit in the
// song's key; `C3` is the engine default whatever the harmony.
const DRONE_NOTE_RE = /^[A-G](#|b)?[0-7]$/

function clampTracks(maxTracks, routeCount) {
  return Math.max(1, Math.min(routeCount || 1, maxTracks ?? 8))
}

// The example plan embedded in the prompt: a two-lane house sketch built from the
// R1 bass and R5 keys sound recipes. Exported so test/composer-guide.test.js can
// check it follows the prompt's own advice (validates cleanly, raises no
// advisories, synthetic reverb whenever it sets a decay, full loop windows).
export const EXAMPLE_PLAN_JSON = `{
  "summary": "A square-wave bass pulses under a warm piano figure over a kick-ducked house groove. Try shortening the bass decay for more space, opening the piano filter for brightness, or raising its delay send slightly.",
  "bpm": 122,
  "harmony": { "root": "A", "scaleType": "dorian" },
  "masterVolume": -4,
  "tracks": [
    {
      "routeId": "<one of the ids above>",
      "synthType": "Synth",
      "samplerPreset": null,
      "drumVoice": null,
      "volume": -9,
      "pan": 0,
      "octave": -1,
      "glide": 0,
      "legato": false,
      "envelope": { "attack": 0.008, "decay": 0.12, "sustain": 0, "release": 0.08 },
      "tone": { "oscillator": "square", "harmonicity": null, "modulationIndex": null, "modEnvelope": null },
      "filter": { "type": "lowpass", "frequency": 900, "Q": 0.7 },
      "scale": null,
      "drone": { "enabled": false, "root": "A1" },
      "arp": { "enabled": false, "style": "up", "rate": "16n", "gate": 0.5, "octaves": 1, "steps": 3, "distance": 2 },
      "granular": null,
      "speed": 1,
      "loopRegion": { "startCell": 0, "endCell": 64 },
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.1 },
      "noteChance": 1,
      "loopPattern": { "play": 1, "rest": 0, "offset": 0 },
      "label": "Bass",
      "sidechain": { "enabled": true, "source": "drums:kick", "amountDb": -8, "attack": 0.005, "release": 0.15 }
    },
    {
      "routeId": "<another id above>",
      "synthType": "Sampler",
      "samplerPreset": "piano",
      "drumVoice": null,
      "volume": -8,
      "pan": -0.2,
      "octave": 0,
      "glide": 0,
      "legato": false,
      "envelope": { "attack": 0.01, "decay": 0.1, "sustain": 1, "release": 0.3 },
      "tone": null,
      "filter": { "type": "lowpass", "frequency": 3500, "Q": 0.7 },
      "scale": null,
      "drone": null,
      "arp": null,
      "granular": { "enabled": false, "mix": 0.08, "grainSize": 0.1, "overlap": 0.05, "playbackRate": 0.5, "loopStart": 0.1, "loopEnd": 0.55, "jitter": 0, "reverse": false, "attack": 0.05, "release": 0.4 },
      "speed": 0.5,
      "loopRegion": { "startCell": 0, "endCell": 64 },
      "gridResolution": "8n",
      "pitchVariety": { "contour": "randomWalk", "variety": 0.15 },
      "noteChance": 1,
      "loopPattern": { "play": 1, "rest": 0, "offset": 0 },
      "label": "Lead",
      "sidechain": null
    }
  ],
  "drums": {
    "enabled": true,
    "volume": -8,
    "filter": { "type": "lowpass", "frequency": 14000, "Q": 0.7 },
    "patterns": [
      { "padId": "kick", "steps": [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0] },
      { "padId": "clap", "steps": [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0] },
      { "padId": "hat", "steps": [0,0,0.4,0, 0,0,0.7,0, 0,0,0.4,0, 0,0,0.7,0] }
    ]
  },
  "fx": [
    {
      "busId": "delay",
      "wet": 1,
      "params": [ { "paramId": "sync", "value": "8n." }, { "paramId": "feedback", "value": 0.3 } ],
      "sends": [ { "routeId": "<another id above>", "level": 0.15 } ]
    },
    {
      "busId": "reverb",
      "wet": 1,
      "params": [ { "paramId": "irType", "value": "synthetic" }, { "paramId": "decay", "value": 1.2 }, { "paramId": "preDelay", "value": 0.015 } ],
      "sends": [ { "routeId": "<another id above>", "level": 0.12 }, { "routeId": "drums", "level": 0.05 } ]
    }
  ]
}`

// Everything the model needs besides the route list: mapping guidance, the full
// vocabulary, ranges and an example plan. Shared verbatim by the in-app system
// prompt and the MCP composer guide so both clients are told the same thing.
export function composerVocabularyText() {
  return `GENERAL MAPPING GUIDANCE (follow unless the user overrides it):
- metro lines → pitched melodic/keys/bass instruments (the harmonic core)
- tram lines → short rhythmic/percussive sounds (high stop frequency = rhythm)
- bus lines → soft pads / ambient textures (background layer)
- hev (suburban) → low, slow melodic voices
Spread tracks across the stereo field and balance levels so nothing masks the melody.

HOW A LANE ACTUALLY PLAYS (these facts decide whether the result sounds good — plan with them):
- One note per stop, never a chord. Stops are laid out by distance along the line across one 4-bar pass, then snapped to the lane's grid. Harmony comes from stacking lanes (or an arp), not from a single "Chords" lane.
- NOTE DENSITY. Notes per pass = the stops inside the loop window, capped at the grid's cells per pass (${Object.entries(GRID_CELLS_PER_PASS).map(([rate, cells]) => `${rate}=${cells}`).join(', ')}, scaled by the window's share of 64 cells); stops past the cap are dropped. A pass lasts 16 beats ÷ speed. So notes per beat ≈ notes per pass × speed ÷ 16 (× 64 ÷ window cells).
  Aim for: ambient/drone/"slow" ≤ 0.5 notes per beat for melodic lanes and ≤ 0.25 for pads (use speed 0.25–0.5 and a 4n/8n grid); mid-tempo grooves 0.5–2; busy percussion 2–4. A 30-stop line at speed 1 plays ~2 notes per beat — far too busy for ambient.
  Two more density tools: noteChance multiplies notes per beat (0.4 keeps ~40%, different ones each pass) — good for sparse, human-feeling percussion and bells, not for a bass line that must anchor; loopPattern thins over time rather than within a pass — a lane on {play 1, rest 3} is heard one pass in four.
- NOTE LENGTH. Every ordinary stop note is held for one beat (60/bpm s) — whatever the grid, speed or loop window; a finer grid only changes where notes can land. Then the release rings. An attack longer than one beat never reaches full level, so for swells keep attack ≲ 60/bpm and put the length in release and reverb, or use a drone or legato on a mono voice. For a short pulse use sustain 0 with a short decay — with sustain above 0 the body holds for the whole beat, and a short release alone does not shorten it. An enabled arp plays a whole sequence from every stop (each note rate × gate long), so sequences from neighbouring stops overlap and multiply activity: thin the stops before slowing the arp. Legato suits mono synths; on Sampler or PolySynth it piles up voices. glide only works on synths with portamento (not Sampler/Drums).
- REGISTER. Melodic lanes start at the key's root in octave 3 and rise from there. Bass: octave -1 or -2. Leads/keys: 0. Use +1/+2 only for sparse, quiet sparkle — dense high lanes turn shrill.
- CONTOUR. "randomWalk" moves in small steps within ~1–2 octaves — the most melodic choice for leads and bass. "arch" rises then falls — good for phrases and slow pads. "geographic" maps latitude to scale degree and longitude to octave, so an east–west line can leap octaves. "demand" (the default) jumps across three octaves by how busy each stop is — use it for bells, plucks and stabs, not for bass or a lead that should sing. Keep variety ≤ 0.3 for melody.
- DRONE replaces every stop note on that lane with one held note. Use it for at most one bass/pad foundation, always give its root as a note with an octave in the song's key (the key root or fifth, e.g. "G1", "D2"), and never on a lane meant to carry melody or chords.
- INSTRUMENTS. Every type below is in the DAW's instrument picker, so the user can keep editing any lane. What each one is and what a plan can shape:
  Synth: one oscillator (triangle by default) through the amp envelope — bass, plucked-style hooks, leads; tone.oscillator picks the waveform.
  FMSynth: carrier + modulator — keys, bells, digital leads. Defaults: carrier attack 0.4 s, harmonicity 3, modulationIndex 4, modulator attack 0.5 s — so a fast carrier attack alone does NOT give a bright struck tone; set tone.modEnvelope (fast attack, short decay) for that. A short note can end before the default modulation opens.
  PolySynth: a voice allocator around a Synth voice — overlapping, ringing support; still one note per stop and it does not compose chords. Give it an explicit envelope.
  NoiseSynth: unpitched noise with an envelope — ticks, shakers, breath; octave, scale and contour do nothing. Keep it sparse, short and highpass/bandpass-filtered.
  Sampler: real recorded instruments (the presets below), repitched — usually the most natural melodic choice. Only envelope.attack and envelope.release act (decay/sustain are ignored); raising attack softens the transient, and a longer release cannot extend a sample past its recording. Stay near the preset's natural register.
  Drums: one one-shot sample on a transit lane, always at its own fixed pitch (octave and scale do nothing); attack/release only. Separate from the six-pad kit.
  Also: AMSynth (hollow, rough colour; harmonicity + modEnvelope), MonoSynth (saw bass/lead with its own internal filter envelope the plan cannot set — only tone.oscillator), DuoSynth (two detuned voices with vibrato; the plan sets only its envelope), MembraneSynth (pitched kick/tom — a moving line retunes it every hit), MetalSynth (inharmonic metallic hits, no sustain), PluckSynth (a string model: it ignores envelope, note length and velocity — prefer a short-envelope Synth for predictable plucks).
- THE DRUM KIT (drums.patterns) is synthesized with fixed timbres: kick = membrane (the low anchor), snare = white noise, hat = short metal, rim = short high membrane, ride = long metallic tail (adds density), clap = pink noise (softer than a sampled clap). Pads cannot be retuned or reshaped, and all six share one insert chain and one set of sends — contrast comes from choosing hat vs ride and rim vs clap, and from step velocities.
- LOOP WINDOWS AND ARRANGEMENT. Every lane starts sounding at the same moment. A loopRegion chooses WHICH part of the line's material the lane loops; it never delays the lane's entrance (a window of cells 48–64 is a short loop of the line's last quarter that starts with everything else). Loop length: beats = 16 × (endCell − startCell) ÷ 64 ÷ speed; seconds = beats × 60 ÷ bpm. A shorter window repeats sooner, so it sounds busier and more insistent; counter that with a lower speed or a coarser grid. Mix speeds (0.25 / 0.5 / 1) so lanes drift against each other, but keep a stable anchor (drums or a speed-1 full-window lane) under at most one conspicuously drifting layer. loopPattern is the only way to make a lane come and go: {play 1, rest 1} is heard every other pass. {1,1,0} and {1,1,1} make two lanes alternate — only when both have the same speed and loop window, since each lane counts passes of its own loop. Keep the foundation playing every pass. Reserve the densest lane for the one that carries the rhythm.
- LEVELS. The more lanes, the lower each: lead around -8..-4 dB, supporting -16..-10, pads/textures -22..-14, masterVolume -6..-3. Ambient space comes from reverb/delay sends, not from loud pads.

VOCABULARY (only use these exact values):
- synthType: ${SYNTH_TYPES.join(', ')}
- samplerPreset (only when synthType="Sampler"): ${SAMPLER_PRESET_IDS.join(', ')}
- drumVoice (only when synthType="Drums", a one-shot voice on a transit lane): ${DRUM_VOICE_IDS.join(', ')}
- scale root: ${NOTE_ROOTS.join(', ')}
- scaleType: ${SCALE_TYPE_KEYS.join(', ')}
- speed: ${TRACK_SPEEDS.join(', ')}
- gridResolution: ${GRID_RESOLUTIONS.join(', ')}
- loopRegion: {startCell, endCell} on a fixed 0..64 grid; endCell is exclusive and must be greater than startCell. Prefer bar edges 0, 16, 32, 48, 64.
- pitchVariety.contour: ${PITCH_CONTOURS.join(', ')} (default demand); pitchVariety.variety: 0..1. Demand maps stop usage/service to pitch; geographic maps latitude; variety also introduces geography-derived velocity differences. At 0 the contour's own mapping and flat velocity are preserved.
- filter.type: ${FILTER_TYPES.join(', ')}; frequency: 20..20000 Hz; Q: 0.1..20.
- label: ${[...LANE_TAG_BY_NAME.keys()].join(', ')} (the lane's visible musical role).
- tone (synthesis beyond the amp envelope; only these instruments use it): tone.oscillator ∈ {${OSC_TYPES.join(', ')}} for ${Object.entries(TONE_SUPPORT).filter(([, keys]) => keys.includes('oscillator')).map(([t]) => t).join(', ')}; tone.harmonicity ${RANGES.harmonicity[0]}..${RANGES.harmonicity[1]} (modulator ÷ carrier frequency) for ${Object.entries(TONE_SUPPORT).filter(([, keys]) => keys.includes('harmonicity')).map(([t]) => t).join(', ')}; tone.modulationIndex ${RANGES.modulationIndex[0]}..${RANGES.modulationIndex[1]} (FM brightness) for ${Object.entries(TONE_SUPPORT).filter(([, keys]) => keys.includes('modulationIndex')).map(([t]) => t).join(', ')}; tone.modEnvelope {attack, decay, sustain, release} (the modulator's envelope, same ranges as envelope) for ${Object.entries(TONE_SUPPORT).filter(([, keys]) => keys.includes('modEnvelope')).map(([t]) => t).join(', ')}. A key the lane's instrument does not use is dropped. Use null for tone to keep the instrument's defaults.
- sidechain.source: "drums" (any pad), one of ${DRUM_PAD_IDS.map(id => `"drums:${id}"`).join(', ')}, or another active routeId. A lane cannot sidechain from itself. Use "drums:kick" for kick-driven pumping and make sure the kick pad actually plays; "drums" ducks on every pad hit, which is a different, busier rhythm. Choose a release that lets the lane recover before the next hit. The duck fires once per source note (once per stop, not per arp note), scaled by that note's velocity; effect tails already sent to a bus are not ducked.
- drums.patterns: a compact 16-step pattern for any of these pads: ${DRUM_PAD_IDS.join(', ')}. Every step is a velocity in {${STEP_LEVELS.join(', ')}}. The loop repeats across the Map timeline.
- FX buses (busId — params with ranges):
${fxBusDocs()}
- FX units and behaviour: numeric delay/pingpong delayTime and reverb preDelay are in SECONDS; chorus delayTime is in milliseconds. Prefer a synced division (sync "8n", "8n." …) over a numeric delayTime; an eighth is 30 ÷ bpm s, a dotted eighth 45 ÷ bpm s. Reverb decay and preDelay only affect irType "synthetic" — the named IRs (${FX_PARAM_SPECS.reverb.find(s => s.id === 'irType').values.filter(v => v !== 'synthetic' && v !== 'custom').join(', ')}) are fixed recordings whose tail never changes, and "custom" needs a user-loaded file a plan cannot supply. Use "synthetic" when you want a specific tail length (0.4–1.2 s for articulate parts, 1.5–3 s for pads). "jcreverb" is a simple Schroeder reverb, not a modelled spring.
- FX buses are parallel sends: keep wet at 1 and set the amount with each lane's send level (a modest 0.1–0.4). Keep bass sends low.

MAP/DAW CAPABILITIES:
- This AI schema can set per-track instruments (including samplers and one-shot drum voices), level, pan, scale, octave, glide, legato, amp envelope, insert filter, arpeggiator, granular layer, speed, loop window, note-grid resolution, pitch/velocity variety, note chance, play/rest loop pattern, role label, and sidechain ducking.
- It can program the Map tab's shared six-pad drum backing, set its lane level/filter, route the drum lane to FX using routeId "drums" in an FX send, and use the whole kit or an individual pad as a sidechain trigger. Use sidechain for rhythmic movement when it suits the request; if a drum source is used, also provide an enabled drum pattern.
- The Map/DAW also has an eight-band EQ, authored per-stop pitch/velocity/chance, duplicate and merged chord lanes, automation lanes, solo/disable controls, and MIDI/WAV export. Those precision/manual operations are not in this schema because stop ids and editable lane topology are not supplied to you. Do not claim you changed them.

RANGES (clamp to these):
- bpm: 40..240 (integer)
- masterVolume & track volume: -40..6 dB (0 = unity; see LEVELS above)
- pan: -1 (left) .. 1 (right)
- octave: -2..2 (integer)
- glide: 0..1 seconds
- FX wet and send level: 0..1
- arp.style: ${ARP_STYLES.join(', ')}
- arp.rate: ${ARP_RATES.join(', ')} (Tone divisions; 8t/16t are triplets)
- arp.gate: 0.05..2, arp.octaves: 1..4, arp.steps: 1..6, arp.distance: 1..4 (scale degrees between chord tones; 2 = thirds)
- granular: optional per-track grain layer — good for a slowly evolving shadow of a pad. It granulates a 2 s dry render of the lane's own instrument playing C4 (before filter/EQ/FX), as one pitch stream (a chord uses its first note) with no note velocity. mix ADDS grains on top of the dry sound — it does not crossfade — and even a small mix is audible: start around 0.08. On a Drums lane the grains follow the route's notes while the dry one-shot stays at its fixed pitch. Keep the bass dry. Keep loopStart..loopEnd comfortably wider than a grain; jitter randomizes the read position, not timing. granular.mix: 0..1, granular.grainSize: 0.01..0.5 s, granular.overlap: 0.01..0.5 s, granular.playbackRate: 0.25..4, granular.loopStart/loopEnd: 0..1, granular.jitter: 0..1, granular.reverse: bool, granular.attack: 0..2 s, granular.release: 0.01..6 s
- envelope: attack 0.001..2 s, decay 0.001..2 s, sustain 0..1, release 0.01..4 s
- sidechain: amountDb -40..0 dB, attack 0.001..0.2 s, release 0.02..1.5 s

OUTPUT — return only the JSON object required by the response schema. Use null for optional settings you do not want to set. Example of the shape (the values illustrate the guidance above; they are not a recipe):
${EXAMPLE_PLAN_JSON}

Be musical and concise: choose a tempo, harmony, loop window, and note density that fit the request. Use only the tracks the loop needs, return them in musical priority order, and add no more than three unique FX buses.`
}

// The musical layer both prompts share: universal policy for the request mode,
// then the one selected genre recipe (never all of them), then — for an edit —
// what the song currently plays.
function musicalContext({ mode = 'new', recipe = null, currentSong = null } = {}) {
  const parts = [musicalPolicyText(mode)]
  const recipeText = recipeContextText(recipe)
  if (recipeText) parts.push(recipeText)
  parts.push(soundContextText(recipe))
  if (mode === 'edit' && currentSong) {
    parts.push(`CURRENT SONG (what is playing now; lanes are listed by routeId):\n${JSON.stringify(currentSong)}`)
  }
  return parts.join('\n\n')
}

// System prompt for the in-app AI Composer (POST /api/compose): the currently
// loaded lanes are the only routes the model may use. `recipe` is a
// selectRecipe() result, `mode` is 'new' | 'edit', `currentSong` a
// describeSnapshot(…, { detail: true }) object (edit mode only).
export function buildSystemPrompt(routes, options = {}) {
  const cityName = options.cityName || 'the selected city'
  const maxTracks = clampTracks(options.maxTracks, routes?.length)
  return `You are the loop-planning engine for "Leið", a web DAW that turns public transport in ${cityName} into generative music. Each transit line is a track and its stops become notes on a four-bar, 64-cell timeline.

Translate the user's request into one focused, playable loop using only the routes below. The tracks array is the complete active arrangement: listed routes will be enabled and omitted routes will be disabled. Choose at most ${maxTracks} tracks. Never invent route ids.

CURRENTLY LOADED ROUTES (use these exact routeId values, never invent ids):
${routeDocs(routes)}

${musicalContext(options)}

${composerVocabularyText()}`
}

// Guide for an external MCP client, which *is* the model: the same vocabulary as
// the in-app prompt, but route ids come from the list_routes tool rather than
// being inlined (a city can have 1,300+ lines). `recipe` is optional; without
// one the guide carries the universal policy only.
export function buildComposerGuide(options = {}) {
  const cityName = options.cityName || 'the selected city'
  const maxTracks = Math.max(1, options.maxTracks ?? 8)
  return `You are composing a loop for "Leið", a web DAW that turns public transport in ${cityName} into generative music. Each transit line is a track and its stops become notes on a four-bar, 64-cell timeline.

Write one plan object (the "plan" argument of preview_song_plan / create_song_from_plan / apply_plan_to_song) for the user's request. The tracks array is the complete active arrangement: listed routes are enabled and every other lane in the song is disabled. Choose at most ${maxTracks} tracks.

ROUTES: take every routeId from the list_routes tool for this city — never invent ids. Filter by type (metro, tram, trolley, bus, hev) or search by line name. stopCount is the "stops" figure the NOTE DENSITY rules below use; meanDemand (0..1) is how busy the line's stops are, which drives the default "demand" pitch contour.

WORKFLOW: call preview_song_plan first and read its "dropped" list (settings that were invalid and ignored) before saving. Nothing is played or saved by a preview. A new song (create_song_from_plan, or preview without songId) starts every lane from the clean baseline described under NEW COMPOSITION; apply_plan_to_song (or preview with songId) is an edit — read the song with get_song first and follow EDIT THE CURRENT SONG. For a genre, pass one of the listed recipe ids as get_composer_guide's "genre" to receive its recipe.

${musicalPolicyText('both')}${options.recipe ? `\n\n${recipeContextText(options.recipe)}` : ''}

${soundContextText(options.recipe, { all: true })}

${composerVocabularyText()}`
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
    } else if (track.synthType === 'Sampler' && t.samplerPreset != null) {
      dropped.push(`samplerPreset "${t.samplerPreset}" on "${t.routeId}"`)
    }
    if (track.synthType === 'Drums' && DRUM_VOICE_IDS.includes(t.drumVoice)) {
      track.drumVoice = t.drumVoice
    } else if (track.synthType === 'Drums' && t.drumVoice != null) {
      dropped.push(`drumVoice "${t.drumVoice}" on "${t.routeId}"`)
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

    if (t.tone && typeof t.tone === 'object') {
      // With a synthType we know which keys the instrument honours and report the
      // rest; without one (an edit keeping the lane's instrument) every valid key
      // is kept — buildSynthOpts ignores keys its type doesn't read.
      const supported = track.synthType ? (TONE_SUPPORT[track.synthType] ?? []) : TONE_KEYS
      const tone = {}
      const offer = (key, value) => {
        if (supported.includes(key)) tone[key] = value
        else dropped.push(`tone.${key} on ${track.synthType} lane "${t.routeId}" (not used by that instrument)`)
      }
      if (OSC_TYPES.includes(t.tone.oscillator)) offer('oscillator', t.tone.oscillator)
      else if (t.tone.oscillator != null) dropped.push(`tone.oscillator "${t.tone.oscillator}" on "${t.routeId}"`)
      if (isNum(t.tone.harmonicity)) offer('harmonicity', clamp(t.tone.harmonicity, RANGES.harmonicity))
      if (isNum(t.tone.modulationIndex)) offer('modulationIndex', clamp(t.tone.modulationIndex, RANGES.modulationIndex))
      const m = t.tone.modEnvelope
      if (m && typeof m === 'object') {
        const env = {}
        if (isNum(m.attack))  env.attack  = clamp(m.attack, RANGES.attack)
        if (isNum(m.decay))   env.decay   = clamp(m.decay, RANGES.decay)
        if (isNum(m.sustain)) env.sustain = clamp(m.sustain, RANGES.sustain)
        if (isNum(m.release)) env.release = clamp(m.release, RANGES.release)
        if (Object.keys(env).length) offer('modEnvelope', env)
      }
      if (Object.keys(tone).length) track.tone = tone
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

    if (isNum(t.noteChance)) track.noteChance = normalizeNoteChance(t.noteChance)
    else if (t.noteChance != null) dropped.push(`noteChance on "${t.routeId}"`)

    if (t.loopPattern && typeof t.loopPattern === 'object') {
      if (isNum(t.loopPattern.play) && isNum(t.loopPattern.rest)) track.loopPattern = normalizeLoopPattern(t.loopPattern)
      else dropped.push(`loopPattern on "${t.routeId}"`)
    }

    if (t.scale) {
      if (validHarmony(t.scale)) track.scale = normHarmony(t.scale)
      else dropped.push(`scale on "${t.routeId}"`)
    }

    if (t.drone && typeof t.drone === 'object') {
      const d = {}
      if (typeof t.drone.enabled === 'boolean') d.enabled = t.drone.enabled
      if (typeof t.drone.root === 'string' && DRONE_NOTE_RE.test(t.drone.root)) d.root = t.drone.root
      else if (t.drone.root != null) dropped.push(`drone root "${t.drone.root}" on "${t.routeId}"`)
      // An enabled drone with no usable root would hold the engine's C3 in any
      // key; default to the lane's key root, low (octave 2, shifted by octave).
      if (d.enabled && !d.root) {
        const key = track.scale ?? out.harmony
        if (key) d.root = `${key.root}${Math.max(0, Math.min(7, 2 + (track.octave ?? 0)))}`
      }
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
    if (out.fx.length >= MAX_FX_BUSES) { dropped.push(`fx bus "${f.busId}" exceeds the three-bus limit`); continue }
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
