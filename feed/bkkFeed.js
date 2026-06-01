import gtfsRealtime from 'gtfs-realtime-bindings'
import { EventEmitter } from 'events'
import { latToNote } from './pitch.js'

const { transit_realtime } = gtfsRealtime

const BASE = 'https://go.bkk.hu/api/query/v1/ws/gtfs-rt/full'
const VP_URL    = `${BASE}/VehiclePositions.pb`
const TU_URL    = `${BASE}/TripUpdates.pb`
const AL_URL    = `${BASE}/Alerts.pb`
const POLL_MS   = 5000
const ALERT_MS  = 60000  // alerts change slowly; poll every minute

// OccupancyStatus enum → approximate percentage
const OCCUPANCY_PCT = [5, 25, 50, 70, 88, 100, 100, 50, 50]

// TripDescriptor.ScheduleRelationship enum values
const SR = { SCHEDULED: 0, ADDED: 1, UNSCHEDULED: 2, CANCELED: 3, REPLACEMENT: 5, DUPLICATED: 6, DELETED: 7 }

export class BkkFeed extends EventEmitter {
  constructor(apiKey, gtfsLookup) {
    super()
    this.apiKey     = apiKey
    this.lookup     = gtfsLookup
    this.prevState  = new Map()  // vehicleId → full vehicle state snapshot
    this.tripData   = new Map()  // vehicleId → { delay, uncertainty, scheduleRelationship }
    this.metroTrips = new Map()  // tripId → { vehicleId, routeId, stopTimeUpdates }
    this._vpTimer   = null
    this._alTimer   = null
  }

  start() {
    this._pollPositions()
    this._pollAlerts()
    this._vpTimer = setInterval(() => this._pollPositions(), POLL_MS)
    this._alTimer = setInterval(() => this._pollAlerts(), ALERT_MS)
  }

  stop() {
    clearInterval(this._vpTimer)
    clearInterval(this._alTimer)
    this._vpTimer = null
    this._alTimer = null
  }

