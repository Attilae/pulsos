import * as Tone from 'tone'
import { AlertLayer }      from './alertLayer.js'
import { NetworkState }    from './networkState.js'
import { VehicleVoice }   from './vehicleVoice.js'
import { FxTrack, FX_BUSES, AUTOMATION_TARGETS } from './fxTrack.js'
import { AutomationTrack } from './automationTrack.js'
import {
  latToNote, randomFromScale, shiftOctaveNote, denormalizeToRange,
  snapStopsToGrid, GRID_TOTAL_CELLS,
  generatePitchMap, SCALES, noteToMidi, MODES,
} from './mappings.js'

export const LINE_TYPES = ['metro', 'tram', 'bus', 'hev']

export const LINE_TYPE_COLORS = {
  metro: '#E2001A',
  tram:  '#FFD700',
  bus:   '#0066CC',
  hev:   '#009640',
}

export const SYNTH_TYPES = [
  'Synth', 'FMSynth', 'AMSynth', 'MonoSynth',
  'MembraneSynth', 'MetalSynth', 'NoiseSynth', 'PluckSynth', 'DuoSynth',
]

export const SYNTH_DEFAULTS = {
  Synth: {
    oscillatorType: 'sine', phase: 0, detune: 0,
    attack: 0.005, attackCurve: 'exponential',
    decay: 0.1,   decayCurve: 'exponential',
    sustain: 0.3,
    release: 1.0, releaseCurve: 'exponential',
  },
  FMSynth: {
    oscillatorType: 'sine', phase: 0, detune: 0,
    attack: 0.4, attackCurve: 'exponential',
    decay: 0.1,  decayCurve: 'exponential',
    sustain: 1.0,
    release: 1.4, releaseCurve: 'exponential',
    modulationOscType: 'sine',
    modAttack: 0.5, modDecay: 0.1, modSustain: 1.0, modRelease: 1.4,
    harmonicity: 3, modulationIndex: 0,
  },
  AMSynth: {
    oscillatorType: 'sine', phase: 0, detune: 0,
    attack: 0.1, attackCurve: 'exponential',
    decay: 0.2,  decayCurve: 'exponential',
    sustain: 0.5,
    release: 0.8, releaseCurve: 'exponential',
    modulationOscType: 'square',
    modAttack: 0.5, modDecay: 0.0, modSustain: 1.0, modRelease: 0.5,
    harmonicity: 3,
  },
  MonoSynth: {
    oscillatorType: 'sawtooth', phase: 0, detune: 0,
    attack: 0.005, attackCurve: 'exponential',
    decay: 0.3,   decayCurve: 'exponential',
    sustain: 0.5,
    release: 0.8,  releaseCurve: 'exponential',
    filterFrequency: 800, filterType: 'lowpass', filterRolloff: -12, filterQ: 1,
    filterEnvAttack: 0.001, filterEnvDecay: 0.3, filterEnvSustain: 0.3, filterEnvRelease: 0.8,
    filterEnvBaseFreq: 200, filterEnvOctaves: 3, filterEnvExponent: 2,
  },
  MembraneSynth: {
    pitchDecay: 0.05, membOctaves: 10,
    attack: 0.001, attackCurve: 'exponential',
    decay: 0.4,   decayCurve: 'exponential',
    sustain: 0.0,
    release: 0.1, releaseCurve: 'exponential',
  },
  MetalSynth: {
    metalHarmonicity: 5.1, metalModIndex: 32, metalOctaves: 1.5, resonance: 4000,
    attack: 0.001, attackCurve: 'exponential',
    decay: 0.4,   decayCurve: 'exponential',
    sustain: 0.0,
    release: 0.3, releaseCurve: 'exponential',
  },
  NoiseSynth: {
    noiseType: 'white',
    attack: 0.005, attackCurve: 'exponential',
    decay: 0.1,   decayCurve: 'exponential',
    sustain: 0.0,
    release: 0.1, releaseCurve: 'exponential',
  },
  PluckSynth: { attackNoise: 1, dampening: 4000, resonance: 0.7 },
  DuoSynth: {
    voice0OscType: 'sawtooth', detune: 0,
    attack: 0.1, attackCurve: 'exponential',
    decay: 0.2,  decayCurve: 'exponential',
    sustain: 0.5,
    release: 0.8, releaseCurve: 'exponential',
    duoHarmonicity: 1.5, vibratoRate: 5, vibratoAmount: 0.5,
  },
}

