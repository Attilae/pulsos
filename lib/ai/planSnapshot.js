// Apply a validated AI plan to a saved-song snapshot, without a browser. The
// in-app AI Composer applies a plan by replaying MixerTab's handlers against the
// live Tone graph (MixerTab.applyAIPlan); the MCP server has no graph and no
// React, so this is the same sequence ported onto the snapshot maps those
// handlers write. Pure — no Tone, React or engine import — so it runs in
// lib/server/. Keep it in step with applyAIPlan: test/plan-snapshot.test.js
// replays both paths and compares the resulting songs.

import { SCHEMA_VERSION } from '../persistence.js'
import { SYNTH_DEFAULTS, DEFAULT_GRANULAR, DEFAULT_SIDECHAIN, DEFAULT_FX_TRACKS, DRUMS_ROUTE_ID, TONE_SUPPORT } from '../soundSpecs.js'
import { DEFAULT_ARP, DEFAULT_PITCH_VARIETY } from '../mappings.js'
import { FX_BUSES } from '../fxSpecs.js'
import { normalizeLaneTag } from '../laneTags.js'
import { normalizeNoteChance, normalizeLoopPattern, isDefaultPattern } from '../laneGating.js'
import { snapshotBaseRouteIds } from '../songLanes.js'
import { normalizeNoteLength, DEFAULT_NOTE_LENGTH } from '../noteLength.js'
import { buildReplacementLaneState, sendsToClear, trackSynthParams } from './planApply.js'

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
    trackNoteChances: {}, trackStopChances: {}, trackLoopPatterns: {}, trackNoteLengths: {},
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
    'trackPitchVariety', 'trackNoteChances', 'trackNoteLengths', 'trackLoopPatterns', 'trackLabels', 'fxBusWet', 'fxBusParams', 'sendMatrix',
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
    const synthParams = trackSynthParams(t, s.trackSynthTypes[id] ?? 'Synth')
    if (Object.keys(synthParams).length) s.trackADSRs[id] = { ...s.trackADSRs[id], ...synthParams }
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
    if (t.noteChance != null) {
      // handleNoteChance: sparse — "always play" removes the entry.
      const chance = normalizeNoteChance(t.noteChance)
      if (chance >= 1) delete s.trackNoteChances[id]
      else s.trackNoteChances[id] = Math.round(chance * 100) / 100
    }
    if (t.noteLength !== undefined) {
      // handleNoteLength: sparse — null (or an unknown length) removes the entry.
      const len = normalizeNoteLength(t.noteLength)
      if (len) s.trackNoteLengths[id] = len
      else delete s.trackNoteLengths[id]
    }
    if (t.loopPattern) {
      // handleLoopPattern: sparse — the every-pass default removes the entry.
      const pattern = normalizeLoopPattern(t.loopPattern)
      if (isDefaultPattern(pattern)) delete s.trackLoopPatterns[id]
      else s.trackLoopPatterns[id] = pattern
    }
    if (t.label) {
      // handleLaneTag: an empty tag removes the entry rather than storing blanks.
      const tag = normalizeLaneTag({ ...s.trackLabels[id], ...t.label })
      if (tag.text || tag.color) s.trackLabels[id] = tag
      else delete s.trackLabels[id]
    }
    if (t.sidechain) s.trackSidechains[id] = { ...DEFAULT_SIDECHAIN, ...s.trackSidechains[id], ...t.sidechain }
  }

  // A new-composition plan (withNewCompositionBaseline) zeroes the planned lanes'
  // old sends first, exactly as applyAIPlan does through handleSendLevel.
  if (plan.clearSends) {
    for (const { routeId, busId } of sendsToClear(s.sendMatrix, [...activeIds, DRUMS_ROUTE_ID])) {
      s.sendMatrix[`${routeId}:${busId}`] = 0
    }
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

const round2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)

// Per-lane facts an edit needs to preserve what it wasn't asked to change —
// only settings that differ from a fresh lane's defaults, to keep the prompt small.
// Envelope times go to the millisecond: a 0.001 s attack must not read as 0.
const round3 = (v) => (v == null ? v : Math.round(v * 1000) / 1000)
const SAMPLE_ONLY_AR = new Set(['Sampler', 'Drums'])

