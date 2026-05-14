import * as Tone from 'tone'
import { AlertLayer }   from './alertLayer.js'
import { NetworkState } from './networkState.js'
import { VehicleVoice } from './vehicleVoice.js'
import { latToNote, randomFromScale } from './mappings.js'

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
  Synth:         { attack: 0.005, decay: 0.1,  sustain: 0.3, release: 1.0 },
  FMSynth:       { attack: 0.4,   decay: 0.1,  sustain: 1.0, release: 1.4 },
  AMSynth:       { attack: 0.1,   decay: 0.2,  sustain: 0.5, release: 0.8 },
  MonoSynth:     { attack: 0.005, decay: 0.3,  sustain: 0.5, release: 0.8 },
  MembraneSynth: { attack: 0.001, decay: 0.4,  sustain: 0.0, release: 0.1 },
  MetalSynth:    { attack: 0.001, decay: 0.4,  sustain: 0.0, release: 0.3 },
  NoiseSynth:    { attack: 0.005, decay: 0.1,  sustain: 0.0, release: 0.1 },
  PluckSynth:    { attackNoise: 1, dampening: 4000, resonance: 0.7 },
  DuoSynth:      { attack: 0.1,   decay: 0.2,  sustain: 0.5, release: 0.8 },
}

export const EFFECT_TYPES = ['None', 'Chorus', 'PingPongDelay', 'BitCrusher', 'Phaser']

export const EFFECT_DEFAULTS = {
  None:          {},
  Chorus:        { frequency: 1.5, delayTime: 3.5, depth: 0.7, wet: 0.5 },
  PingPongDelay: { delayTime: 0.25, feedback: 0.3, wet: 0.4 },
  BitCrusher:    { bits: 6, wet: 1.0 },
  Phaser:        { frequency: 0.5, octaves: 3, baseFrequency: 1000, wet: 0.5 },
}

// Synths that ignore pitch / have no standard ADSR
const NO_HARMONY = new Set(['MembraneSynth', 'MetalSynth', 'NoiseSynth', 'PluckSynth'])

export class TransitEngine {
  constructor(onEvent) {
    this.onEvent   = onEvent
    this._started  = false

    this._volumes = {}
    this._muted   = {}

    this._alertLayer  = null
    this._netState    = null

    this._voices = new Map()
    this._fleet  = new Map()

    this._soundModes = new Map()

    this._mockSynths = new Map()
    this._soloRoutes = new Set()

    this._netUpdateTimer = null
  }

  init() {
    this._alertLayer = new AlertLayer()

    for (const type of LINE_TYPES) {
      const vol = new Tone.Volume(0)
      vol.connect(this._alertLayer.input)
      this._volumes[type] = vol
      this._muted[type]   = false
    }

    this._netState = new NetworkState(this._alertLayer.input)
  }

  computeNote(lat) {
    const scale = this._alertLayer?.currentModeScale
    const root  = this._netState?.rootMidi ?? 62
    return latToNote(lat, root, scale)
  }

  // ── Synth factory ─────────────────────────────────────────────────────────────

  _makeSynth(synthType, opts = {}) {
    const { envelope, volume = -18 } = opts

    if (synthType === 'PluckSynth') {
      const ps = new Tone.PluckSynth({ volume })
      if (envelope?.dampening  != null) ps.dampening  = envelope.dampening
      if (envelope?.resonance  != null) ps.resonance  = envelope.resonance
      if (envelope?.attackNoise != null) ps.attackNoise = envelope.attackNoise
      return ps
    }

    if (synthType === 'DuoSynth') {
      return new Tone.DuoSynth({
        volume,
        ...(envelope ? { voice0: { envelope }, voice1: { envelope } } : {}),
      })
    }

    const synthOpts = { volume, ...(envelope ? { envelope } : {}) }
    switch (synthType) {
      case 'FMSynth':       return new Tone.FMSynth(synthOpts)
      case 'AMSynth':       return new Tone.AMSynth(synthOpts)
      case 'MonoSynth':     return new Tone.MonoSynth(synthOpts)
      case 'MembraneSynth': return new Tone.MembraneSynth(synthOpts)
      case 'MetalSynth':    return new Tone.MetalSynth(synthOpts)
      case 'NoiseSynth':    return new Tone.NoiseSynth(synthOpts)
      default:              return new Tone.Synth(synthOpts)
    }
  }

  // ── Effect factory ────────────────────────────────────────────────────────────

  _makeEffect(effectType, params = {}) {
    switch (effectType) {
      case 'Chorus':        return new Tone.Chorus(params).start()
      case 'PingPongDelay': return new Tone.PingPongDelay(params)
      case 'BitCrusher':    return new Tone.BitCrusher(params)
      case 'Phaser':        return new Tone.Phaser(params)
      default:              return null
    }
  }