function buildSynthOpts(synthType, params = {}, volume) {
  const p = { ...(SYNTH_DEFAULTS[synthType] ?? SYNTH_DEFAULTS.Synth), ...params }
  const vol = volume !== undefined ? { volume } : {}
  const env = {
    attack: p.attack, attackCurve: p.attackCurve ?? 'exponential',
    decay: p.decay,   decayCurve:  p.decayCurve  ?? 'exponential',
    sustain: p.sustain,
    release: p.release, releaseCurve: p.releaseCurve ?? 'exponential',
  }
  const osc = { type: p.oscillatorType, phase: p.phase ?? 0 }
  switch (synthType) {
    case 'FMSynth': return {
      ...vol, detune: p.detune ?? 0,
      oscillator: osc, envelope: env,
      modulation: { type: p.modulationOscType },
      modulationEnvelope: { attack: p.modAttack, decay: p.modDecay, sustain: p.modSustain, release: p.modRelease },
      harmonicity: p.harmonicity, modulationIndex: p.modulationIndex,
    }
    case 'AMSynth': return {
      ...vol, detune: p.detune ?? 0,
      oscillator: osc, envelope: env,
      modulation: { type: p.modulationOscType },
      modulationEnvelope: { attack: p.modAttack, decay: p.modDecay, sustain: p.modSustain, release: p.modRelease },
      harmonicity: p.harmonicity,
    }
    case 'MonoSynth': return {
      ...vol, detune: p.detune ?? 0,
      oscillator: osc, envelope: env,
      filter: { frequency: p.filterFrequency, type: p.filterType, rolloff: p.filterRolloff, Q: p.filterQ },
      filterEnvelope: {
        attack: p.filterEnvAttack, decay: p.filterEnvDecay,
        sustain: p.filterEnvSustain, release: p.filterEnvRelease,
        baseFrequency: p.filterEnvBaseFreq, octaves: p.filterEnvOctaves, exponent: p.filterEnvExponent,
      },
    }
    case 'MembraneSynth': return { ...vol, pitchDecay: p.pitchDecay, octaves: p.membOctaves, envelope: env }
    case 'MetalSynth': return {
      ...vol,
      harmonicity: p.metalHarmonicity, modulationIndex: p.metalModIndex,
      octaves: p.metalOctaves, resonance: p.resonance, envelope: env,
    }
    case 'NoiseSynth': return { ...vol, noise: { type: p.noiseType }, envelope: env }
    case 'PluckSynth': return { ...vol, attackNoise: p.attackNoise, dampening: p.dampening, resonance: p.resonance }
    case 'DuoSynth': return {
      ...vol, detune: p.detune ?? 0,
      harmonicity: p.duoHarmonicity, vibratoRate: p.vibratoRate, vibratoAmount: p.vibratoAmount,
      voice0: { oscillator: { type: p.voice0OscType }, envelope: env },
      voice1: { oscillator: { type: p.voice0OscType }, envelope: env },
    }
    default: return { ...vol, detune: p.detune ?? 0, oscillator: osc, envelope: env }
  }
}

// Per-synth-type automation targets with min/max ranges for 0–1 → actual-value mapping.
// 'common' applies to all synths that have a standard envelope (everything except PluckSynth).
export const SYNTH_PARAM_TARGETS = {
  common: [
    { id: 'synth.attack',   label: 'Attack',   group: 'Amp Env', min: 0.001, max: 4 },
    { id: 'synth.decay',    label: 'Decay',    group: 'Amp Env', min: 0.01,  max: 2 },
    { id: 'synth.sustain',  label: 'Sustain',  group: 'Amp Env', min: 0,     max: 1 },
    { id: 'synth.release',  label: 'Release',  group: 'Amp Env', min: 0.01,  max: 4 },
    { id: 'synth.detune',   label: 'Detune',   group: 'Osc',     min: -100,  max: 100 },
  ],
  Synth: [],
  FMSynth: [
    { id: 'synth.harmonicity',     label: 'Harmonicity', group: 'FM',     min: 0,     max: 20 },
    { id: 'synth.modulationIndex', label: 'Mod Index',   group: 'FM',     min: 0,     max: 100 },
    { id: 'synth.modAttack',       label: 'Mod Attack',  group: 'FM Env', min: 0.001, max: 4 },
    { id: 'synth.modDecay',        label: 'Mod Decay',   group: 'FM Env', min: 0.01,  max: 2 },
    { id: 'synth.modSustain',      label: 'Mod Sustain', group: 'FM Env', min: 0,     max: 1 },
    { id: 'synth.modRelease',      label: 'Mod Release', group: 'FM Env', min: 0.01,  max: 4 },
  ],
  AMSynth: [
    { id: 'synth.harmonicity',  label: 'Harmonicity', group: 'AM',     min: 0,     max: 20 },
    { id: 'synth.modAttack',    label: 'Mod Attack',  group: 'AM Env', min: 0.001, max: 4 },
    { id: 'synth.modDecay',     label: 'Mod Decay',   group: 'AM Env', min: 0.01,  max: 2 },
    { id: 'synth.modSustain',   label: 'Mod Sustain', group: 'AM Env', min: 0,     max: 1 },
    { id: 'synth.modRelease',   label: 'Mod Release', group: 'AM Env', min: 0.01,  max: 4 },
  ],
  MonoSynth: [
    { id: 'synth.filterFrequency',  label: 'Filter Freq', group: 'Filter',     min: 20,    max: 20000 },
    { id: 'synth.filterQ',          label: 'Filter Q',    group: 'Filter',     min: 0.1,   max: 20 },
    { id: 'synth.filterEnvAttack',  label: 'Flt Atk',     group: 'Filter Env', min: 0.001, max: 4 },
    { id: 'synth.filterEnvDecay',   label: 'Flt Dcy',     group: 'Filter Env', min: 0.01,  max: 2 },
    { id: 'synth.filterEnvSustain', label: 'Flt Sus',     group: 'Filter Env', min: 0,     max: 1 },
    { id: 'synth.filterEnvRelease', label: 'Flt Rel',     group: 'Filter Env', min: 0.01,  max: 4 },
    { id: 'synth.filterEnvOctaves', label: 'Flt Oct',     group: 'Filter Env', min: 0,     max: 8 },
  ],
  MembraneSynth: [
    { id: 'synth.pitchDecay',  label: 'Pitch Decay', group: 'Membrane', min: 0.001, max: 0.5 },
    { id: 'synth.membOctaves', label: 'Pitch Oct',   group: 'Membrane', min: 0,     max: 20 },
  ],
  MetalSynth: [
    { id: 'synth.metalHarmonicity', label: 'Harmonicity', group: 'Metal', min: 0,  max: 30 },
    { id: 'synth.metalModIndex',    label: 'Mod Index',   group: 'Metal', min: 0,  max: 100 },
    { id: 'synth.resonance',        label: 'Resonance',   group: 'Metal', min: 20, max: 20000 },
    { id: 'synth.metalOctaves',     label: 'Octaves',     group: 'Metal', min: 0,  max: 8 },
  ],
  NoiseSynth: [],
  PluckSynth: [
    { id: 'synth.attackNoise', label: 'Attack Noise', group: 'Pluck', min: 0, max: 20 },
    { id: 'synth.dampening',   label: 'Dampening',    group: 'Pluck', min: 0, max: 7000 },
    { id: 'synth.resonance',   label: 'Resonance',    group: 'Pluck', min: 0, max: 0.99 },
  ],
  DuoSynth: [
    { id: 'synth.duoHarmonicity', label: 'Harmonicity',  group: 'Duo', min: 0, max: 6 },
    { id: 'synth.vibratoRate',    label: 'Vibrato Rate', group: 'Duo', min: 0, max: 20 },
    { id: 'synth.vibratoAmount',  label: 'Vibrato Amt',  group: 'Duo', min: 0, max: 1 },
  ],
}

