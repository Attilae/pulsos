import * as Tone from 'tone'
import {
  computeCentroid, boundingBoxArea,
  centroidToRootMidi,
  droneModIndex, droneVolDb,
  haversineMetres, latToNote,
  MODES,
} from './mappings.js'

// Major Budapest interchange hubs — used for hub convergence chords
const HUBS = [
  { name: 'Deák Ferenc tér',  lat: 47.4984, lng: 19.0510 },
  { name: 'Keleti pu.',       lat: 47.5000, lng: 19.0832 },
  { name: 'Kelenföld',        lat: 47.4633, lng: 18.9791 },
  { name: 'Kőbánya-Kispest',  lat: 47.4380, lng: 19.1495 },
  { name: 'Széll Kálmán tér', lat: 47.5100, lng: 18.9991 },
  { name: 'Árpád híd',        lat: 47.5420, lng: 19.0547 },
]
const HUB_RADIUS_M      = 500   // metres
const HUB_CLUSTER_MIN   = 6     // minimum vehicles to activate hub chord
const PEAK_VEHICLES     = 1000  // expected fleet size at peak hour

// Manages fleet-wide aggregate state:
//  - Dynamic root note from centroid latitude
//  - Network density drone (FMSynth background hum)
//  - Hub convergence chords (PolySynth chords at busy interchanges)
export class NetworkState {
  constructor(outputNode) {
    // All network audio → outputNode (the alert layer's reverb input)
    this._out = outputNode

    // Rolling root MIDI (updated slowly)
    this.rootMidi = 62  // D4 default (Dorian on D is a classic urban feel)

    // ── Network density drone ─────────────────────────────────────────────────
    this._drone = new Tone.FMSynth({
      oscillator:  { type: 'sine' },
      envelope:    { attack: 6, decay: 0, sustain: 1, release: 6 },
      modulation:  { type: 'sine' },
      modulationEnvelope: { attack: 6, decay: 0, sustain: 1, release: 6 },
      harmonicity: 1,
      modulationIndex: 1,
      volume: -28,
    })
    this._droneActive = false
    this._drone.connect(outputNode)

    // ── Hub PolySynths ────────────────────────────────────────────────────────
    this._hubSynths = HUBS.map(() => {
      const ps = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 2.0, decay: 0.5, sustain: 0.7, release: 4.0 },
        volume: -22,
      })
      ps.connect(outputNode)
      return ps
    })
    this._hubActiveNotes = HUBS.map(() => new Set())

    // Inter-arrival tracking for effective tempo
    this._lastArrivalTime   = null
    this._intervalSamples   = []   // last 20 inter-arrival intervals (ms)
    this._effectiveTempoBpm = null
  }

  // Called every poll cycle with the full set of known active vehicles.
  // vehicles: Map<vehicleId, { lat, lng, note, lineType, currentStatus }>
  update(vehicles, alertLayer) {
    const positions = [...vehicles.values()].filter(v => v.lat && v.lng)
    if (!positions.length) return

    // ── Dynamic root from centroid ─────────────────────────────────────────────
    const centroid = computeCentroid(positions)
    const newRoot  = centroidToRootMidi(centroid.lat)
    if (newRoot !== this.rootMidi) {
      // Glide root over 16 seconds to avoid abrupt pitch shifts
      setTimeout(() => { this.rootMidi = newRoot }, 16000)
    }

    // ── Drone ─────────────────────────────────────────────────────────────────
    const area = boundingBoxArea(positions)
    const modIdx = droneModIndex(positions.length, PEAK_VEHICLES, area)
    const volDb  = droneVolDb(positions.length, PEAK_VEHICLES)
    const modeScale = alertLayer?.currentModeScale ?? MODES.dorian
    const droneNote = latToNote(centroid.lat, this.rootMidi, modeScale)

    this._drone.modulationIndex.rampTo(modIdx, 8.0)
    this._drone.volume.rampTo(volDb, 8.0)

    if (!this._droneActive) {
      this._drone.triggerAttack(droneNote, Tone.now())
      this._droneActive = true
    } else {
      this._drone.frequency.rampTo(
        Tone.Frequency(droneNote).toFrequency(), 16.0
      )
    }

    // ── Hub convergence chords ────────────────────────────────────────────────
    HUBS.forEach((hub, i) => {
      const nearby = positions.filter(v =>
        haversineMetres(v.lat, v.lng, hub.lat, hub.lng) <= HUB_RADIUS_M
      )
      const hubSynth     = this._hubSynths[i]
      const prevNotes    = this._hubActiveNotes[i]
      const currentNotes = new Set(
        nearby.slice(0, 8).map(v => v.note).filter(Boolean)
      )

      // Release notes for vehicles that left the hub
      for (const n of prevNotes) {
        if (!currentNotes.has(n)) hubSynth.triggerRelease(n, Tone.now())
      }

      // Attack notes for vehicles newly arrived at hub
      if (nearby.length >= HUB_CLUSTER_MIN) {
        for (const n of currentNotes) {
          if (!prevNotes.has(n)) hubSynth.triggerAttack(n, Tone.now())
        }
      } else {
        // Below threshold — release all
        for (const n of prevNotes) hubSynth.triggerRelease(n, Tone.now())
        currentNotes.clear()
      }

      this._hubActiveNotes[i] = currentNotes
    })
  }

  // Track arrival events to compute effective tempo
  recordArrival() {
    const now = Date.now()
    if (this._lastArrivalTime !== null) {
      const interval = now - this._lastArrivalTime
      this._intervalSamples.push(interval)
      if (this._intervalSamples.length > 20) this._intervalSamples.shift()

      const avgInterval = this._intervalSamples.reduce((a, b) => a + b, 0)
        / this._intervalSamples.length
      // Convert ms interval to BPM equivalent (just informational, not used for scheduling)
      this._effectiveTempoBpm = 60000 / avgInterval
    }
    this._lastArrivalTime = now
  }

  get effectiveTempoBpm() { return this._effectiveTempoBpm }

  // Release all active audio without disposing nodes (so they can be reused on next play).
  stop() {
    if (this._droneActive) {
      this._drone.triggerRelease(Tone.now())
      this._droneActive = false
    }
    this._hubSynths.forEach((ps, i) => {
      for (const n of this._hubActiveNotes[i]) ps.triggerRelease(n, Tone.now())
      this._hubActiveNotes[i].clear()
    })
  }

  dispose() {
    this.stop()
    this._drone.dispose()
    this._hubSynths.forEach(ps => ps.dispose())
  }
}
