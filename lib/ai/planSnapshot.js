// Apply a validated AI plan to a saved-song snapshot, without a browser. The
// in-app AI Composer applies a plan by replaying MixerTab's handlers against the
// live Tone graph (MixerTab.applyAIPlan); the MCP server has no graph and no
// React, so this is the same sequence ported onto the snapshot maps those
// handlers write. Pure — no Tone, React or engine import — so it runs in
// lib/server/. Keep it in step with applyAIPlan: test/plan-snapshot.test.js
// replays both paths and compares the resulting songs.

import { SCHEMA_VERSION } from '../persistence.js'
import { SYNTH_DEFAULTS, DEFAULT_GRANULAR, DEFAULT_SIDECHAIN, DEFAULT_FX_TRACKS, DRUMS_ROUTE_ID } from '../soundSpecs.js'
import { DEFAULT_ARP, DEFAULT_PITCH_VARIETY } from '../mappings.js'
import { FX_BUSES } from '../fxSpecs.js'
import { normalizeLaneTag } from '../laneTags.js'
import { snapshotBaseRouteIds } from '../songLanes.js'
import { buildReplacementLaneState } from './planApply.js'

const DEFAULT_HARMONY = { root: 'C', scaleType: 'major' }

/**
 * The snapshot of a brand-new session in `cityId`, matching what
 * MixerTab.resetSessionState leaves behind (then buildSnapshot serializes), with
 * no lanes yet — applyPlanToSnapshot adds the plan's lanes.
 */
export function defaultSnapshot(cityId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    cityId: cityId ?? null,
    bpm: 120,
    mode: 'mock',
    view: 'daw',
    masterVolume: 0,
    globalHarmony: { ...DEFAULT_HARMONY },
    routeIds: [],
    laneManifest: [],
    volumes: {}, muted: {}, pans: {}, soloRoutes: [],
    trackSoundModes: {}, trackScales: {}, trackSynthTypes: {}, trackADSRs: {},
    trackFilters: {}, trackEqs: {},
    trackOctaves: {}, trackSemitones: {}, trackGlides: {}, trackLegatos: {},
    trackArps: {}, trackGranulars: {}, trackSidechains: {},
    trackSpeeds: {}, trackDroneModes: {}, trackDroneRoots: {},
    trackLoopRegions: {}, trackGridResolutions: {}, trackPitchVariety: {},
    trackStopVelocities: {},
    trackNoteChances: {}, trackStopChances: {}, trackLoopPatterns: {},
    trackPitchOffsets: {},
    trackLabels: {},
    activeFxTracks: [...DEFAULT_FX_TRACKS],
    fxBusWet: Object.fromEntries(FX_BUSES.map(b => [b.id, b.defaults?.wet ?? 1.0])),
    fxBusMuted: {}, fxBusSoloed: {}, fxBusParams: {},
    sendMatrix: {}, automationCfg: {},
    duplicates: [], merges: [],
    drumPattern: null,
    drumsMuted: false,
  }
}

// Every *visible* lane, in order — what MixerTab calls visibleInstrumentRoutes
// and serializes as laneManifest. Older snapshots lack a manifest; their base
// route list stands in for it.
function manifestOf(s) {
  if (Array.isArray(s.laneManifest) && s.laneManifest.length) {
    return s.laneManifest.map(lane => ({ id: lane.id, sourceId: lane.sourceId ?? null, kind: lane.kind ?? 'base' }))
  }
  return snapshotBaseRouteIds(s).map(id => ({ id, sourceId: null, kind: 'base' }))
}

const map = (m) => ({ ...(m ?? {}) })

/**
 * @param {object} base      a saved snapshot (defaultSnapshot(cityId) for a new song)
 * @param {object} plan      the output of validatePlan — never a raw model plan
 * @param {object} [opts]
 * @param {number|null} [opts.activeLaneLimit]  the plan's audible-lane cap (null = unlimited)
 * @returns {{ snapshot: object, activeIds: string[], skippedIds: string[], addedRouteIds: string[] }}
 */