// Look up an automation destination's spec ({min, max, unit, ...}) by id.
// Searches AUTOMATION_TARGETS (track-level: sends, volume, pan, glide, adsr.*)
// then SYNTH_PARAM_TARGETS (per-synth-type: synth.*).
export function findTargetSpec(paramTarget, synthType) {
  const t = AUTOMATION_TARGETS.find(t => t.id === paramTarget)
  if (t) return t
  const all = [
    ...(SYNTH_PARAM_TARGETS.common ?? []),
    ...(SYNTH_PARAM_TARGETS[synthType] ?? []),
  ]
  return all.find(s => s.id === paramTarget) ?? null
}

// Apply a single flat param key directly to a live synth without disturbing other params.
function applySynthParam(synth, synthType, paramKey, value) {
  try {
    switch (paramKey) {
      case 'attack':              synth.set({ envelope: { attack: value } }); break
      case 'decay':               synth.set({ envelope: { decay: value } }); break
      case 'sustain':             synth.set({ envelope: { sustain: value } }); break
      case 'release':             synth.set({ envelope: { release: value } }); break
      case 'detune':              synth.set({ detune: value }); break
      case 'harmonicity':         synth.set({ harmonicity: value }); break
      case 'modulationIndex':     synth.set({ modulationIndex: value }); break
      case 'modAttack':           synth.set({ modulationEnvelope: { attack: value } }); break
      case 'modDecay':            synth.set({ modulationEnvelope: { decay: value } }); break
      case 'modSustain':          synth.set({ modulationEnvelope: { sustain: value } }); break
      case 'modRelease':          synth.set({ modulationEnvelope: { release: value } }); break
      case 'filterFrequency':     synth.set({ filter: { frequency: value } }); break
      case 'filterQ':             synth.set({ filter: { Q: value } }); break
      case 'filterEnvAttack':     synth.set({ filterEnvelope: { attack: value } }); break
      case 'filterEnvDecay':      synth.set({ filterEnvelope: { decay: value } }); break
      case 'filterEnvSustain':    synth.set({ filterEnvelope: { sustain: value } }); break
      case 'filterEnvRelease':    synth.set({ filterEnvelope: { release: value } }); break
      case 'filterEnvOctaves':    synth.set({ filterEnvelope: { octaves: value } }); break
      case 'pitchDecay':          synth.set({ pitchDecay: value }); break
      case 'membOctaves':         synth.set({ octaves: value }); break
      case 'metalHarmonicity':    synth.set({ harmonicity: value }); break
      case 'metalModIndex':       synth.set({ modulationIndex: value }); break
      case 'metalOctaves':        synth.set({ octaves: value }); break
      case 'resonance':
        if (synthType === 'PluckSynth') {
          if (synth.resonance && 'value' in synth.resonance) synth.resonance.value = value
        } else { synth.set({ resonance: value }) }
        break
      case 'attackNoise':         synth.set({ attackNoise: value }); break
      case 'dampening':           synth.set({ dampening: value }); break
      case 'duoHarmonicity':      synth.set({ harmonicity: value }); break
      case 'vibratoRate':         synth.set({ vibratoRate: value }); break
      case 'vibratoAmount':       synth.set({ vibratoAmount: value }); break
    }
  } catch {}
}

const NO_HARMONY = new Set(['MembraneSynth', 'MetalSynth', 'NoiseSynth', 'PluckSynth'])

export class TransitEngine {
  constructor(onEvent) {
    this.onEvent   = onEvent
    this._started  = false

    this._volumes = {}
    this._muted   = {}

    this._alertLayer = null
    this._netState   = null

    this._voices = new Map()
    this._fleet  = new Map()

    this._soundModes = new Map()
    this._mockSynths = new Map()   // routeId → { synth, routeGain, harmonySynth, ... }
    this._soloRoutes = new Set()

    // All instrument sends: 'instId:fxBusId' → level (persists across start/stop)
    this._pendingSends = {}
    // Active send Gain nodes (recreated on each start)
    this._sendGains = {}

    // Static FX buses (recreated on each start, disposed on stop)
    this._fxTracks = {}

    // Per-bus parameter overrides (persist across start/stop). 'busId' → { paramId: value }
    this._fxBusParams = {}

    // Per-route octave shifts: routeId → integer offset (-2..+2)
    this._octaveShifts = {}

    // Per-route portamento glide time (seconds). routeId → number
    this._glides = {}

    // Per-route mixer settings (persist across start/stop)
    this._routeVolumesDb = {}   // routeId → dB (-Infinity..+6)
    this._routePans      = {}   // routeId → -1..1
    this._routeMuted     = {}   // routeId → boolean

    // Per-route insert FX (persist across start/stop)
    this._routeFilters = {}     // routeId → { type, frequency, Q }
    this._routeEqs     = {}     // routeId → { low, mid, high, lowFrequency, highFrequency }

    // Per-route pre-assigned pitch maps: routeId → string[] (one note per stop)
    this._pitchMaps = {}

    // Per-route pitch map strategy: routeId → 'geographic' | 'randomWalk' | 'index' | 'random'
    this._pitchMapStrategies = {}

    // FX bus mute/solo state (persists across start/stop)
    this._fxMutedIds = new Set()
    this._fxSoloIds  = new Set()

    // Automation lanes: 'routeId:laneId' → AutomationTrack (persists across start/stop)
    this._automationLanes    = {}
    this._automationLaneCfgs = {}   // same key → mutable cfg object (callback reads from it)

    // Set of routeIds currently used as automation data sources (no synth, no notes)
    this._automationSources = new Set()

    // Drone mode per route: routeId → { enabled, rootNote }
    this._droneRoutes = {}

    // Cached routes for static-curve rebuilds
    this._routes = null

    this._netUpdateTimer = null
  }

