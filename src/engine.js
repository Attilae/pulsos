import * as Tone from 'tone'
import { AlertLayer }   from './alertLayer.js'
import { NetworkState } from './networkState.js'
import { VehicleVoice } from './vehicleVoice.js'
import { latToNote }    from './mappings.js'
import { LINES }        from './mockData.js'

export const LINE_TYPES = ['metro', 'tram', 'bus', 'hev']

const MAX_VOICES = 150  // voice pool ceiling to keep AudioNode count manageable

// Maps GTFS route_type to line type label (kept for UI colour lookup)
export const LINE_TYPE_COLORS = {
  metro: '#E2001A',
  tram:  '#FFD700',
  bus:   '#0066CC',
  hev:   '#009640',
}

export class TransitEngine {
  constructor(onEvent) {
    this.onEvent   = onEvent   // (ev) → UI callback
    this._started  = false

    // ── DAW channel volumes (one per line type) ───────────────────────────────
    // Vehicles connect here; volumes feed into alertLayer.input (reverb)
    this._volumes = {}   // lineType → Tone.Volume
    this._muted   = {}   // lineType → bool

    // ── Layers (created in init after Tone context is available) ─────────────
    this._alertLayer  = null
    this._netState    = null

    // ── Voice pool ────────────────────────────────────────────────────────────
    // Map<vehicleId, { voice: VehicleVoice, lastUpdated: number }>
    this._voices = new Map()

    // Fleet state for NetworkState.update()  (lat/lng/note per vehicle)
    this._fleet  = new Map()  // vehicleId → { lat, lng, note, lineType, currentStatus }

    // Mock mode
    this._loops = {}
  }

  init() {
    // AlertLayer owns the master bus: reverb → compressor → limiter → destination
    this._alertLayer = new AlertLayer()

    // One Volume node per line type, connected into the alert layer's reverb
    for (const type of LINE_TYPES) {
      const vol = new Tone.Volume(0)
      vol.connect(this._alertLayer.input)
      this._volumes[type] = vol
      this._muted[type]   = false
    }

    // NetworkState ambient layer also goes through alert layer's reverb
    this._netState = new NetworkState(this._alertLayer.input)
  }

  // ── Compute note for a latitude using the current mode & root ───────────────
  computeNote(lat) {
    const scale = this._alertLayer?.currentModeScale
    const root  = this._netState?.rootMidi ?? 62
    return latToNote(lat, root, scale)
  }

  // ── Live data handlers ───────────────────────────────────────────────────────