export function applyPlanToSnapshot(base, plan, { activeLaneLimit = null } = {}) {
  if (!plan?.tracks?.length) throw new Error('The plan does not contain any playable tracks.')
  const s = {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    routeIds: snapshotBaseRouteIds(base),
    soloRoutes: [],          // applyAIPlan clears every solo before replacing lanes
    mode: 'mock',
    view: 'daw',
  }
  for (const key of [
    'volumes', 'muted', 'pans', 'trackScales', 'trackSynthTypes', 'trackADSRs', 'trackFilters',
    'trackOctaves', 'trackGlides', 'trackLegatos', 'trackArps', 'trackGranulars', 'trackSidechains',
    'trackSpeeds', 'trackDroneModes', 'trackDroneRoots', 'trackLoopRegions', 'trackGridResolutions',
    'trackPitchVariety', 'trackLabels', 'fxBusWet', 'fxBusParams', 'sendMatrix',
  ]) s[key] = map(base?.[key])
  s.activeFxTracks = [...(base?.activeFxTracks ?? DEFAULT_FX_TRACKS)]

  // The in-app composer may only use lanes already in the session. An MCP client
  // picks from the whole city, so plan routes the song doesn't have yet are
  // appended as new base lanes first (the plan was validated against the city's
  // route list, so every id here is real).
  const manifest = manifestOf(base ?? {})
  const known = new Set([...s.routeIds, ...manifest.map(lane => lane.id)])
  const addedRouteIds = []
  for (const { routeId } of plan.tracks) {
    if (known.has(routeId)) continue
    known.add(routeId)
    addedRouteIds.push(routeId)
    s.routeIds.push(routeId)
    manifest.push({ id: routeId, sourceId: null, kind: 'base' })
  }
  s.laneManifest = manifest

  const lanes = manifest.map(lane => ({ id: lane.id }))
  const replacement = buildReplacementLaneState(
    lanes, plan.tracks.map(track => track.routeId), s.muted, activeLaneLimit,
  )
  s.muted = replacement.disabled
  const activeIds = new Set(replacement.activeIds)

  if (plan.bpm != null) s.bpm = plan.bpm
  if (plan.masterVolume != null) s.masterVolume = plan.masterVolume
  if (plan.harmony) {
    // handleGlobalHarmony → handleScale on every lane, synthetic ones included.
    s.globalHarmony = { ...plan.harmony }
    const allLanes = new Set([
      ...s.routeIds, ...manifest.map(lane => lane.id),
      ...(s.duplicates ?? []).map(d => d?.id), ...(s.merges ?? []).map(m => m?.id),
    ])
    for (const id of allLanes) if (id) s.trackScales[id] = { ...plan.harmony }
  }

  if (plan.drums) {
    if (!plan.drums.enabled) {
      s.drumPattern = null
      s.drumsMuted = false
    } else {
      const padIds = Object.keys(plan.drums.patterns ?? {})
      s.drumPattern = {
        patterns: plan.drums.patterns,
        offsets: Object.fromEntries(padIds.map(id => [id, 0])),
        muted: Object.fromEntries(padIds.map(id => [id, false])),
        bpm: plan.bpm ?? s.bpm,
      }
      s.drumsMuted = false
      // applyAIPlan enables the drum lane on the engine directly; a saved song has
      // no engine, so the enable has to be written into the disable map instead.
      s.muted[DRUMS_ROUTE_ID] = false
      if (plan.drums.volume != null) s.volumes[DRUMS_ROUTE_ID] = plan.drums.volume
      if (plan.drums.filter) s.trackFilters[DRUMS_ROUTE_ID] = { ...s.trackFilters[DRUMS_ROUTE_ID], ...plan.drums.filter }
    }
  }

  for (const t of plan.tracks) {
    const id = t.routeId
    if (!activeIds.has(id)) continue

    if (t.synthType) {
      // handleSynthType resets the whole envelope/param block to that type's defaults.
      s.trackSynthTypes[id] = t.synthType
      s.trackADSRs[id] = { ...SYNTH_DEFAULTS[t.synthType] }
    }
    if (t.samplerPreset) s.trackADSRs[id] = { ...s.trackADSRs[id], samplerPreset: t.samplerPreset }
    if (t.drumVoice)     s.trackADSRs[id] = { ...s.trackADSRs[id], drumVoice: t.drumVoice }
    if (t.envelope)      s.trackADSRs[id] = { ...s.trackADSRs[id], ...t.envelope }
    if (t.filter)        s.trackFilters[id] = { ...s.trackFilters[id], ...t.filter }
    if (t.granular)      s.trackGranulars[id] = { ...DEFAULT_GRANULAR, ...s.trackGranulars[id], ...t.granular }
    if (t.volume != null) s.volumes[id] = t.volume
    if (t.pan != null)    s.pans[id] = t.pan
    if (t.octave != null) s.trackOctaves[id] = t.octave
    if (t.glide != null)  s.trackGlides[id] = t.glide
    if (t.legato != null) s.trackLegatos[id] = t.legato
    if (t.scale)          s.trackScales[id] = { ...t.scale }
    if (t.drone) {
      s.trackDroneModes[id] = !!t.drone.enabled
      if (t.drone.root) s.trackDroneRoots[id] = t.drone.root
    }
    if (t.arp)            s.trackArps[id] = { ...DEFAULT_ARP, ...s.trackArps[id], ...t.arp }
    if (t.speed != null)  s.trackSpeeds[id] = t.speed
    if (t.loopRegion)     s.trackLoopRegions[id] = { ...t.loopRegion }
    if (t.gridResolution) s.trackGridResolutions[id] = t.gridResolution
    if (t.pitchVariety)   s.trackPitchVariety[id] = { ...DEFAULT_PITCH_VARIETY, ...s.trackPitchVariety[id], ...t.pitchVariety }
    if (t.label) {
      // handleLaneTag: an empty tag removes the entry rather than storing blanks.
      const tag = normalizeLaneTag({ ...s.trackLabels[id], ...t.label })
      if (tag.text || tag.color) s.trackLabels[id] = tag
      else delete s.trackLabels[id]
    }
    if (t.sidechain) s.trackSidechains[id] = { ...DEFAULT_SIDECHAIN, ...s.trackSidechains[id], ...t.sidechain }
  }

  for (const f of plan.fx ?? []) {
    if (!s.activeFxTracks.includes(f.busId)) s.activeFxTracks.push(f.busId)
    if (f.wet != null) s.fxBusWet[f.busId] = f.wet
    for (const [paramId, value] of Object.entries(f.params ?? {})) {
      s.fxBusParams[f.busId] = { ...(s.fxBusParams[f.busId] ?? {}), [paramId]: value }
    }
    for (const send of f.sends ?? []) s.sendMatrix[`${send.routeId}:${f.busId}`] = send.level
  }

  return { snapshot: s, activeIds: replacement.activeIds, skippedIds: replacement.skippedIds, addedRouteIds }
}

