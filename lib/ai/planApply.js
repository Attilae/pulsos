import { DEFAULT_ARP, DEFAULT_GRID_RESOLUTION, DEFAULT_PITCH_VARIETY } from '../mappings.js'
import { DEFAULT_GRANULAR, DEFAULT_SIDECHAIN, toneToSynthParams } from '../soundSpecs.js'
import { DEFAULT_LOOP_PATTERN } from '../laneGating.js'
import { DEFAULT_NOTE_LENGTH } from '../noteLength.js'

// Pure replacement-selection helper shared by the AI apply path and tests.
// The plan order is authoritative; unknown/duplicate/excess ids are skipped.
export function buildReplacementLaneState(routes, requestedIds, currentDisabled = {}, limit = null) {
  const available = new Set((routes ?? []).map(route => route?.id).filter(Boolean))
  const activeIds = []
  const skippedIds = []
  const seen = new Set()

  for (const id of requestedIds ?? []) {
    if (!available.has(id) || seen.has(id)) {
      skippedIds.push(id)
      continue
    }
    seen.add(id)
    if (limit != null && activeIds.length >= limit) {
      skippedIds.push(id)
      continue
    }
    activeIds.push(id)
  }

  const active = new Set(activeIds)
  const disabled = { ...currentDisabled }
  for (const route of routes ?? []) {
    if (route?.id) disabled[route.id] = !active.has(route.id)
  }

  return { activeIds, disabled, skippedIds }
}

// The tone mapping lives in soundSpecs.js (next to TONE_SUPPORT); re-exported
// here for the apply paths and their tests.
export { toneToSynthParams }

/**
 * The envelope + tone params a plan track writes into the lane's param block.
 * `synthType` is the instrument the lane ends up on — the plan's, or the lane's
 * current one for an edit that doesn't name it.
 */
export function trackSynthParams(track, synthType = track?.synthType) {
  return { ...(track?.envelope ?? {}), ...toneToSynthParams(track?.tone, synthType) }
}

// ---------------------------------------------------------------------------
// New-composition baseline. A plan only writes the fields it names, so a lane
// reused from the current session keeps its old arp, granular layer, drone,
// sidechain, chance, rest pattern, crop and sends unless the plan says
// otherwise — fine for an edit, wrong for a fresh idea (an "ambient, no drums"
// request that leaves an old arp running and the previous kit playing). This
// fills every omitted resettable field with its default, turns drums off when
// the plan has none, and flags `clearSends` so both apply paths
// (MixerTab.applyAIPlan and planSnapshot.applyPlanToSnapshot) zero the planned
// lanes' old sends before applying the plan's own. Anything the model set wins.
// ---------------------------------------------------------------------------

const TRACK_BASELINE = {
  pan: 0,
  octave: 0,
  glide: 0,
  legato: false,
  speed: 1,
  loopRegion: { startCell: 0, endCell: 64 },
  gridResolution: DEFAULT_GRID_RESOLUTION,
  pitchVariety: { ...DEFAULT_PITCH_VARIETY },
  noteChance: 1,
  noteLength: DEFAULT_NOTE_LENGTH,
  loopPattern: { ...DEFAULT_LOOP_PATTERN },
  filter: { type: 'lowpass', frequency: 20000 },
  drone: { enabled: false },
  arp: { ...DEFAULT_ARP, enabled: false },
  granular: { ...DEFAULT_GRANULAR, enabled: false },
  sidechain: { ...DEFAULT_SIDECHAIN, enabled: false },
}

/**
 * @param {object} plan  a validatePlan() result's plan
 * @returns {object} a copy with the baseline filled in; the input is not mutated
 */
export function withNewCompositionBaseline(plan) {
  if (!plan) return plan
  const clone = (v) => (v && typeof v === 'object' ? structuredClone(v) : v)
  const tracks = (plan.tracks ?? []).map(track => {
    const out = { ...track }
    for (const [key, value] of Object.entries(TRACK_BASELINE)) {
      if (out[key] == null) out[key] = clone(value)
    }
    return out
  })
  return {
    ...plan,
    tracks,
    drums: plan.drums ?? { enabled: false },
    clearSends: true,
  }
}

/**
 * The sends a `clearSends` plan zeroes: every non-zero send from one of `laneIds`
 * (the plan's active lanes, plus the drum lane). Send-matrix keys are
 * "<routeId>:<busId>" — split on the last colon, since bus ids never contain one.
 * @returns {{ routeId: string, busId: string }[]}
 */
export function sendsToClear(sendMatrix, laneIds) {
  const lanes = new Set(laneIds)
  const out = []
  for (const [key, level] of Object.entries(sendMatrix ?? {})) {
    if (!level) continue
    const at = key.lastIndexOf(':')
    const routeId = key.slice(0, at)
    if (at > 0 && lanes.has(routeId)) out.push({ routeId, busId: key.slice(at + 1) })
  }
  return out
}
