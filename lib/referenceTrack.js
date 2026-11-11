// Reference loop: a signed-in user's own audio (a loop missing its bass, its lead…)
// played on the transport grid so lanes can be auditioned against it. This
// module is the pure vocabulary — bar maths and the snapshot shape — shared by
// MixerTab, the engine and songState. The audio itself never leaves the browser
// (lib/referenceStore.js keeps it in IndexedDB); a song stores only this
// metadata, which is why `normalizeReference` must make a snapshot from a
// shared link safe.

export const REFERENCE_ROUTE_ID = '__reference__'

export const REFERENCE_BAR_OPTIONS = Object.freeze([1, 2, 4, 8, 16, 32])
export const REFERENCE_BPM_RANGE = Object.freeze([40, 240])
export const REFERENCE_VOLUME_RANGE = Object.freeze([-40, 6])
export const REFERENCE_OFFSET_RANGE = Object.freeze([0, 10])
export const REFERENCE_NAME_MAX = 120
// A loop this far off its bar length is worth a warning: ~10 ms per second.
export const REFERENCE_DRIFT_TOLERANCE = 0.01

const BEATS_PER_BAR = 4

export const DEFAULT_REFERENCE = Object.freeze({
  id: null,
  name: '',
  durationSec: 0,
  bars: 4,
  offsetSec: 0,
  volumeDb: -6,
  muted: false,
  includeInExport: false,
})

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const finite = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback)

// Seconds one cycle of `bars` 4/4 bars lasts at `bpm`.
export function cycleSeconds(bars, bpm) {
  if (!(bars > 0) || !(bpm > 0)) return 0
  return (bars * BEATS_PER_BAR * 60) / bpm
}

// The bar count whose length at `bpm` is closest to the loop's, measured as a
// ratio (log distance) so 2 s off a 2-bar loop weighs more than 2 s off 32.
export function guessBars(durationSec, bpm) {
  if (!(durationSec > 0) || !(bpm > 0)) return DEFAULT_REFERENCE.bars
  let best = REFERENCE_BAR_OPTIONS[0]
  let bestErr = Infinity
  for (const bars of REFERENCE_BAR_OPTIONS) {
    const err = Math.abs(Math.log(durationSec / cycleSeconds(bars, bpm)))
    if (err < bestErr) { best = bars; bestErr = err }
  }
  return best
}

// The BPM at which `bars` bars last exactly `durationSec`, rounded to 0.01 and
// clamped to the app's range. null when it can't be computed.
export function bpmForBars(durationSec, bars) {
  if (!(durationSec > 0) || !(bars > 0)) return null
  const bpm = (bars * BEATS_PER_BAR * 60) / durationSec
  return Math.round(clamp(bpm, REFERENCE_BPM_RANGE[0], REFERENCE_BPM_RANGE[1]) * 100) / 100
}

// Signed relative error of the playable part of the loop (after the start
// offset) against its bar length: >0 the audio is longer (gets cut each cycle),
// <0 shorter (a gap before the next cycle).
export function referenceDrift(durationSec, bars, bpm, offsetSec = 0) {
  const cycle = cycleSeconds(bars, bpm)
  const playable = durationSec - (offsetSec || 0)
  if (!(cycle > 0) || !(playable > 0)) return 0
  return playable / cycle - 1
}

// UI copy for a loop that doesn't fit its bars at this tempo, or null.
export function driftWarning(durationSec, bars, bpm, offsetSec = 0) {
  const drift = referenceDrift(durationSec, bars, bpm, offsetSec)
  if (Math.abs(drift) <= REFERENCE_DRIFT_TOLERANCE) return null
  const pct = Math.round(Math.abs(drift) * 100)
  const unit = bars === 1 ? 'bar' : 'bars'
  return drift > 0
    ? `Loop is ${pct}% longer than ${bars} ${unit} at ${bpm} BPM, so its end is cut`
    : `Loop is ${pct}% shorter than ${bars} ${unit} at ${bpm} BPM, so there is a gap`
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

// Coerce anything (a snapshot, a shared link, a UI patch) into a valid
// reference descriptor, or null when it doesn't name a stored loop.
export function normalizeReference(meta) {
  if (!meta || typeof meta !== 'object') return null
  if (typeof meta.id !== 'string' || !ID_RE.test(meta.id)) return null
  const name = typeof meta.name === 'string' ? meta.name.slice(0, REFERENCE_NAME_MAX) : ''
  const bars = REFERENCE_BAR_OPTIONS.includes(Number(meta.bars)) ? Number(meta.bars) : DEFAULT_REFERENCE.bars
  return {
    id: meta.id,
    name,
    durationSec: Math.max(0, finite(meta.durationSec, 0)),
    bars,
    offsetSec: clamp(finite(meta.offsetSec, 0), REFERENCE_OFFSET_RANGE[0], REFERENCE_OFFSET_RANGE[1]),
    volumeDb: clamp(finite(meta.volumeDb, DEFAULT_REFERENCE.volumeDb), REFERENCE_VOLUME_RANGE[0], REFERENCE_VOLUME_RANGE[1]),
    muted: meta.muted === true,
    includeInExport: meta.includeInExport === true,
  }
}

// Coarse buckets for analytics (never the file name).
export function durationBucket(durationSec) {
  if (!(durationSec > 0)) return 'unknown'
  if (durationSec < 5) return '<5s'
  if (durationSec < 15) return '5-15s'
  if (durationSec < 30) return '15-30s'
  if (durationSec < 60) return '30-60s'
  return '60s+'
}

export function formatOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '')
  const ext = m ? m[1].toLowerCase() : ''
  if (ext === 'aif' || ext === 'aiff' || ext === 'aifc') return 'aiff'
  if (ext === 'wav' || ext === 'wave') return 'wav'
  if (ext === 'mp3') return 'mp3'
  return ext || 'unknown'
}

// Waveform overview for the lane: `buckets` peak values (0..1), the max |x|
// across every channel per bucket. Computed once per loaded loop, never per frame.
export function computePeaks(channels, buckets = 512) {
  const list = (channels ?? []).filter(c => c && c.length > 0)
  if (!list.length || !(buckets > 0)) return new Float32Array(0)
  const length = list[0].length
  const n = Math.min(buckets, length)
  const peaks = new Float32Array(n)
  const step = length / n
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * step)
    const end = Math.max(start + 1, Math.floor((b + 1) * step))
    let peak = 0
    for (const data of list) {
      for (let i = start; i < end; i++) {
        const v = data[i] < 0 ? -data[i] : data[i]
        if (v > peak) peak = v
      }
    }
    peaks[b] = peak > 1 ? 1 : peak
  }
  return peaks
}
