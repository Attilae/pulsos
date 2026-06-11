// Pure mapping math — all functions are stateless.
// The engine passes current mode/root as parameters rather than storing them here.

// ── Mode definitions (semitones from root) ────────────────────────────────────
export const MODES = {
  dorian:           [0, 2, 3, 5, 7, 9, 10],
  phrygian:         [0, 1, 3, 5, 7, 8, 10],
  aeolian:          [0, 2, 3, 5, 7, 8, 10],
  lydian:           [0, 2, 4, 6, 7, 9, 11],
  mixolydian:       [0, 2, 4, 5, 7, 9, 10],
  lydian_dominant:  [0, 2, 4, 6, 7, 9, 10],
  phrygian_dominant:[0, 1, 4, 5, 7, 8, 10],
  chromatic:        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

// User-selectable per-track scales (semitones from root)
export const SCALES = {
  major:           [0, 2, 4, 5, 7, 9, 11],
  minor:           [0, 2, 3, 5, 7, 8, 10],
  pentatonic:      [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  dorian:          [0, 2, 3, 5, 7, 9, 10],
  phrygian:        [0, 1, 3, 5, 7, 8, 10],
  lydian:          [0, 2, 4, 6, 7, 9, 11],
  mixolydian:      [0, 2, 4, 5, 7, 9, 10],
}

// Alert cause/effect → mode name
// Cause enum: TECHNICAL_PROBLEM=2, STRIKE=3, ACCIDENT=5, WEATHER=7, CONSTRUCTION=9
// Effect enum: NO_SERVICE=1, SIGNIFICANT_DELAYS=3, ADDITIONAL_SERVICE=5
export function modeForAlert(cause, effect) {
  if (effect === 5)  return 'lydian'           // ADDITIONAL_SERVICE → bright
  if (cause === 3)   return 'aeolian'          // STRIKE → lonely minor
  if (cause === 5)   return 'chromatic'        // ACCIDENT → dissonant
  if (cause === 7)   return 'mixolydian'       // WEATHER → heavy/unresolved
  if (cause === 9)   return 'lydian_dominant'  // CONSTRUCTION → industrial bright
  if (cause === 2)   return 'phrygian'         // TECHNICAL_PROBLEM → dark/mechanical
  if (effect === 3)  return 'phrygian_dominant'// SIGNIFICANT_DELAYS → urgent
  return 'dorian'                               // default: urban, forward motion
}

// Alert severity → master reverb parameters
// SeverityLevel: INFO=1, WARNING=2, SEVERE=3
export function severityToReverb(severity) {
  switch (severity) {
    case 1:  return { decay: 2.0, wet: 0.30 }  // INFO
    case 2:  return { decay: 4.0, wet: 0.50 }  // WARNING
    case 3:  return { decay: 8.0, wet: 0.75 }  // SEVERE
    default: return { decay: 1.2, wet: 0.18 }  // no alert
  }
}

// ── Geographic mappings ────────────────────────────────────────────────────────
// City-wide bounding box used by the *fallback* normalizers below. Per-route
// pitch (geoToMidi + routeBounds) is independent of this — it derives bounds
// from each route's own stops. Defaults to Budapest; call setCityBounds() when
// a city's lines.json loads (its `city.bounds` block) to retune the fallbacks
// and the centroid/dispersion defaults for another city.
const cityBounds = {
  latMin: 47.35, latMax: 47.70,
  lngMin: 18.87, lngMax: 19.27,
}

// Update the active city's geographic bounds. Safe to call repeatedly; ignores
// partial/empty input so a city file without a bounds block leaves the default.
export function setCityBounds(bounds) {
  if (!bounds) return
  if (Number.isFinite(bounds.latMin)) cityBounds.latMin = bounds.latMin
  if (Number.isFinite(bounds.latMax)) cityBounds.latMax = bounds.latMax
  if (Number.isFinite(bounds.lngMin)) cityBounds.lngMin = bounds.lngMin
  if (Number.isFinite(bounds.lngMax)) cityBounds.lngMax = bounds.lngMax
}

// Latitude normalized to [0,1] within the active city
function latNorm(lat) {
  return Math.max(0, Math.min(1, (lat - cityBounds.latMin) / (cityBounds.latMax - cityBounds.latMin)))
}

// Longitude normalized to [0,1] within the active city
function lngNorm(lng) {
  return Math.max(0, Math.min(1, (lng - cityBounds.lngMin) / (cityBounds.lngMax - cityBounds.lngMin)))
}

// Longitude → stereo pan [-1, 1] (west=left, east=right)
export function lngToPan(lng) {
  return Math.max(-1, Math.min(1,
    (lng - cityBounds.lngMin) / (cityBounds.lngMax - cityBounds.lngMin) * 2 - 1
  ))
}

// Bearing → small pan nudge in direction of travel
export function bearingToPanMod(bearing) {
  return Math.sin((bearing ?? 0) * Math.PI / 180) * 0.12
}

// Combined pan from position + direction of travel
export function vehiclePan(lng, bearing) {
  return Math.max(-1, Math.min(1, lngToPan(lng) + bearingToPanMod(bearing)))
}

// ── Note computation ───────────────────────────────────────────────────────────

// MIDI note number → Tone.js note string (e.g., 62 → "D4")
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export function midiToNote(midi) {
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[midi % 12]}${octave}`
}

// Tone.js note string → MIDI note number (e.g., "D4" → 62)
export function noteToMidi(note) {
  const m = note.match(/^([A-G]#?)(\d+)$/)
  if (!m) return 60
  const idx = NOTE_NAMES.indexOf(m[1])
  return (Number(m[2]) + 1) * 12 + idx
}

// Shift a Tone.js note string by n octaves: "D4" + 1 → "D5"
export function shiftOctaveNote(note, shift) {
  if (!shift) return note
  const m = note.match(/^([A-G]#?)(\d+)$/)
  if (!m) return note
  return `${m[1]}${Number(m[2]) + shift}`
}

// Randomly pick a note from a user-selected root + scale, within one octave
// starting at the root in octave 4. The octave switcher shifts the whole map.
export function randomFromScale(root = 'C', scaleType = 'major') {
  const rootIdx = NOTE_NAMES.indexOf(root)
  if (rootIdx === -1) return 'C4'
  const intervals = SCALES[scaleType] ?? SCALES.major
  const rootMidi = (4 + 1) * 12 + rootIdx
  const pool = intervals.map(iv => midiToNote(rootMidi + iv))
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── Arpeggiator ──────────────────────────────────────────────────────────────
// An instrument lane's stop pitch becomes the arp *root note*; the arp expands it
// into a short scale-based sequence (Steps × Distance stacked up from the root,
// across Octaves) and reorders it by Style. Pure — the engine schedules the result.
export const ARP_STYLES = ['up', 'down', 'updown', 'downup', 'converge', 'diverge', 'random']
export const ARP_RATES  = ['4n', '8n', '8t', '16n', '16t', '32n']
const MAX_ARP_NOTES = 32

export const DEFAULT_ARP = {
  enabled: false,
  style:   'up',
  rate:    '16n',
  gate:    0.5,
  octaves: 1,
  steps:   3,
  distance: 2,
}

// Build the arp note sequence (array of Tone note strings) from a root note,
// staying in the track's scale. Reorders by style; reshuffles per call for random.
//
// `scaleRoot` is the track's key tonic (pitch class, e.g. 'C'). It matters: the
// stop note is rarely the tonic, so we must stack scale degrees *diatonically
// from the stop note's own degree* — not add tonic-relative intervals onto it,
// which would transpose the chord off-key whenever the stop isn't the tonic.
export function buildArpSequence(rootNote, cfg = {}, scaleType = 'major', scaleRoot = 'C') {
  const { octaves = 1, steps = 3, distance = 2, style = 'up' } = cfg
  const rootMidi = noteToMidi(rootNote)
  const iv = SCALES[scaleType] ?? SCALES.major
  const N = iv.length

  // Locate the stop note within the scale: its pitch class relative to the tonic,
  // then its scale-degree index (snapping down to the nearest scale tone if the
  // stop note isn't exactly on the scale).
  const tonicPc  = Math.max(0, NOTE_NAMES.indexOf(scaleRoot))
  const relPc    = (((rootMidi - tonicPc) % 12) + 12) % 12
  const tonicBelow = rootMidi - relPc // a real tonic pitch at/below the stop note
  let baseDeg = iv.indexOf(relPc)
  if (baseDeg < 0) { baseDeg = 0; for (let d = 0; d < N; d++) if (iv[d] <= relPc) baseDeg = d }

  // Base chord tones: tone i sits `i*distance` scale degrees above the stop note,
  // walking the scale so every tone stays diatonic. Tone 0 == the stop note
  // (or the nearest scale tone at/below it).
  const nSteps  = Math.max(1, Math.round(steps))
  const nOct    = Math.max(1, Math.round(octaves))
  const dist    = Math.max(1, Math.round(distance))
  const base = []
  for (let i = 0; i < nSteps; i++) {
    const deg = baseDeg + i * dist
    base.push(tonicBelow + iv[deg % N] + 12 * Math.floor(deg / N))
  }

  // Expand across octaves (ascending).
  let notes = []
  for (let o = 0; o < nOct; o++) for (const p of base) notes.push(p + 12 * o)
  if (notes.length > MAX_ARP_NOTES) notes = notes.slice(0, MAX_ARP_NOTES)

  const ordered = orderArp(notes, style)
  return ordered.map(midiToNote)
}

function orderArp(notes, style) {
  const last = notes.length - 1
  switch (style) {
    case 'down':
      return [...notes].reverse()
    case 'updown':
      // up then back down, without repeating the endpoints
      return [...notes, ...notes.slice(1, last).reverse()]
    case 'downup': {
      const down = [...notes].reverse()
      return [...down, ...down.slice(1, last).reverse()]
    }
    case 'converge': {
      // outside-in: lowest, highest, 2nd lowest, 2nd highest, …
      const out = []
      let lo = 0, hi = last
      while (lo <= hi) {
        out.push(notes[lo++])
        if (lo <= hi) out.push(notes[hi--])
      }
      return out
    }
    case 'diverge': {
      // inside-out: middle outward
      const out = []
      const mid = Math.floor(last / 2)
      out.push(notes[mid])
      for (let d = 1; d <= last; d++) {
        if (mid - d >= 0) out.push(notes[mid - d])
        if (mid + d <= last) out.push(notes[mid + d])
      }
      return out
    }
    case 'random': {
      const out = [...notes]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    }
    case 'up':
    default:
      return notes
  }
}

// Centroid latitude → dynamic root MIDI note (D3=50 to D4=62, one octave)
export function centroidToRootMidi(lat) {
  const t = latNorm(lat)
  return Math.round(50 + t * 12)  // D3 to D4
}

// Latitude → MIDI note within a given mode, relative to root
// Spans 2 octaves of the scale (higher vehicle lat = higher note)
export function latToMidi(lat, rootMidi, modeScale) {
  const t = latNorm(lat)
  const totalSteps = modeScale.length * 2  // 2 octaves
  const step = Math.round(t * (totalSteps - 1))
  const octaveOffset = Math.floor(step / modeScale.length) * 12
  const scaleStep = step % modeScale.length
  return rootMidi + modeScale[scaleStep] + octaveOffset
}

// Convenience: lat → Tone.js note string using given mode/root
export function latToNote(lat, rootMidi = 62, modeScale = MODES.dorian) {
  return midiToNote(latToMidi(lat, rootMidi, modeScale))
}

// Bounding box of a route's stops. `minSpan` keeps a near-straight line (or GPS
// jitter) from being amplified into wild pitch swings: an axis that barely moves
// stays centred instead of filling the whole range.
export function routeBounds(stops, minSpan = 0.004) {
  const lats = (stops ?? []).map(s => s.lat).filter(v => v != null)
  const lngs = (stops ?? []).map(s => s.lon ?? s.lng).filter(v => v != null)
  return {
    latMin: lats.length ? Math.min(...lats) : cityBounds.latMin,
    latMax: lats.length ? Math.max(...lats) : cityBounds.latMax,
    lngMin: lngs.length ? Math.min(...lngs) : cityBounds.lngMin,
    lngMax: lngs.length ? Math.max(...lngs) : cityBounds.lngMax,
    minSpan,
  }
}

// Normalize v to [0,1] across [min,max], widening the window to at least minSpan
// (centred) so a tiny real range doesn't fill the whole pitch range.
function normSpan(v, min, max, minSpan) {
  const realSpan = max - min
  const span = Math.max(realSpan, minSpan)
  const lo   = min - (span - realSpan) / 2
  return Math.max(0, Math.min(1, (v - lo) / span))
}

// Two-axis geographic pitch: latitude → scale degree (within one octave),
// longitude → octave register. North–south is melody, east–west is register.
// With `bounds` (a route's own box) the line uses its full pitch range, so the
// melody is dynamic; without it, normalization falls back to the whole-city range.
export function geoToMidi(lat, lng, rootMidi, modeScale, octaveSpan = 3, bounds = null) {
  const latT = bounds
    ? normSpan(lat ?? bounds.latMin, bounds.latMin, bounds.latMax, bounds.minSpan)
    : latNorm(lat ?? cityBounds.latMin)
  const lngT = bounds
    ? normSpan(lng ?? bounds.lngMin, bounds.lngMin, bounds.lngMax, bounds.minSpan)
    : lngNorm(lng ?? cityBounds.lngMin)
  const degree = Math.round(latT * (modeScale.length - 1))
  const octave = Math.round(lngT * (octaveSpan - 1))
  return rootMidi + modeScale[degree] + octave * 12
}

// ── Vehicle physics → sonic parameters ────────────────────────────────────────

// Speed (m/s) → vibrato depth [0, 0.15] (15 cents max at full speed)
const MAX_SPEED_MS = 22  // ~80 km/h (metro)
export function speedToVibratoDepth(speed) {
  return Math.max(0, Math.min(1, (speed ?? 0) / MAX_SPEED_MS)) * 0.15
}

// ── Occupancy → FM modulation index ──────────────────────────────────────────
// 0% occupancy = index 0 (pure sine), 100%+ = index 10 (rich FM texture)
export function occupancyToModIndex(pct) {
  const t = Math.max(0, Math.min(1.5, (pct ?? 50) / 100))
  return t * 10
}

// Occupancy percentage from OccupancyStatus enum (when percentage isn't available)
// OccupancyStatus: EMPTY=0, MANY_SEATS=1, FEW_SEATS=2, STANDING_ROOM=3, CRUSHED=4, FULL=5, NOT_ACCEPTING=6
export function occupancyStatusToPct(status) {
  return [5, 25, 50, 70, 88, 100, 100, 50, 50][status] ?? 50
}

// ── Schedule deviation → pitch detuning ───────────────────────────────────────

// Delay (seconds) → cents offset for detuning
// +300s late → +200 cents (major 2nd sharp), -90s early → -60 cents
export function delayToCents(delaySeconds) {
  return Math.max(-200, Math.min(200, (delaySeconds ?? 0) * 0.67))
}

// Uncertainty [0–100] → tension voice volume (dB)
// 0=certain → -12dB (present), high uncertainty → quieter
export function uncertaintyToVolDb(uncertainty) {
  return -12 - ((uncertainty ?? 0) / 100) * 18
}

// ── Route depth → reverb pre-delay ───────────────────────────────────────────

// shape_dist_traveled / max → edgeness [0=centre, 1=terminus]
export function edgeness(shapeDist, maxShapeDist) {
  if (!maxShapeDist || maxShapeDist <= 0) return 0
  const progress = Math.max(0, Math.min(1, shapeDist / maxShapeDist))
  return Math.abs(progress - 0.5) * 2
}

// ── Haversine distance (metres) ────────────────────────────────────────────────
// Used for hub proximity checks
export function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Range converter ───────────────────────────────────────────────────────────
// Maps a normalized 0..1 value into [min, max]. Universal converter used by the
// automation apply step (engine.js:_applyAutomation) to translate a source's
// normalized output into the destination's native range.
export function denormalizeToRange(v, min, max) {
  return min + v * (max - min)
}

// Exponential (log-perceptual) denormalize for frequency-style ranges: 0..1 sweeps
// min→max geometrically, so the audible action isn't crammed into the bottom few %.
// e.g. denormalizeExp(0.5, 20, 20000) ≈ 632 Hz. Requires min > 0; falls back to linear.
export function denormalizeExp(v, min, max) {
  if (min <= 0 || max <= 0) return denormalizeToRange(v, min, max)
  return min * Math.pow(max / min, v)
}

// ── Linear referencing along a polyline ───────────────────────────────────────
// Project a vehicle's lat/lng onto a route shape and return its progress (0–1).
// Algorithm: for each segment, find the perpendicular foot via equirectangular
// projection (accurate enough at city scale, cheaper than per-segment haversine).
// Pick the segment with smallest perpendicular distance.

export function cumulativePolylineDistance(coords) {
  const cumulative = new Float64Array(coords.length)
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += haversineMetres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1])
    cumulative[i] = total
  }
  return { cumulative, total }
}

// Returns { progress: 0..1, perpDist: metres }. Returns null if coords is empty.
export function projectPointOntoPolyline(lat, lng, coords, cumulative, total) {
  if (!coords?.length || !total) return null
  const cosLat = Math.cos(lat * Math.PI / 180)
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * cosLat

  let bestPerp = Infinity
  let bestAlong = 0

  for (let i = 0; i < coords.length - 1; i++) {
    const [aLat, aLng] = coords[i]
    const [bLat, bLng] = coords[i + 1]

    // Convert to local metres relative to point a
    const ax = 0, ay = 0
    const bx = (bLng - aLng) * mPerDegLng
    const by = (bLat - aLat) * mPerDegLat
    const px = (lng - aLng) * mPerDegLng
    const py = (lat - aLat) * mPerDegLat

    const segLenSq = bx * bx + by * by
    let t = segLenSq > 0 ? ((px - ax) * bx + (py - ay) * by) / segLenSq : 0
    if (t < 0) t = 0
    else if (t > 1) t = 1

    const fx = ax + t * bx
    const fy = ay + t * by
    const dx = px - fx
    const dy = py - fy
    const perp = Math.sqrt(dx * dx + dy * dy)

    if (perp < bestPerp) {
      bestPerp = perp
      const segLen = cumulative[i + 1] - cumulative[i]
      bestAlong = cumulative[i] + t * segLen
    }
  }

  return { progress: bestAlong / total, perpDist: bestPerp }
}

// ── Fleet aggregation helpers ─────────────────────────────────────────────────

// Compute the centroid lat/lng of an array of {lat, lng} objects
export function computeCentroid(positions) {
  if (!positions.length) return {
    lat: (cityBounds.latMin + cityBounds.latMax) / 2,
    lng: (cityBounds.lngMin + cityBounds.lngMax) / 2,
  }  // city centre default
  const lat = positions.reduce((s, p) => s + p.lat, 0) / positions.length
  const lng = positions.reduce((s, p) => s + p.lng, 0) / positions.length
  return { lat, lng }
}

// Bounding box area (in approximate km²) of a set of positions — used for dispersion
export function boundingBoxArea(positions) {
  if (positions.length < 2) return 0
  const lats = positions.map(p => p.lat)
  const lngs = positions.map(p => p.lng)
  const centerLat = (cityBounds.latMin + cityBounds.latMax) / 2
  const latRange = (Math.max(...lats) - Math.min(...lats)) * 111
  const lngRange = (Math.max(...lngs) - Math.min(...lngs)) * 111 * Math.cos(centerLat * Math.PI / 180)
  return latRange * lngRange
}

// Normalise FM modulation index for the drone based on fleet density + dispersion
// activeVehicles: count, peakVehicles: expected peak (~1000), dispersionKm2: boundingBoxArea
export function droneModIndex(activeVehicles, peakVehicles, dispersionKm2) {
  const density = Math.min(1, activeVehicles / peakVehicles)
  const dispersion = Math.min(1, dispersionKm2 / 800)  // Budapest ~800 km² urban area
  return 1 + dispersion * 14  // 1 (quiet night) to 15 (busy day)
}

export function droneVolDb(activeVehicles, peakVehicles) {
  const density = Math.min(1, activeVehicles / peakVehicles)
  return -28 + density * 16  // -28dB (night) to -12dB (peak)
}

// ── GTFS field normalizations (all return 0.0–1.0) ────────────────────────────

// arrival/departure delay: −300s (early) to +600s (very late)
export function normalizeDelay(seconds) {
  return Math.max(0, Math.min(1, ((seconds ?? 0) + 300) / 900))
}

// uncertainty: 0–300 seconds
export function normalizeUncertainty(seconds) {
  return Math.max(0, Math.min(1, (seconds ?? 0) / 300))
}

// occupancy percentage: 0–100%
export function normalizeOccupancy(pct) {
  return Math.max(0, Math.min(1, (pct ?? 0) / 100))
}

// speed: 0–80 km/h (metro top speed)
export function normalizeSpeed(kmh) {
  return Math.max(0, Math.min(1, (kmh ?? 0) / 80))
}

// congestion level enum: 0–5
export function normalizeCongestion(level) {
  return Math.max(0, Math.min(1, (level ?? 0) / 5))
}

// dwell deviation = departure.delay − arrival.delay, range −60 to +120s
export function normalizeDwellDeviation(seconds) {
  return Math.max(0, Math.min(1, ((seconds ?? 0) + 60) / 180))
}

// delay delta = stop N delay − stop N-1 delay, range −30 to +30s
export function normalizeDelayDelta(seconds) {
  return Math.max(0, Math.min(1, ((seconds ?? 0) + 30) / 60))
}

// stop latitude within the active city's bounds (south=0, north=1)
export function normalizeStopLat(lat) {
  return latNorm(lat ?? cityBounds.latMin)
}

// stop sequence index within a route (first=0, last=1)
export function normalizeStopSequence(idx, totalStops) {
  if (!totalStops || totalStops <= 1) return 0
  return Math.max(0, Math.min(1, idx / (totalStops - 1)))
}

// bearing (degrees, 0–359) → east/west travel component, remapped to [0, 1]
// 0.5 = travelling north/south, 1.0 = due east, 0.0 = due west
export function normalizeBearingSin(bearing) {
  return (Math.sin((bearing ?? 0) * Math.PI / 180) + 1) / 2
}

// bearing (degrees) → north/south travel component, remapped to [0, 1]
// 1.0 = due north, 0.0 = due south, 0.5 = travelling east/west
export function normalizeBearingCos(bearing) {
  return (Math.cos((bearing ?? 0) * Math.PI / 180) + 1) / 2
}

// longitude within the active city's bounds (west=0, east=1)
export function normalizeLongitude(lng) {
  return lngNorm(lng ?? cityBounds.lngMin)
}

// ── Seeded randomness ("salt") ────────────────────────────────────────────────
// A deterministic PRNG seeded from a salt, so "random" becomes a pure function of
// GTFS values. Used by the stop-rail (generatePitchMap) so a line's note sequence
// is a product of the live network rather than Math.random(). See docs/gtfs-salt.md.

// FNV-1a 32-bit hash of a string → uint32. For string GTFS ids (routeId, stopId…).
export function hashStringToInt(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// mulberry32: uint32 seed → () => float in [0,1). Fast, well-distributed.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Mix any number of string|number parts into a single uint32 seed (FNV-1a with a
// separator between parts so [12,3] and [1,23] don't collide).
export function makeSalt(...parts) {
  let h = 0x811c9dc5
  for (const p of parts) {
    const s = typeof p === 'string' ? p : String(p)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x2c  // separator
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Deterministic 0..1 "default" value for an automation point at a given stop.
// Salted by laneId so two lanes on the same line get distinct curves. Used by both
// the audio engine (AutomationTrack) and the UI (draggable rail) so the dot you see
// equals the value applied — until the user drags to author an override.
export function hashStopValue(laneId, stopId) {
  return mulberry32(hashStringToInt(`${laneId ?? ''}:${stopId ?? ''}`))()
}

// ── Generative pitch maps ─────────────────────────────────────────────────────
// Build a note-per-stop array for a route before scheduling.
// strategy:
//   'geographic'   — stop latitude → scale degree (city geography = melody contour)
//   'randomWalk'   — Markov-style ±1 step walk through scale degrees (melodic drift)
//   'volatileWalk' — same walk as randomWalk, but the caller seeds `rng` from a live
//                    GTFS salt and rebuilds each loop, so the rail re-voices as the
//                    network drifts (see engine._buildRoutePart). See docs/gtfs-salt.md.
//   'index'        — stop order maps linearly low→high across two octaves
//   'random'       — unweighted random (legacy fallback)
// `rng` is an injectable () => [0,1) source; defaults to Math.random for callers that
// don't supply a seeded generator.
// Deterministic two-axis geographic pitch map: one note per stop, where latitude
// picks the scale degree and longitude picks the octave register (see geoToMidi).
// Pitch and rhythm come from the same stop object, so the rail is literally a melody.
export function generatePitchMap(stops, rootMidi = 62, modeScale = MODES.dorian, octaveSpan = 3) {
  if (!stops?.length) return []
  const bounds = routeBounds(stops)
  return stops.map(s => midiToNote(geoToMidi(s.lat, s.lon ?? s.lng, rootMidi, modeScale, octaveSpan, bounds)))
}

// ── Grid quantization ─────────────────────────────────────────────────────────
// Standard 4-bar × 16-step-per-bar grid (64 cells total).
// These constants are the single source of truth for both the audio engine
// (scheduling) and the UI (stop-rail rendering).

export const GRID_BARS          = 4
export const GRID_STEPS_PER_BAR = 16
export const GRID_TOTAL_CELLS   = GRID_BARS * GRID_STEPS_PER_BAR  // 64

// Map each stop's distance position to a 16th-note cell.
// Collision rule: bump forward to the next free cell so no two stops share a cell.
// Stops that fall beyond the last cell (index 63) are dropped.
// Returns an array of stop objects extended with:
//   cellIdx    – 0-based cell index (0–63)
//   originalIdx – original index in the input array (for pitchMap lookup)
//   bar         – 0-based bar number (0–3)
//   beat        – 0-based beat within bar (0–3)
//   sixteenth   – 0-based 16th within beat (0–3)
export function snapStopsToGrid(stops, totalDist, totalCells = GRID_TOTAL_CELLS) {
  if (!stops?.length || !totalDist) return []
  let lastUsed = -1
  const out = []
  for (let i = 0; i < stops.length; i++) {
    const s     = stops[i]
    const ideal = Math.round((s.dist / totalDist) * (totalCells - 1))
    const cell  = Math.max(ideal, lastUsed + 1)
    if (cell >= totalCells) break
    lastUsed = cell
    out.push({
      ...s,
      cellIdx:     cell,
      originalIdx: i,
      bar:         Math.floor(cell / GRID_STEPS_PER_BAR),
      beat:        Math.floor((cell % GRID_STEPS_PER_BAR) / 4),
      sixteenth:   cell % 4,
    })
  }
  return out
}