  // ── Fetch helper ─────────────────────────────────────────────────────────────
  async _fetch(url) {
    const res = await fetch(`${url}?key=${this.apiKey}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    const buf  = await res.arrayBuffer()
    return transit_realtime.FeedMessage.decode(new Uint8Array(buf))
  }

  // ── Trip Updates (merged with Vehicle Positions each poll) ───────────────────
  async _fetchTripUpdates() {
    try {
      const feed = await this._fetch(TU_URL)
      this.tripData.clear()
      this.metroTrips.clear()


      for (const entity of feed.entity) {
        const tu = entity.tripUpdate
        if (!tu) continue

        const tripId    = tu.trip?.tripId || null
        const vehicleId = tu.vehicle?.id || (tripId ? `trip:${tripId}` : entity.id)
        if (!vehicleId) continue

        // Overall trip delay (fallback: first stop arrival delay)
        let delay = tu.delay ?? null
        let uncertainty = null
        if (delay === null && tu.stopTimeUpdate?.length) {
          const stu = tu.stopTimeUpdate[0]
          delay       = stu.arrival?.delay ?? stu.departure?.delay ?? 0
          uncertainty = stu.arrival?.uncertainty ?? stu.departure?.uncertainty ?? null
        }

        const scheduleRelationship = tu.trip?.scheduleRelationship ?? SR.SCHEDULED

        this.tripData.set(vehicleId, {
          delay:                delay ?? 0,
          uncertainty:          uncertainty ?? 0,
          scheduleRelationship,
        })

        // Collect metro trips for position inference
        const routeId = tu.trip?.routeId
          ?? (tripId ? this.lookup.tripRoutes?.[tripId] : null)
        if (!routeId) continue

        const route = this.lookup.routes[routeId]
        if (!route || route.lineType !== 'metro') continue
        if (!tu.stopTimeUpdate?.length) continue
        if (scheduleRelationship === SR.CANCELED) continue

        this.metroTrips.set(tripId ?? vehicleId, {
          vehicleId,
          routeId,
          stopTimeUpdates: tu.stopTimeUpdate,
        })
      }
    } catch (err) {
      // Trip updates are non-critical — continue without them
      console.warn('[bkk] trip update fetch failed:', err.message)
    }
  }

  // ── Infer metro vehicle positions from TripUpdates ────────────────────────────
  _emitMetroUpdates() {
    const nowSec = Date.now() / 1000

    for (const [, trip] of this.metroTrips) {
      const { vehicleId, routeId, stopTimeUpdates } = trip
      const route = this.lookup.routes[routeId]
      if (!route) continue

      // Walk through stop time updates to find where the vehicle is now.
      // Each entry has arrival.time and/or departure.time (unix seconds, Long).
      let status  = 2   // IN_TRANSIT_TO (default: before first stop)
      let stopId  = stopTimeUpdates[0]?.stopId ?? null

      for (let i = 0; i < stopTimeUpdates.length; i++) {
        const stu     = stopTimeUpdates[i]
        const arrSec  = stu.arrival?.time   ? Number(stu.arrival.time)   : null
        const depSec  = stu.departure?.time ? Number(stu.departure.time) : null

        const arrived   = arrSec !== null && arrSec <= nowSec
        const departed  = depSec !== null && depSec <= nowSec

        if (arrived && !departed) {
          // Currently stopped at this stop
          stopId = stu.stopId
          status = 1  // STOPPED_AT
          break
        }

        if (departed) {
          // Past this stop — look at next
          const next = stopTimeUpdates[i + 1]
          if (!next) {
            // Past last stop — trip finished, skip
            stopId = null
            break
          }
          stopId = next.stopId
          status = 2  // IN_TRANSIT_TO next
          // keep looping in case we've passed several stops
        }
      }

      if (!stopId) continue

      const stop = this.lookup.stops[stopId]
      if (!stop?.lat) continue

      const prev       = this.prevState.get(vehicleId) ?? {}
      const newArrival = status === 1 && (prev.stopId !== stopId || prev.status !== 1)
      const hasChanged = prev.status !== status || prev.stopId !== stopId

      if (!hasChanged) continue

      const td = this.tripData.get(vehicleId) ?? { delay: 0, uncertainty: 0, scheduleRelationship: 0 }

      this.prevState.set(vehicleId, {
        vehicleId, routeId,
        routeShortName: route.shortName, lineType: route.lineType, color: route.color,
        stopId, stopName: stop.name,
        status, lat: stop.lat, lng: stop.lng,
        bearing: 0, speed: 0, occupancyPct: 50, delay: td.delay,
      })

      this.emit('vehicle_update', {
        vehicleId,
        routeId,
        routeShortName:       route.shortName,
        lineType:             route.lineType,
        color:                route.color,
        stopId,
        stopName:             stop.name,
        lat:                  stop.lat,
        lng:                  stop.lng,
        bearing:              0,
        speed:                0,
        currentStatus:        status,
        occupancyPct:         50,
        carriageDetails:      null,
        delay:                td.delay,
        uncertainty:          td.uncertainty,
        scheduleRelationship: td.scheduleRelationship,
        note:                 latToNote(stop.lat),
      })

      if (newArrival) {
        this.emit('arrival', {
          vehicleId,
          routeId,
          routeShortName: route.shortName,
          lineType:       route.lineType,
          color:          route.color,
          stopId,
          stopName:       stop.name,
          lat:            stop.lat,
          lng:            stop.lng,
          note:           latToNote(stop.lat),
        })
      }
    }
  }

  // ── Main poll: Vehicle Positions + Trip Updates ──────────────────────────────
  async _pollPositions() {
    try {
      // Fetch both feeds concurrently
      const [vpFeed] = await Promise.all([
        this._fetch(VP_URL),
        this._fetchTripUpdates(),
      ])

      let arrivals = 0
      let updates  = 0

      for (const entity of vpFeed.entity) {
        const v = entity.vehicle
        if (!v?.trip) continue

        const vehicleId = v.vehicle?.id || entity.id
        const routeId   = v.trip.routeId
        const stopId    = v.stopId
        const status    = v.currentStatus ?? 2  // default IN_TRANSIT_TO

        const lat = v.position?.latitude  ?? null
        const lng = v.position?.longitude ?? null
        const bearing = v.position?.bearing ?? 0
        const speed   = v.position?.speed   ?? 0

        const occupancyPct = v.occupancyPercentage != null
          ? v.occupancyPercentage
          : (v.occupancyStatus != null ? OCCUPANCY_PCT[v.occupancyStatus] : null)

        const carriageDetails = v.multiCarriageDetails?.length
          ? v.multiCarriageDetails.map(c => ({
              label:         c.label ?? null,
              occupancyPct:  c.occupancyPercentage ?? (c.occupancyStatus != null ? OCCUPANCY_PCT[c.occupancyStatus] : null),
            }))
          : null

        const route = this.lookup.routes[routeId]
        if (!route) continue

        const stop  = this.lookup.stops[stopId]
        const vehicleLat = lat ?? stop?.lat
        const vehicleLng = lng ?? stop?.lng

        if (!vehicleLat) continue

        const td = this.tripData.get(vehicleId) ?? { delay: 0, uncertainty: 0, scheduleRelationship: 0 }

        const prev     = this.prevState.get(vehicleId) ?? {}
        const newArrival = status === 1 && (prev.stopId !== stopId || prev.status !== 1)

        // Determine if state has changed enough to broadcast an update
        const speedChanged   = Math.abs((prev.speed   ?? 0) - speed)   > 0.5
        const bearingChanged = Math.abs((prev.bearing ?? 0) - bearing) > 5
        const statusChanged  = prev.status !== status
        const stopChanged    = prev.stopId !== stopId
        const delayChanged   = Math.abs((prev.delay   ?? 0) - td.delay) > 5

        const hasChanged = statusChanged || stopChanged || speedChanged || bearingChanged || delayChanged

        // Persist full state (with route info for snapshot endpoint)
        this.prevState.set(vehicleId, {
          vehicleId, routeId,
          routeShortName: route.shortName, lineType: route.lineType, color: route.color,
          stopId, stopName: stop?.name ?? null,
          status, lat: vehicleLat, lng: vehicleLng ?? 19.05,
          bearing, speed, occupancyPct: occupancyPct ?? 50, delay: td.delay,
        })

        // Broadcast full vehicle_update when something meaningful changed
        if (hasChanged) {
          updates++
          this.emit('vehicle_update', {
            vehicleId,
            routeId,
            routeShortName:       route.shortName,
            lineType:             route.lineType,
            color:                route.color,
            stopId:               stopId ?? null,
            stopName:             stop?.name ?? null,
            lat:                  vehicleLat,
            lng:                  vehicleLng ?? 19.05,
            bearing,
            speed,
            currentStatus:        status,
            occupancyPct:         occupancyPct ?? 50,
            carriageDetails,
            delay:                td.delay,
            uncertainty:          td.uncertainty,
            scheduleRelationship: td.scheduleRelationship,
            note:                 latToNote(vehicleLat),
          })
        }

        // Backward-compat arrival event (STOPPED_AT state change)
        if (newArrival && stop && !isNaN(stop.lat)) {
          arrivals++
          this.emit('arrival', {
            vehicleId,
            routeId,
            routeShortName: route.shortName,
            lineType:       route.lineType,
            color:          route.color,
            stopId,
            stopName:       stop.name,
            lat:            stop.lat,
            lng:            stop.lng ?? vehicleLng ?? 19.05,
            note:           latToNote(stop.lat),
          })
        }
      }

      this._emitMetroUpdates()

      if (arrivals > 0 || updates > 0) {
        process.stdout.write(`[bkk] ${arrivals} arrivals, ${updates} updates (${vpFeed.entity.length} vehicles in VP feed, ${this.metroTrips.size} metro trips)\n`)
      }
    } catch (err) {
      console.error('[bkk] poll error:', err.message)
    }
  }

  getSnapshot() {
    return [...this.prevState.values()].filter(v => v.lat)
  }

  getMetroDebug() {
    const nowSec = Date.now() / 1000
    const trips = []
    for (const [tripKey, trip] of this.metroTrips) {
      const { vehicleId, routeId, stopTimeUpdates } = trip
      const route  = this.lookup.routes[routeId]
      const sample = stopTimeUpdates.slice(0, 3).map(stu => ({
        stopId:  stu.stopId,
        stopResolved: !!this.lookup.stops[stu.stopId],
        arrTime: stu.arrival?.time  ? Number(stu.arrival.time)  : null,
        depTime: stu.departure?.time ? Number(stu.departure.time) : null,
        arrInPast: stu.arrival?.time  ? Number(stu.arrival.time)  <= nowSec : null,
        depInPast: stu.departure?.time ? Number(stu.departure.time) <= nowSec : null,
      }))
      trips.push({ tripKey, vehicleId, routeId, shortName: route?.shortName, stopCount: stopTimeUpdates.length, sample })
    }
    const metroInSnapshot = [...this.prevState.values()].filter(v => {
      const r = this.lookup.routes[v.routeId]
      return r?.lineType === 'metro'
    })
    return {
      nowSec: Math.floor(nowSec),
      metroTripCount: this.metroTrips.size,
      metroInSnapshot: metroInSnapshot.length,
      trips: trips.slice(0, 5),
    }
  }

  // ── Alerts poll (every 60 s) ─────────────────────────────────────────────────
  async _pollAlerts() {
    try {
      const feed = await this._fetch(AL_URL)
      const alerts = []

      for (const entity of feed.entity) {
        const al = entity.alert
        if (!al) continue

        alerts.push({
          cause:          al.cause        ?? null,
          effect:         al.effect       ?? null,
          severityLevel:  al.severityLevel ?? 0,
          informedEntities: (al.informedEntity ?? []).map(ie => ({
            routeId:   ie.routeId   ?? null,
            routeType: ie.routeType ?? null,
            stopId:    ie.stopId    ?? null,
            agencyId:  ie.agencyId  ?? null,
          })),
        })
      }

      this.emit('alert_update', alerts)
      if (alerts.length) {
        console.log(`[bkk] ${alerts.length} active alerts`)
      }
    } catch (err) {
      console.warn('[bkk] alert fetch failed:', err.message)
    }
  }
}
