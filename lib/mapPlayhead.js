import { GRID_TOTAL_CELLS } from './mappings.js'

// Where a lane's mock playback is along its line, for the map's playhead dots.
//
// Pure mirror of the timing in engine.js (_buildRoutePart and
// _buildAutomationLanePart): a lane's Part loops its own loop region at its own
// speed, so lanes of different lengths drift apart (polyrhythm). The map used to
// draw every dot on one shared 4-bar cycle, which put them in the wrong place as
// soon as a lane had a region or a speed other than 1x. Change both together.

const LOOP_BEATS = 16   // engine: one full line = 16 beats at 1x

/** The region's [start, end) as fractions of the full line (engine clamping). */
export function loopWindow(region) {
  const start = Math.max(0, Math.min(GRID_TOTAL_CELLS - 1, region?.startCell ?? 0))
  const end   = Math.max(start + 1, Math.min(GRID_TOTAL_CELLS, region?.endCell ?? GRID_TOTAL_CELLS))
  return { startFrac: start / GRID_TOTAL_CELLS, endFrac: end / GRID_TOTAL_CELLS }
}

/**
 * @param {object} p
 * @param {number} p.beats  transport position in beats (ticks / PPQ). Beats, not
 *   seconds: a Part's loop is fixed in ticks, so a BPM change mustn't shift it.
 * @param {number} [p.speed=1]
 * @param {{startCell?:number,endCell?:number}|null} [p.region]
 * @returns {{ frac: number, phase: number }} `frac` is the position along the
 *   whole line (0..1, by distance); `phase` is the progress through the loop
 *   (0..1), used to fade the dot around the wrap.
 */
export function lanePlayhead({ beats, speed = 1, region = null }) {
  const { startFrac, endFrac } = loopWindow(region)
  const loopBeats = LOOP_BEATS * (endFrac - startFrac) / (speed > 0 ? speed : 1)
  const t = Math.max(0, beats)
  const phase = loopBeats > 0 ? (t % loopBeats) / loopBeats : 0
  return { frac: startFrac + phase * (endFrac - startFrac), phase }
}

/** 0→1→0 envelope over a loop so a dot fades out/in instead of jumping at the wrap. */
export function wrapFade(phase, zone = 0.05) {
  if (phase < zone) return phase / zone
  if (phase > 1 - zone) return (1 - phase) / zone
  return 1
}

/**
 * Positions (as fractions of the line) for the trail behind a lane's dot,
 * oldest first and ending at the dot itself. The trail covers the last
 * `trailBeats` of playback but never reaches back past the loop's start, so
 * right after the wrap it regrows from the region start instead of streaking
 * back across the line.
 */
export function trailFracs({ beats, speed = 1, region = null, trailBeats = 1, samples = 8 }) {
  const { startFrac, endFrac } = loopWindow(region)
  const loopBeats = LOOP_BEATS * (endFrac - startFrac) / (speed > 0 ? speed : 1)
  const { frac } = lanePlayhead({ beats, speed, region })
  if (!(loopBeats > 0) || samples < 1) return [frac]
  const span = Math.min(1, trailBeats / loopBeats) * (endFrac - startFrac)
  const tail = Math.max(startFrac, frac - span)
  const out = []
  for (let i = 0; i <= samples; i++) out.push(tail + (frac - tail) * (i / samples))
  return out
}