  // Wire source → (optional effect) → dest
  _connectSynth(source, effect, dest) {
    if (effect) {
      source.connect(effect)
      effect.connect(dest)
    } else {
      source.connect(dest)
    }
  }

  // Handles pitch-less and one-shot synths uniformly
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

  // ── Legacy live data handlers (WebSocket mode) ───────────────────────────────

  handleVehicleUpdate(data) {
    const {
      vehicleId, lineType, lat, lng, bearing, speed,
      currentStatus, occupancyPct, carriageDetails,
      delay, uncertainty, scheduleRelationship,
      stopId, stopName, routeShortName, color,
    } = data

    if (!vehicleId || !lineType) return

    const note = this.computeNote(lat ?? 47.49)

    this._fleet.set(vehicleId, { lat: lat ?? 47.49, lng: lng ?? 19.05, note, lineType, currentStatus, routeShortName })

    let entry = this._voices.get(vehicleId)

    const needsVoice = currentStatus === 0 || currentStatus === 1
    if (!entry && needsVoice) {
      if (this._voices.size >= 150) this._evictOldestVoice()
      const outputNode = this._volumes[lineType]
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
      entry.voice.update({
        note, lat, lng, bearing, speed,
        currentStatus, occupancyPct, carriageDetails,
        delay, uncertainty,
      })

      if (scheduleRelationship != null && scheduleRelationship !== 0) {
        entry.voice.handleScheduleRelationship(scheduleRelationship)
      }
    }

    if (currentStatus === 1) {
      this._netState?.recordArrival()
      this.onEvent({
        vehicleId, lineType, lineId: routeShortName ?? vehicleId,
        stopId, stopName, note,
        routeShortName, color,
      })
    }

    this._scheduleNetworkUpdate()
  }