  init() {
    this._alertLayer = new AlertLayer()
    this._panners = {}

    for (const type of LINE_TYPES) {
      const vol    = new Tone.Volume(0)
      const panner = new Tone.Panner(0)
      panner.connect(vol)
      vol.connect(this._alertLayer.input)
      this._volumes[type] = vol
      this._panners[type] = panner
      this._muted[type]   = false
    }

    this._netState = new NetworkState(this._alertLayer.input)
  }

  computeNote(lat, octaveShift = 0) {
    const scale = this._alertLayer?.currentModeScale
    const root  = (this._netState?.rootMidi ?? 62) + octaveShift * 12
    return latToNote(lat, root, scale)
  }

  setOctaveShift(routeId, shift) {
    this._octaveShifts[routeId] = shift
  }

  // ── Per-route mixer ───────────────────────────────────────────────────────

  setRouteVolume(routeId, db) {
    this._routeVolumesDb[routeId] = db
    this._applyRouteGain(routeId)
  }

  setRouteMute(routeId, muted) {
    this._routeMuted[routeId] = muted
    this._applyRouteGain(routeId)
  }

  setRoutePan(routeId, value) {
    this._routePans[routeId] = value
    const entry = this._mockSynths.get(routeId)
    entry?.routePanner?.pan.rampTo(value, 0.05)
  }

  _applyRouteGain(routeId) {
    const entry = this._mockSynths.get(routeId)
    if (!entry?.routeGain) return
    const muted = this._routeMuted[routeId]
    const db    = this._routeVolumesDb[routeId] ?? 0
    const gain  = muted ? 0 : Math.pow(10, db / 20)
    entry.routeGain.gain.rampTo(gain, 0.05)
  }

  setRouteFilter(routeId, params) {
    this._routeFilters[routeId] = { ...(this._routeFilters[routeId] ?? {}), ...params }
    const entry = this._mockSynths.get(routeId)
    if (!entry?.filter) return
    if (params.type      != null) entry.filter.type = params.type
    if (params.frequency != null) entry.filter.frequency.rampTo(params.frequency, 0.05)
    if (params.Q         != null) entry.filter.Q.rampTo(params.Q, 0.05)
  }

  setRouteEq(routeId, params) {
    this._routeEqs[routeId] = { ...(this._routeEqs[routeId] ?? {}), ...params }
    const entry = this._mockSynths.get(routeId)
    if (!entry?.eq) return
    if (params.low           != null) entry.eq.low.rampTo(params.low, 0.05)
    if (params.mid           != null) entry.eq.mid.rampTo(params.mid, 0.05)
    if (params.high          != null) entry.eq.high.rampTo(params.high, 0.05)
    if (params.lowFrequency  != null) entry.eq.lowFrequency.rampTo(params.lowFrequency, 0.05)
    if (params.highFrequency != null) entry.eq.highFrequency.rampTo(params.highFrequency, 0.05)
  }

  setGlide(routeId, seconds) {
    this._glides[routeId] = seconds
    const entry = this._mockSynths.get(routeId)
    if (entry?.synth && 'portamento' in entry.synth) {
      try { entry.synth.portamento = seconds } catch {}
    }
  }

  setPitchMap(routeId, notes) {
    this._pitchMaps[routeId] = notes
  }

  setPitchMapStrategy(routeId, strategy) {
    this._pitchMapStrategies[routeId] = strategy
  }

  // ── Send matrix ───────────────────────────────────────────────────────────────

  setSendLevel(instRouteId, fxBusId, level) {
    const key = `${instRouteId}:${fxBusId}`
    this._pendingSends[key] = level

    const existing = this._sendGains[key]
    if (existing) {
      existing.gain.rampTo(level, 0.05)
      return
    }

    // Wire on the fly when the user adds a send after engine start
    const entry = this._mockSynths.get(instRouteId)
    const fxBus = this._fxTracks[fxBusId]
    if (!entry?.routeGain || !fxBus) return

    const sendGain = new Tone.Gain(level)
    entry.routeGain.connect(sendGain)
    sendGain.connect(fxBus.input)
    this._sendGains[key] = sendGain
  }

  // ── FX bus controls ───────────────────────────────────────────────────────────

  setFxBusWet(busId, value) {
    this._fxBusParams[busId] = { ...(this._fxBusParams[busId] ?? {}), wet: value }
    this._fxTracks[busId]?.setWet(value)
  }

  setFxBusParam(busId, paramId, value) {
    this._fxBusParams[busId] = { ...(this._fxBusParams[busId] ?? {}), [paramId]: value }
    this._fxTracks[busId]?.setParam(paramId, value)
  }

  setFxBusCustomIR(busId, audioBuffer) {
    return this._fxTracks[busId]?.setCustomIRBuffer(audioBuffer)
  }

  setFxBusMute(busId, isMuted) {
    if (isMuted) this._fxMutedIds.add(busId)
    else         this._fxMutedIds.delete(busId)
    this._applyFxMuteState()
  }

  setFxBusSolo(busId, isSoloed) {
    if (isSoloed) this._fxSoloIds.add(busId)
    else          this._fxSoloIds.delete(busId)
    this._applyFxMuteState()
  }

  _applyFxMuteState() {
    const hasSolo = this._fxSoloIds.size > 0
    for (const [busId, track] of Object.entries(this._fxTracks)) {
      const muted = hasSolo
        ? !this._fxSoloIds.has(busId)
        : this._fxMutedIds.has(busId)
      track.setMute(muted)
    }
  }

  // ── Automation lanes ─────────────────────────────────────────────────────────

