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
const BUD_LAT_MIN = 47.35
const BUD_LAT_MAX = 47.70
const BUD_LNG_MIN = 18.87
const BUD_LNG_MAX = 19.27

// Latitude normalized to [0,1] within Budapest
function latNorm(lat) {
  return Math.max(0, Math.min(1, (lat - BUD_LAT_MIN) / (BUD_LAT_MAX - BUD_LAT_MIN)))
}

// Longitude → stereo pan [-1, 1] (Buda=left, Pest=right)
export function lngToPan(lng) {
  return Math.max(-1, Math.min(1,
    (lng - BUD_LNG_MIN) / (BUD_LNG_MAX - BUD_LNG_MIN) * 2 - 1
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

// ── Fleet aggregation helpers ─────────────────────────────────────────────────

// Compute the centroid lat/lng of an array of {lat, lng} objects
export function computeCentroid(positions) {
  if (!positions.length) return { lat: 47.49, lng: 19.04 }  // city centre default
  const lat = positions.reduce((s, p) => s + p.lat, 0) / positions.length
  const lng = positions.reduce((s, p) => s + p.lng, 0) / positions.length
  return { lat, lng }
}

// Bounding box area (in approximate km²) of a set of positions — used for dispersion
export function boundingBoxArea(positions) {
  if (positions.length < 2) return 0
  const lats = positions.map(p => p.lat)
  const lngs = positions.map(p => p.lng)
  const latRange = (Math.max(...lats) - Math.min(...lats)) * 111
  const lngRange = (Math.max(...lngs) - Math.min(...lngs)) * 111 * Math.cos(47.5 * Math.PI / 180)
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