// The plan-shaped `tone` for a lane, listing only what differs from the
// instrument's defaults (so an edit can see e.g. that the bass is a square wave).
function toneDetail(synthType, adsr) {
  const supported = TONE_SUPPORT[synthType]
  if (!supported || !adsr) return null
  const defaults = SYNTH_DEFAULTS[synthType] ?? {}
  const differs = (key) => adsr[key] != null && adsr[key] !== defaults[key]
  const tone = {}
  if (supported.includes('oscillator') && differs('oscillatorType')) tone.oscillator = adsr.oscillatorType
  if (supported.includes('harmonicity') && differs('harmonicity')) tone.harmonicity = round2(adsr.harmonicity)
  if (supported.includes('modulationIndex') && differs('modulationIndex')) tone.modulationIndex = round2(adsr.modulationIndex)
  if (supported.includes('modEnvelope') && ['modAttack', 'modDecay', 'modSustain', 'modRelease'].some(differs)) {
    tone.modEnvelope = {
      attack: round3(adsr.modAttack), decay: round3(adsr.modDecay),
      sustain: round2(adsr.modSustain), release: round3(adsr.modRelease),
    }
  }
  const FILTER_ENV = ['filterEnvAttack', 'filterEnvDecay', 'filterEnvSustain', 'filterEnvRelease', 'filterEnvBaseFreq', 'filterEnvOctaves']
  if (supported.includes('filterEnvelope') && FILTER_ENV.some(differs)) {
    const v = (key) => adsr[key] ?? defaults[key]
    tone.filterEnvelope = {
      attack: round3(v('filterEnvAttack')), decay: round3(v('filterEnvDecay')),
      sustain: round2(v('filterEnvSustain')), release: round3(v('filterEnvRelease')),
      baseFrequency: Math.round(v('filterEnvBaseFreq')), octaves: round2(v('filterEnvOctaves')),
    }
  }
  for (const key of ['filterQ', 'resonance', 'attackNoise']) {
    if (supported.includes(key) && differs(key)) tone[key] = round2(adsr[key])
  }
  if (supported.includes('dampening') && differs('dampening')) tone.dampening = Math.round(adsr.dampening)
  return Object.keys(tone).length ? tone : null
}