  addAutomationLane(routeId, laneId, cfg) {
    const key = `${routeId}:${laneId}`
    if (this._automationLanes[key]) this._automationLanes[key].dispose()

    const laneCfg = {
      sourceRouteId: cfg.sourceRouteId ?? '',
      source:        cfg.source        ?? 'arrival.delay',
      paramTarget:   cfg.paramTarget   ?? 'send.reverb',
      mode:          cfg.mode          ?? 'live',
    }
    this._automationLaneCfgs[key] = laneCfg

    const at = new AutomationTrack()
    at.setSource(laneCfg.source)
    at.setMode(laneCfg.mode)
    // Callback closure reads laneCfg by reference so paramTarget updates take effect immediately
    at.setTarget((value) => this._applyAutomation(routeId, laneCfg.paramTarget, value))

    if (laneCfg.sourceRouteId) {
      const srcRoute = this._routes?.find(r => r.id === laneCfg.sourceRouteId)
      if (srcRoute?.stops) at.buildStaticCurve(srcRoute.stops, srcRoute.totalDist)
      if (srcRoute?.polylines) at.setRouteShape(srcRoute.polylines)
    }

    this._automationLanes[key] = at
    this._rebuildAutomationSources()
  }

  updateAutomationLane(routeId, laneId, cfg) {
    const key = `${routeId}:${laneId}`
    const at = this._automationLanes[key]
    if (!at) { this.addAutomationLane(routeId, laneId, cfg); return }

    const laneCfg = this._automationLaneCfgs[key] ?? {}
    if (cfg.sourceRouteId !== undefined)   laneCfg.sourceRouteId = cfg.sourceRouteId
    if (cfg.source        !== undefined) { laneCfg.source        = cfg.source;      at.setSource(cfg.source) }
    if (cfg.mode          !== undefined) { laneCfg.mode          = cfg.mode;        at.setMode(cfg.mode) }
    if (cfg.paramTarget   !== undefined)   laneCfg.paramTarget   = cfg.paramTarget

    if (cfg.sourceRouteId !== undefined || cfg.source !== undefined || cfg.mode !== undefined) {
      const srcRouteId = laneCfg.sourceRouteId
      if (srcRouteId) {
        const srcRoute = this._routes?.find(r => r.id === srcRouteId)
        if (srcRoute?.stops) at.buildStaticCurve(srcRoute.stops, srcRoute.totalDist)
        if (srcRoute?.polylines) at.setRouteShape(srcRoute.polylines)
      }
    }

    if (cfg.sourceRouteId !== undefined) this._rebuildAutomationSources()
  }

  removeAutomationLane(routeId, laneId) {
    const key = `${routeId}:${laneId}`
    this._automationLanes[key]?.dispose()
    delete this._automationLanes[key]
    delete this._automationLaneCfgs[key]
    this._rebuildAutomationSources()
  }

  _rebuildAutomationSources() {
    this._automationSources = new Set(
      Object.values(this._automationLaneCfgs)
        .map(c => c.sourceRouteId)
        .filter(Boolean)
    )
  }

  _applyAutomation(routeId, paramTarget, normalizedValue) {
    const entry = this._mockSynths.get(routeId)
    const spec  = findTargetSpec(paramTarget, entry?.synthType)
    if (!spec) return
    const v = denormalizeToRange(normalizedValue, spec.min, spec.max)  // value in spec's unit

    if (paramTarget.startsWith('send.')) {
      const fxBusId = paramTarget.slice(5)
      this._sendGains[`${routeId}:${fxBusId}`]?.gain.rampTo(v, 0.1)
    } else if (paramTarget === 'volume') {
      // spec is dB; routeGain is a linear Tone.Gain
      entry?.routeGain?.gain.rampTo(Math.pow(10, v / 20), 0.1)
    } else if (paramTarget === 'pan') {
      // spec is -100..100; Tone.Panner.pan expects -1..1
      entry?.routePanner?.pan.rampTo(v / 100, 0.05)
    } else if (paramTarget === 'glide') {
      // spec is ms; portamento is seconds
      if (entry?.synth && 'portamento' in entry.synth) {
        try { entry.synth.portamento = v / 1000 } catch {}
      }
    } else if (paramTarget.startsWith('adsr.')) {
      const param = paramTarget.slice(5)
      try { entry?.synth?.set({ envelope: { [param]: v } }) } catch {}
    } else if (paramTarget.startsWith('synth.')) {
      if (entry?.synth) applySynthParam(entry.synth, entry.synthType, paramTarget.slice(6), v)
    }
  }

  _dispatchFromSourceRoute(sourceRouteId, stopId, data) {
    for (const [key, at] of Object.entries(this._automationLanes)) {
      if (this._automationLaneCfgs[key]?.sourceRouteId === sourceRouteId)
        at.onStopEvent(stopId, data)
    }
  }

  _dispatchVehiclePosition(sourceRouteId, lat, lng) {
    for (const [key, at] of Object.entries(this._automationLanes)) {
      if (this._automationLaneCfgs[key]?.sourceRouteId === sourceRouteId)
        at.onVehiclePosition(lat, lng)
    }
  }

  // ── Synth factory ─────────────────────────────────────────────────────────────

  _makeSynth(synthType, params = {}, volume = -18) {
    const opts = buildSynthOpts(synthType, params, volume)
    switch (synthType) {
      case 'FMSynth':       return new Tone.FMSynth(opts)
      case 'AMSynth':       return new Tone.AMSynth(opts)
      case 'MonoSynth':     return new Tone.MonoSynth(opts)
      case 'MembraneSynth': return new Tone.MembraneSynth(opts)
      case 'MetalSynth':    return new Tone.MetalSynth(opts)
      case 'NoiseSynth':    return new Tone.NoiseSynth(opts)
      case 'PluckSynth':    return new Tone.PluckSynth(opts)
      case 'DuoSynth':      return new Tone.DuoSynth(opts)
      default:              return new Tone.Synth(opts)
    }
  }