/** A short human/LLM-readable description of what a snapshot's audible lanes play. */
export function describeSnapshot(snapshot, routes = []) {
  const byId = new Map(routes.map(r => [r.id, r]))
  const lanes = manifestOf(snapshot)
    .filter(lane => snapshot.muted?.[lane.id] === false)
    .map(lane => {
      const route = byId.get(lane.sourceId ?? lane.id)
      const adsr = snapshot.trackADSRs?.[lane.id] ?? {}
      return {
        routeId: lane.id,
        name: route?.name ?? lane.id,
        type: route?.type ?? null,
        synthType: snapshot.trackSynthTypes?.[lane.id] ?? 'Synth',
        ...(adsr.samplerPreset && snapshot.trackSynthTypes?.[lane.id] === 'Sampler' ? { samplerPreset: adsr.samplerPreset } : {}),
        ...(adsr.drumVoice && snapshot.trackSynthTypes?.[lane.id] === 'Drums' ? { drumVoice: adsr.drumVoice } : {}),
        label: snapshot.trackLabels?.[lane.id]?.text ?? null,
        volume: snapshot.volumes?.[lane.id] ?? 0,
      }
    })
  const pads = Object.entries(snapshot.drumPattern?.patterns ?? {})
    .filter(([, steps]) => steps?.some(v => v > 0))
    .map(([padId]) => padId)
  return {
    bpm: snapshot.bpm,
    harmony: snapshot.globalHarmony ?? null,
    lanes,
    drums: snapshot.drumPattern ? { pads, muted: !!snapshot.drumsMuted } : null,
    fx: snapshot.activeFxTracks ?? [],
  }
}