function laneDetail(snapshot, id) {
  const d = {}
  const has = (m) => m && Object.prototype.hasOwnProperty.call(m, id)
  if (has(snapshot.pans) && snapshot.pans[id]) d.pan = round2(snapshot.pans[id])
  if (has(snapshot.trackOctaves) && snapshot.trackOctaves[id]) d.octave = snapshot.trackOctaves[id]
  if (has(snapshot.trackSpeeds) && snapshot.trackSpeeds[id] !== 1) d.speed = snapshot.trackSpeeds[id]
  const region = snapshot.trackLoopRegions?.[id]
  if (region && (region.startCell !== 0 || region.endCell !== 64)) d.loopRegion = { startCell: region.startCell, endCell: region.endCell }
  if (has(snapshot.trackGridResolutions)) d.gridResolution = snapshot.trackGridResolutions[id]
  if (has(snapshot.trackPitchVariety)) {
    const pv = snapshot.trackPitchVariety[id]
    d.pitchVariety = { contour: pv?.contour ?? DEFAULT_PITCH_VARIETY.contour, variety: round2(pv?.variety ?? 0) }
  }
  const scale = snapshot.trackScales?.[id]
  const song = snapshot.globalHarmony
  if (scale && (!song || scale.root !== song.root || scale.scaleType !== song.scaleType)) d.scale = { root: scale.root, scaleType: scale.scaleType }
  const f = snapshot.trackFilters?.[id]
  if (f && f.frequency != null && f.frequency < 20000) d.filter = { type: f.type ?? 'lowpass', frequency: Math.round(f.frequency) }
  const adsr = snapshot.trackADSRs?.[id]
  const synthType = snapshot.trackSynthTypes?.[id] ?? 'Synth'
  if (adsr && adsr.attack != null) {
    // Sampler/Drums only honour attack and release; PluckSynth has no envelope.
    d.envelope = SAMPLE_ONLY_AR.has(synthType)
      ? { attack: round3(adsr.attack), release: round3(adsr.release) }
      : { attack: round3(adsr.attack), decay: round3(adsr.decay), sustain: round2(adsr.sustain), release: round3(adsr.release) }
  }
  if (synthType === 'PluckSynth') delete d.envelope
  const tone = toneDetail(synthType, adsr)
  if (tone) d.tone = tone
  if (snapshot.trackLegatos?.[id]) d.legato = true
  if (snapshot.trackDroneModes?.[id]) d.drone = { enabled: true, root: snapshot.trackDroneRoots?.[id] ?? null }
  if (snapshot.trackArps?.[id]?.enabled) {
    const { style, rate } = snapshot.trackArps[id]
    d.arp = { enabled: true, style, rate }
  }
  if (snapshot.trackGranulars?.[id]?.enabled) d.granular = { enabled: true, mix: round2(snapshot.trackGranulars[id].mix) }
  if (snapshot.trackSidechains?.[id]?.enabled) {
    const { source, amountDb } = snapshot.trackSidechains[id]
    d.sidechain = { enabled: true, source: source?.startsWith(DRUMS_ROUTE_ID) ? source.replace(DRUMS_ROUTE_ID, 'drums') : source, amountDb }
  }
  if (has(snapshot.trackNoteChances)) d.noteChance = snapshot.trackNoteChances[id]
  const noteLength = snapshot.trackNoteLengths?.[id]
  if (noteLength && noteLength !== DEFAULT_NOTE_LENGTH) d.noteLength = noteLength
  if (has(snapshot.trackLoopPatterns)) d.loopPattern = snapshot.trackLoopPatterns[id]
  const sends = Object.entries(snapshot.sendMatrix ?? {})
    .filter(([key, level]) => level > 0 && key.startsWith(`${id}:`) && !key.slice(id.length + 1).includes(':'))
    .map(([key, level]) => ({ busId: key.slice(id.length + 1), level: round2(level) }))
  if (sends.length) d.sends = sends
  return d
}

/**
 * A short human/LLM-readable description of what a snapshot's audible lanes play.
 * `{ detail: true }` adds what an edit needs to preserve the rest: per-lane
 * register/timing/tone/gating/sends, drum steps and FX bus settings.
 */
export function describeSnapshot(snapshot, routes = [], { detail = false } = {}) {
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
        ...(detail ? laneDetail(snapshot, lane.id) : {}),
      }
    })
  const padsOn = Object.entries(snapshot.drumPattern?.patterns ?? {})
    .filter(([, steps]) => steps?.some(v => v > 0))
  const pads = padsOn.map(([padId]) => padId)
  const drums = snapshot.drumPattern ? { pads, muted: !!snapshot.drumsMuted } : null
  if (drums && detail) {
    // The first 16 steps — the plan's compact pattern length.
    drums.patterns = padsOn.map(([padId, steps]) => ({ padId, steps: steps.slice(0, 16) }))
    if (snapshot.volumes?.[DRUMS_ROUTE_ID] != null) drums.volume = snapshot.volumes[DRUMS_ROUTE_ID]
  }
  const out = {
    bpm: snapshot.bpm,
    harmony: snapshot.globalHarmony ?? null,
    lanes,
    drums,
    fx: snapshot.activeFxTracks ?? [],
  }
  if (detail) {
    out.masterVolume = snapshot.masterVolume ?? 0
    out.fx = (snapshot.activeFxTracks ?? []).map(busId => ({
      busId,
      wet: snapshot.fxBusWet?.[busId] ?? 1,
      ...(snapshot.fxBusParams?.[busId] ? { params: snapshot.fxBusParams[busId] } : {}),
    }))
    const drumSends = Object.entries(snapshot.sendMatrix ?? {})
      .filter(([key, level]) => level > 0 && key.startsWith(`${DRUMS_ROUTE_ID}:`))
      .map(([key, level]) => ({ busId: key.slice(DRUMS_ROUTE_ID.length + 1), level: round2(level) }))
    if (drums && drumSends.length) drums.sends = drumSends
  }
  return out
}