  _triggerSynth(entry, note, dur, time) {
    const { synth, synthType, harmonySynth, harmonyInterval } = entry
    if (synthType === 'NoiseSynth') {
      synth.triggerAttackRelease(dur, time)
    } else if (synthType === 'PluckSynth') {
      synth.triggerAttack(note, time)
    } else {
      synth.triggerAttackRelease(note, dur, time)
      if (harmonySynth && harmonyInterval) {
        harmonySynth.triggerAttackRelease(
          Tone.Frequency(note).transpose(harmonyInterval).toFrequency(), dur, time
        )
      }
    }
  }

  // ── Route entry lifecycle ────────────────────────────────────────────────────

  _disposeRouteEntry(entry) {
    if (!entry) return
    entry.synth?.dispose()
    entry.harmonySynth?.dispose()
    entry.routeGain?.dispose()
    entry.routePanner?.dispose()
    entry.filter?.dispose()
    entry.eq?.dispose()
  }

  _createSingleRouteEntry(routeId, routeType, synthType = 'Synth', envelope = null, scale = null) {
    const lineOut = this._panners[routeType] ?? this._volumes[routeType] ?? this._alertLayer.input

    const muted     = !!this._routeMuted[routeId]
    const db        = this._routeVolumesDb[routeId] ?? 0
    const initGain  = muted ? 0 : Math.pow(10, db / 20)
    const initPan   = this._routePans[routeId] ?? 0

    const synth       = this._makeSynth(synthType, envelope ?? {}, -18)
    const routeGain   = new Tone.Gain(initGain)
    const routePanner = new Tone.Panner(initPan)

    const fParams = this._routeFilters[routeId] ?? { type: 'lowpass', frequency: 20000, Q: 1 }
    const eParams = this._routeEqs[routeId]     ?? { low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 }
    const filter  = new Tone.Filter(fParams)
    const eq      = new Tone.EQ3(eParams)

    synth.connect(routeGain)
    routeGain.connect(filter)
    filter.connect(eq)
    eq.connect(routePanner)
    routePanner.connect(lineOut)

    const glide = this._glides[routeId]
    if (glide != null && 'portamento' in synth) {
      try { synth.portamento = glide } catch {}
    }

    // Wire pending sends to already-created FX buses
    for (const [key, level] of Object.entries(this._pendingSends)) {
      const [instId, fxBusId] = key.split(':')
      if (instId !== routeId) continue
      const fxBus = this._fxTracks[fxBusId]
      if (!fxBus || this._sendGains[key]) continue
      const sendGain = new Tone.Gain(level)
      routeGain.connect(sendGain)
      sendGain.connect(fxBus.input)
      this._sendGains[key] = sendGain
    }

    const entry = {
      synth, harmonySynth: null, harmonyInterval: 0,
      routeType, synthType,
      scale: scale ?? { root: 'C', scaleType: 'major' },
      routeGain, routePanner, filter, eq,
    }
    this._mockSynths.set(routeId, entry)
    return entry
  }

  // ── FX bus creation ───────────────────────────────────────────────────────────

  _createFxBuses() {
    for (const spec of FX_BUSES) {
      if (this._fxTracks[spec.id]) this._fxTracks[spec.id].dispose()
      const overrides = this._fxBusParams[spec.id] ?? {}
      this._fxTracks[spec.id] = new FxTrack(spec.id, this._alertLayer.input, overrides)
    }
    this._applyFxMuteState()
  }

  // ── Live data handlers ───────────────────────────────────────────────────────

  handleVehicleUpdate(data) {
    const {
      vehicleId, lineType, lat, lng, bearing, speed,
      currentStatus, occupancyPct, carriageDetails,
      delay, uncertainty, scheduleRelationship,
      stopId, stopName, routeShortName, color,
    } = data

    if (!vehicleId || !lineType) return

    const vehicleRoute   = this._routes?.find(r => r.name === routeShortName)
    const octaveShift    = vehicleRoute ? (this._octaveShifts[vehicleRoute.id] ?? 0) : 0
    const note = this.computeNote(lat ?? 47.49, octaveShift)
    this._fleet.set(vehicleId, { lat: lat ?? 47.49, lng: lng ?? 19.05, note, lineType, currentStatus, routeShortName })

    // Automation source routes: only dispatch data, never create voices or play notes
    if (vehicleRoute?.id && this._automationSources.has(vehicleRoute.id)) {
      this._dispatchVehiclePosition(vehicleRoute.id, lat, lng)
      if (currentStatus === 1) {
        this._dispatchFromSourceRoute(vehicleRoute.id, stopId, { delay, uncertainty, occupancyPct, speed, lat, lng, bearing })
      }
      this._scheduleNetworkUpdate()
      return
    }

    let entry = this._voices.get(vehicleId)

    const needsVoice = currentStatus === 0 || currentStatus === 1
    if (!entry && needsVoice) {
      if (this._voices.size >= 150) this._evictOldestVoice()
      const routeEntry = vehicleRoute?.id ? this._mockSynths.get(vehicleRoute.id) : null
      const outputNode = routeEntry?.routeGain
        ?? this._panners[lineType]
        ?? this._volumes[lineType]
      if (outputNode) {
        const voice = new VehicleVoice(outputNode)
        const sm = routeShortName ? this._soundModes.get(routeShortName) : null
        if (sm) voice.setMode(sm.mode, 0)
        entry = { voice, lastUpdated: Date.now() }
        this._voices.set(vehicleId, entry)
      }
    }

    if (entry) {
      entry.lastUpdated = Date.now()
      entry.voice.update({ note, currentStatus, delay })

      if (scheduleRelationship != null && scheduleRelationship !== 0) {
        entry.voice.handleScheduleRelationship(scheduleRelationship)
      }
    }

    if (currentStatus === 1) {
      this._netState?.recordArrival()
      const ev = {
        vehicleId, lineType, lineId: routeShortName ?? vehicleId,
        stopId, stopName, note, routeShortName, color,
      }
      this.onEvent(ev)

      if (vehicleRoute?.id) {
        this._dispatchFromSourceRoute(vehicleRoute.id, stopId, { delay, uncertainty, occupancyPct, speed, lat, lng, bearing })
      }
    }

    this._scheduleNetworkUpdate()
  }