  handleTripUpdate(data) {
    const { vehicleId, delay, uncertainty, scheduleRelationship } = data
    const entry = this._voices.get(vehicleId)
    if (!entry) return
    entry.voice.update({ delay, uncertainty, currentStatus: -1 })
    if (scheduleRelationship != null && scheduleRelationship !== 0) {
      entry.voice.handleScheduleRelationship(scheduleRelationship)
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

  _createRouteSynths(routes, soundModes = {}, synthTypes = {}, adsr = {}, effects = {}) {
    for (const route of routes) {
      if (!route.stops?.length) continue

      const sm        = soundModes[route.id] ?? { mode: 'harmonic', scale: { root: 'C', scaleType: 'major' } }
      const synthType = synthTypes[route.id] ?? 'Synth'
      const isSpecialized = NO_HARMONY.has(synthType)
      const perc      = !isSpecialized && sm.mode === 'percussive'

      const defaultEnvelope = isSpecialized
        ? SYNTH_DEFAULTS[synthType]
        : perc
          ? { attack: 0.003, decay: 0.18, sustain: 0, release: 0.35 }
          : SYNTH_DEFAULTS[synthType] ?? { attack: 0.1, decay: 0.1, sustain: 0.6, release: 0.8 }

      const envelope  = adsr[route.id] ?? defaultEnvelope
      const effectCfg = effects[route.id]
      const effect    = this._makeEffect(effectCfg?.type, effectCfg?.params ?? {})

      const synth = this._makeSynth(synthType, { envelope, volume: -18 })
      const out   = this._volumes[route.type] ?? this._alertLayer.input
      this._connectSynth(synth, effect, out)

      this._mockSynths.set(route.id, {
        synth, harmonySynth: null, harmonyInterval: 0,
        routeType: route.type, synthType, effect,
        scale: sm.scale ?? { root: 'C', scaleType: 'major' },
      })
    }
  }

  startMock(routes, soundModes = {}, bpm = 120, synthTypes = {}, adsr = {}, effects = {}) {
    const LOOP_BEATS = 32
    Tone.Transport.bpm.value = bpm
    const loopSec = (LOOP_BEATS / bpm) * 60

    this._createRouteSynths(routes, soundModes, synthTypes, adsr, effects)

    Tone.Transport.loop    = true
    Tone.Transport.loopEnd = loopSec

    for (const route of routes) {
      if (!route.stops?.length || !route.totalDist) continue
      const noteDur = soundModes[route.id]?.mode !== 'percussive' ? '4n' : '8n'

      route.stops.forEach(stop => {
        const pct        = stop.dist / route.totalDist
        const scheduleAt = pct * loopSec

        Tone.Transport.schedule((time) => {
          if (this._soloRoutes.size > 0 && !this._soloRoutes.has(route.id)) return
          if (this._muted[route.type]) return

          const e = this._mockSynths.get(route.id)
          if (!e) return
          const { root = 'C', scaleType = 'major' } = e.scale ?? {}
          const note = randomFromScale(root, scaleType)
          this._triggerSynth(e, note, noteDur, time)
          this.onEvent({ routeShortName: route.name, stopName: stop.name, note, lineType: route.type })
        }, scheduleAt)
      })
    }

    Tone.Transport.start()
  }

  startLive(routes, soundModes = {}, bpm = 120, synthTypes = {}, adsr = {}, effects = {}) {
    const LOOP_BEATS = 32
    Tone.Transport.bpm.value = bpm
    const loopSec = (LOOP_BEATS / bpm) * 60

    this._createRouteSynths(routes, soundModes, synthTypes, adsr, effects)

    Tone.Transport.loop    = true
    Tone.Transport.loopEnd = loopSec
    Tone.Transport.start()
  }

  triggerLiveNote(routeId, routeType, note) {
    if (this._soloRoutes.size > 0 && !this._soloRoutes.has(routeId)) return
    if (this._muted[routeType]) return

    const e = this._mockSynths.get(routeId)
    if (!e) return
    const dur = e.harmonySynth ? '4n' : '8n'
    // Guarantee strictly increasing start times for the same synth instance
    const time = Math.max(Tone.now(), (e._lastTriggerTime ?? 0) + 0.001)
    e._lastTriggerTime = time
    this._triggerSynth(e, note, dur, time)
    this.onEvent({ routeShortName: routeId, note, lineType: routeType })
  }

  setSolo(routeId, isSoloed) {
    if (isSoloed) this._soloRoutes.add(routeId)
    else          this._soloRoutes.delete(routeId)
  }

  // Hot-swap synth type while preserving the existing effect
  setSynthType(routeId, routeType, synthType, envelope) {
    const entry = this._mockSynths.get(routeId)
    if (!entry) return

    entry.synth.dispose()
    entry.harmonySynth?.dispose()

    const out   = this._volumes[routeType] ?? this._alertLayer.input
    const synth = this._makeSynth(synthType, { envelope: envelope ?? SYNTH_DEFAULTS[synthType], volume: -18 })
    this._connectSynth(synth, entry.effect, out)

    this._mockSynths.set(routeId, {
      ...entry,
      synth,
      harmonySynth: null,
      harmonyInterval: 0,
      synthType,
    })
  }

  // Hot-swap effect while preserving the synth
  setEffect(routeId, routeType, effectType, params) {
    const entry = this._mockSynths.get(routeId)
    if (!entry) return

    const out = this._volumes[routeType] ?? this._alertLayer.input

    try { entry.synth.disconnect() }       catch {}
    try { entry.harmonySynth?.disconnect() } catch {}
    if (entry.effect) {
      try { entry.effect.disconnect() } catch {}
      entry.effect.dispose()
    }

    const effect = this._makeEffect(effectType, params ?? {})
    this._connectSynth(entry.synth, effect, out)
    if (entry.harmonySynth) this._connectSynth(entry.harmonySynth, effect, out)

    this._mockSynths.set(routeId, { ...entry, effect })
  }

  setEffectParams(routeId, params) {
    const e = this._mockSynths.get(routeId)
    if (e?.effect) e.effect.set(params)
  }

  updateEnvelope(routeId, params) {
    const e = this._mockSynths.get(routeId)
    if (!e) return

    if (e.synthType === 'PluckSynth') {
      const { attackNoise, dampening, resonance } = params
      if (attackNoise  != null) e.synth.set({ attackNoise })
      if (dampening    != null) e.synth.set({ dampening })
      if (resonance    != null) e.synth.set({ resonance })
    } else if (e.synthType === 'DuoSynth') {
      e.synth.set({ voice0: { envelope: params }, voice1: { envelope: params } })
    } else {
      e.synth.set({ envelope: params })
    }
  }

  // ── DAW controls ─────────────────────────────────────────────────────────────

  setVolume(lineType, db) {
    this._volumes[lineType]?.set({ volume: db })
  }

  setMute(lineType, muted) {
    this._muted[lineType] = muted
    this._volumes[lineType]?.set({ mute: muted })
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

    for (const { synth, harmonySynth, effect } of this._mockSynths.values()) {
      synth.dispose()
      harmonySynth?.dispose()
      effect?.dispose()
    }
    this._mockSynths.clear()

    for (const [id, entry] of [...this._voices]) {
      entry.voice.dispose()
      this._voices.delete(id)
    }
    this._fleet.clear()

    this._netState?.stop()
  }

  dispose() {
    this.stopMock()
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