  // Called for every vehicle position/trip update from the server
  handleVehicleUpdate(data) {
    const {
      vehicleId, lineType, lat, lng, bearing, speed,
      currentStatus, occupancyPct, carriageDetails,
      delay, uncertainty, scheduleRelationship,
      stopId, stopName, routeShortName, color,
    } = data

    if (!vehicleId || !lineType) return

    const note = this.computeNote(lat ?? 47.49)

    // Update fleet record for NetworkState aggregation
    this._fleet.set(vehicleId, { lat: lat ?? 47.49, lng: lng ?? 19.05, note, lineType, currentStatus })

    // Maintain voice pool
    let entry = this._voices.get(vehicleId)

    // Only allocate a voice if the vehicle is at or approaching a stop
    const needsVoice = currentStatus === 0 || currentStatus === 1
    if (!entry && needsVoice) {
      if (this._voices.size >= MAX_VOICES) this._evictOldestVoice()
      const outputNode = this._volumes[lineType]
      if (outputNode) {
        const voice = new VehicleVoice(outputNode)
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

    // Arrival event (STOPPED_AT) → notify UI + network state
    if (currentStatus === 1) {
      this._netState?.recordArrival()
      this.onEvent({
        vehicleId, lineType, lineId: routeShortName ?? vehicleId,
        stopId, stopName, note,
        routeShortName, color,
      })
    }

    // Periodically refresh NetworkState (no more than once per 5 s)
    this._scheduleNetworkUpdate()
  }

  handleTripUpdate(data) {
    // Trip updates arrive separately and may update delay/relationship
    const { vehicleId, delay, uncertainty, scheduleRelationship } = data
    const entry = this._voices.get(vehicleId)
    if (!entry) return
    entry.voice.update({
      delay, uncertainty,
      // Keep existing note/status — only refresh the schedule-sensitive fields
      currentStatus: -1,  // sentinel: don't re-trigger envelope
    })
    if (scheduleRelationship != null && scheduleRelationship !== 0) {
      entry.voice.handleScheduleRelationship(scheduleRelationship)
    }
  }

  handleAlertUpdate(alerts) {
    this._alertLayer?.handleAlerts(alerts)
  }

  // ── Mock mode ────────────────────────────────────────────────────────────────

  startMock() {
    for (const line of LINES) {
      const intervalSec = 60 / line.bpm
      let index     = 0
      let direction = 1
      let subPhase  = 'stopped'  // 'stopped' | 'transit'

      const vehicleId = `mock_${line.id}`

      const loop = new Tone.Loop((time) => {
        const stop     = line.stops[index]
        const nextStop = line.stops[index + direction] ?? line.stops[index - direction]
        const note     = this.computeNote(stop.lat)

        // Bearing: rough cardinal direction toward next stop
        const bearing = nextStop
          ? (nextStop.lat > stop.lat ? 0 : 180)   // north/south approximation
          : 0

        // Emit INCOMING_AT at start of interval
        this.handleVehicleUpdate({
          vehicleId,
          lineType: line.type,
          lat: stop.lat, lng: stop.lng ?? 19.05,
          bearing, speed: 4,
          currentStatus: 0,   // INCOMING_AT
          occupancyPct: 55,
          delay: 0, uncertainty: 5, scheduleRelationship: 0,
          stopId: stop.id, stopName: stop.name,
          routeShortName: line.name, color: line.color,
        })

        // Switch to STOPPED_AT after 0.5 s
        Tone.Transport.scheduleOnce(() => {
          this.handleVehicleUpdate({
            vehicleId,
            lineType: line.type,
            lat: stop.lat, lng: stop.lng ?? 19.05,
            bearing: 0, speed: 0,
            currentStatus: 1,   // STOPPED_AT
            occupancyPct: 60,
            delay: 0, uncertainty: 5, scheduleRelationship: 0,
            stopId: stop.id, stopName: stop.name,
            routeShortName: line.name, color: line.color,
          })
          // UI mock-active tracking
          if (this.onMockActive) this.onMockActive(line.id, stop.id)
        }, time + 0.5)

        // IN_TRANSIT_TO after 2.5 s
        Tone.Transport.scheduleOnce(() => {
          this.handleVehicleUpdate({
            vehicleId,
            lineType: line.type,
            lat: stop.lat, lng: stop.lng ?? 19.05,
            bearing, speed: 10,
            currentStatus: 2,   // IN_TRANSIT_TO
            occupancyPct: 55,
            delay: 0, uncertainty: 10, scheduleRelationship: 0,
            stopId: stop.id, stopName: stop.name,
            routeShortName: line.name, color: line.color,
          })
        }, time + 2.5)

        // Advance stop index (ping-pong)
        index += direction
        if (index >= line.stops.length) { index = line.stops.length - 2; direction = -1 }
        if (index < 0)                  { index = 1;                      direction = 1 }
      }, intervalSec)

      loop.start(0)
      this._loops[line.id] = loop
    }
    Tone.getTransport().start()
  }

  stopMock() {
    Object.values(this._loops).forEach(l => l.dispose())
    this._loops = {}
    // Release all mock voices
    for (const [id, entry] of this._voices) {
      if (id.startsWith('mock_')) {
        entry.voice.dispose()
        this._voices.delete(id)
      }
    }
    this._fleet.clear()
    Tone.getTransport().stop()
    Tone.getTransport().position = 0
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
    let oldestId  = null
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