  handleTripUpdate(data) {
    const { vehicleId, delay, uncertainty, scheduleRelationship, stopTimeUpdates } = data
    const entry = this._voices.get(vehicleId)
    if (entry) {
      entry.voice.update({ delay, uncertainty, currentStatus: -1 })
      if (scheduleRelationship != null && scheduleRelationship !== 0) {
        entry.voice.handleScheduleRelationship(scheduleRelationship)
      }
    }

    if (stopTimeUpdates?.length) {
      const fleet = this._fleet.get(vehicleId)
      const vehicleRoute = fleet ? this._routes?.find(r => r.name === fleet.routeShortName) : null
      if (vehicleRoute?.id) {
        for (const [key, at] of Object.entries(this._automationLanes)) {
          if (this._automationLaneCfgs[key]?.sourceRouteId === vehicleRoute.id)
            at.onTripUpdate(stopTimeUpdates)
        }
      }
    }
  }

  handleAlertUpdate(alerts) {
    this._alertLayer?.handleAlerts(alerts)
  }

  setSoundMode(routeShortName, mode, scale = { root: 'C', scaleType: 'major' }) {
    this._soundModes.set(routeShortName, { mode, scale })
    for (const [vehicleId, entry] of this._voices) {
      if (this._fleet.get(vehicleId)?.routeShortName === routeShortName) {
        entry.voice.setMode(mode, 0)
      }
    }
  }

  setScale(routeId, scale) {
    const entry = this._mockSynths.get(routeId)
    if (entry) this._mockSynths.set(routeId, { ...entry, scale })
  }

  // ── Transport-driven playback ─────────────────────────────────────────────────

  _createRouteSynths(routes, soundModes = {}, synthTypes = {}, adsr = {}) {
    for (const route of routes) {
      if (!route.stops?.length) continue
      if (this._automationSources.has(route.id)) continue

      const sm        = soundModes[route.id] ?? { mode: 'harmonic', scale: { root: 'C', scaleType: 'major' } }
      const synthType = synthTypes[route.id] ?? 'Synth'
      const isSpecialized = NO_HARMONY.has(synthType)
      const perc      = !isSpecialized && sm.mode === 'percussive'

      const defaultEnvelope = isSpecialized
        ? SYNTH_DEFAULTS[synthType]
        : perc
          ? { attack: 0.003, decay: 0.18, sustain: 0, release: 0.35 }
          : SYNTH_DEFAULTS[synthType] ?? { attack: 0.1, decay: 0.1, sustain: 0.6, release: 0.8 }

      const envelope = adsr[route.id] ?? defaultEnvelope
      const scale    = sm.scale ?? { root: 'C', scaleType: 'major' }

      this._createSingleRouteEntry(route.id, route.type, synthType, envelope, scale)
    }

    // Build static curves using each lane's source route's stops
    for (const [key, at] of Object.entries(this._automationLanes)) {
      const srcRouteId = this._automationLaneCfgs[key]?.sourceRouteId
      if (!srcRouteId) continue
      const srcRoute = routes.find(r => r.id === srcRouteId)
      if (srcRoute?.stops) at.buildStaticCurve(srcRoute.stops)
    }
  }

  startMock(routes, soundModes = {}, bpm = 120, synthTypes = {}, adsr = {}, effects = {}) {
    const LOOP_BEATS = 16  // 4 bars × 4 beats — matches the visual grid
    Tone.Transport.bpm.value = bpm
    const loopSec = (LOOP_BEATS / bpm) * 60

    this._routes = routes
    this._createFxBuses()
    this._createRouteSynths(routes, soundModes, synthTypes, adsr)

    Tone.Transport.loop    = true
    Tone.Transport.loopEnd = loopSec

    for (const route of routes) {
      if (!route.stops?.length || !route.totalDist) continue

      const gridStops = snapStopsToGrid(route.stops, route.totalDist)

      // Automation source routes: schedule data dispatch only (no notes)
      if (this._automationSources.has(route.id)) {
        gridStops.forEach((stop) => {
          const scheduleAt = (stop.cellIdx / GRID_TOTAL_CELLS) * loopSec
          Tone.Transport.schedule(() => {
            this._dispatchFromSourceRoute(route.id, stop.id, {
              lat: stop.lat, lng: stop.lng, stopIdx: stop.originalIdx,
            })
          }, scheduleAt)
        })
        continue
      }

      const entry = this._mockSynths.get(route.id)
      if (!entry) continue

      const noteDur = soundModes[route.id]?.mode !== 'percussive' ? '4n' : '8n'

      // Build auto pitch map once per route (geographic by default).
      // A manually-set pitchMap via setPitchMap() always wins.
      const { root: autoRoot = 'C', scaleType: autoScale = 'dorian' } = entry.scale ?? {}
      const autoRootMidi  = noteToMidi(`${autoRoot}3`)
      const autoModeScale = SCALES[autoScale] ?? MODES.dorian
      const autoStrategy  = this._pitchMapStrategies[route.id] ?? 'geographic'
      const autoPitchMap  = generatePitchMap(route.stops, autoRootMidi, autoModeScale, autoStrategy)

      gridStops.forEach((stop) => {
        const scheduleAt = (stop.cellIdx / GRID_TOTAL_CELLS) * loopSec

        Tone.Transport.schedule((time) => {
          if (this._soloRoutes.size > 0 && !this._soloRoutes.has(route.id)) return
          if (this._routeMuted[route.id]) return
          if (this._droneRoutes[route.id]?.enabled) return

          const e = this._mockSynths.get(route.id)
          if (!e) return
          const { root = 'C', scaleType = 'major' } = e.scale ?? {}
          const manualMap = this._pitchMaps[route.id]
          const rawNote   = (manualMap ?? autoPitchMap)[stop.originalIdx] ?? randomFromScale(root, scaleType)
          const note = shiftOctaveNote(rawNote, this._octaveShifts[route.id] ?? 0)
          this._triggerSynth(e, note, noteDur, time)
          this.onEvent({ routeShortName: route.name, stopName: stop.name, note, lineType: route.type })
        }, scheduleAt)
      })
    }

    Tone.Transport.start()
  }

  startLive(routes, soundModes = {}, bpm = 120, synthTypes = {}, adsr = {}, effects = {}) {
    const LOOP_BEATS = 16  // 4 bars × 4 beats — matches the visual grid
    Tone.Transport.bpm.value = bpm
    const loopSec = (LOOP_BEATS / bpm) * 60

    this._routes = routes
    this._createFxBuses()
    this._createRouteSynths(routes, soundModes, synthTypes, adsr)

    Tone.Transport.loop    = true
    Tone.Transport.loopEnd = loopSec
    Tone.Transport.start()
  }

  triggerLiveNote(routeId, routeType, note) {
    if (this._soloRoutes.size > 0 && !this._soloRoutes.has(routeId)) return
    if (this._routeMuted[routeId]) return
    if (this._droneRoutes[routeId]?.enabled) return

    const e = this._mockSynths.get(routeId)
    if (!e) return
    const dur  = '8n'
    const time = Math.max(Tone.now(), (e._lastTriggerTime ?? 0) + 0.001)
    e._lastTriggerTime = time
    this._triggerSynth(e, note, dur, time)
    this.onEvent({ routeShortName: routeId, note, lineType: routeType })
  }

  setSolo(routeId, isSoloed) {
    if (isSoloed) this._soloRoutes.add(routeId)
    else          this._soloRoutes.delete(routeId)
  }

  setDroneMode(routeId, enabled, rootNote = 'C3') {
    this._droneRoutes[routeId] = { enabled, rootNote }
    const entry = this._mockSynths.get(routeId)
    if (!entry) return
    if (enabled) entry.synth.triggerAttack(rootNote, Tone.now())
    else         entry.synth.triggerRelease(Tone.now())
  }

  setDroneRoot(routeId, rootNote) {
    const dr = this._droneRoutes[routeId]
    if (dr) dr.rootNote = rootNote
    if (!dr?.enabled) return
    const entry = this._mockSynths.get(routeId)
    if (entry?.synth?.frequency)
      entry.synth.frequency.rampTo(Tone.Frequency(rootNote).toFrequency(), 0.1)
  }

  setSynthType(routeId, routeType, synthType, envelope) {
    const entry = this._mockSynths.get(routeId)
    if (!entry) return

    entry.synth.dispose()
    entry.harmonySynth?.dispose()

    const synth = this._makeSynth(synthType, envelope ?? SYNTH_DEFAULTS[synthType] ?? {}, -18)
    synth.connect(entry.routeGain)

    const glide = this._glides[routeId]
    if (glide != null && 'portamento' in synth) {
      try { synth.portamento = glide } catch {}
    }

    this._mockSynths.set(routeId, { ...entry, synth, harmonySynth: null, harmonyInterval: 0, synthType })
  }

  updateEnvelope(routeId, params) {
    const e = this._mockSynths.get(routeId)
    if (!e) return
    e.synth.set(buildSynthOpts(e.synthType, params))
  }

  // ── DAW controls ─────────────────────────────────────────────────────────────

  setVolume(lineType, db) {
    this._volumes[lineType]?.set({ volume: db })
  }

  setMute(lineType, muted) {
    this._muted[lineType] = muted
    this._volumes[lineType]?.set({ mute: muted })
  }

  setPan(lineType, value) {
    this._panners[lineType]?.pan.rampTo(value, 0.05)
  }

  async start() {
    await Tone.start()
    this._started = true
  }

  stopMock() {
    if (this._netUpdateTimer) {
      clearTimeout(this._netUpdateTimer)
      this._netUpdateTimer = null
    }

    Tone.Transport.cancel()
    Tone.Transport.stop()
    Tone.Transport.position = 0

    for (const entry of this._mockSynths.values()) this._disposeRouteEntry(entry)
    this._mockSynths.clear()

    for (const gain of Object.values(this._sendGains)) gain.dispose()
    this._sendGains = {}

    for (const fxTrack of Object.values(this._fxTracks)) fxTrack.dispose()
    this._fxTracks = {}

    for (const [id, entry] of [...this._voices]) {
      entry.voice.dispose()
      this._voices.delete(id)
    }
    this._fleet.clear()

    this._netState?.stop()
    // _automationLanes, _automationLaneCfgs, and _pendingSends persist across start/stop
  }

  dispose() {
    this.stopMock()
    for (const at of Object.values(this._automationLanes)) at.dispose()
    this._automationLanes    = {}
    this._automationLaneCfgs = {}
    for (const { voice } of this._voices.values()) voice.dispose()
    this._voices.clear()
    Object.values(this._volumes).forEach(v => v.dispose())
    this._alertLayer?.dispose()
    this._netState?.dispose()
    if (this._netUpdateTimer) clearTimeout(this._netUpdateTimer)
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  _evictOldestVoice() {
    let oldestId   = null
    let oldestTime = Infinity
    for (const [id, entry] of this._voices) {
      if (entry.lastUpdated < oldestTime) {
        oldestTime = entry.lastUpdated
        oldestId   = id
      }
    }
    if (oldestId) {
      this._voices.get(oldestId).voice.dispose()
      this._voices.delete(oldestId)
      this._fleet.delete(oldestId)
    }
  }

  _scheduleNetworkUpdate() {
    if (this._netUpdateTimer) return
    this._netUpdateTimer = setTimeout(() => {
      this._netUpdateTimer = null
      this._netState?.update(this._fleet, this._alertLayer)
    }, 5000)
  }
}
