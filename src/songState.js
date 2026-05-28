// Build/apply a JSON-safe snapshot of the Mixer/Map "song" state.
//
// buildSnapshot(state)         → plain object suitable for JSON.stringify
// applySnapshot(snap, …)       → restores React state + replays engine config
//
// Apply order is critical: engine methods depend on prior config (e.g. FX
// tracks must exist before sendMatrix wires gains, synth must exist before
// envelope updates, source routes must exist before automation lanes bind).

import * as Tone from 'tone'
import { SCHEMA_VERSION } from './persistence.js'

// ── Build ───────────────────────────────────────────────────────────────────

export function buildSnapshot(s) {
  return {
    schemaVersion: SCHEMA_VERSION,

    bpm:          s.bpm,
    mode:         s.mode,
    view:         s.view,
    masterVolume: s.masterVolume,

    volumes:         s.volumes         ?? {},
    muted:           s.muted           ?? {},
    pans:            s.pans            ?? {},
    soloRoutes:      Array.from(s.soloRoutes ?? []),

    trackSoundModes: s.trackSoundModes ?? {},
    trackScales:     s.trackScales     ?? {},
    trackSynthTypes: s.trackSynthTypes ?? {},
    trackADSRs:      s.trackADSRs      ?? {},
    trackFilters:    s.trackFilters    ?? {},
    trackEqs:        s.trackEqs        ?? {},
    trackPitchMaps:  s.trackPitchMaps  ?? {},
    trackOctaves:    s.trackOctaves    ?? {},
    trackGlides:     s.trackGlides     ?? {},
    trackDroneModes: s.trackDroneModes ?? {},
    trackDroneRoots: s.trackDroneRoots ?? {},
    trackLoopRegions: s.trackLoopRegions ?? {},

    activeFxTracks:  s.activeFxTracks  ?? [],
    fxBusWet:        s.fxBusWet        ?? {},
    fxBusMuted:      s.fxBusMuted      ?? {},
    fxBusSoloed:     s.fxBusSoloed     ?? {},
    fxBusParams:     _stripCustomIRBuffers(s.fxBusParams ?? {}),

    sendMatrix:      s.sendMatrix      ?? {},
    automationCfg:   s.automationCfg   ?? {},
  }
}

// Custom IR uploads are AudioBuffer instances — strip any non-serializable
// values but keep scalar params (e.g. irType: 'custom' stays so the user knows
// to re-upload).
function _stripCustomIRBuffers(fxBusParams) {
  const out = {}
  for (const [busId, params] of Object.entries(fxBusParams)) {
    if (!params || typeof params !== 'object') { out[busId] = params; continue }
    const clean = {}
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue
      const t = typeof v
      if (t === 'string' || t === 'number' || t === 'boolean') clean[k] = v
    }
    out[busId] = clean
  }
  return out
}

// ── Apply ───────────────────────────────────────────────────────────────────

/**
 * Replay an entire snapshot onto React state + engine.
 *
 * @param {object} snapshot   - result of buildSnapshot()
 * @param {object} setters    - { setBpm, setVolumes, … } (the React setters)
 * @param {object} engine     - TransitEngine instance (may be null)
 * @param {Array}  routes     - current routes array (for type/shortName lookup)
 */
export function applySnapshot(snapshot, setters, engine, routes) {
  if (!snapshot) return
  const s = snapshot.state ?? snapshot   // allow either wrapped or bare

  // 1. Globals + master ──────────────────────────────────────────────────────
  if (s.bpm          != null) setters.setBpm?.(s.bpm)
  if (s.mode         != null) setters.setMode?.(s.mode)
  if (s.view         != null) setters.setView?.(s.view)
  if (s.masterVolume != null) {
    setters.setMasterVolume?.(s.masterVolume)
    try { Tone.getDestination().volume.value = s.masterVolume } catch {}
  }

  // 2. Per-route React state (bulk-restore in one pass) ──────────────────────
  setters.setVolumes?.(s.volumes ?? {})
  setters.setMuted?.(s.muted ?? {})
  setters.setPans?.(s.pans ?? {})
  setters.setSoloRoutes?.(new Set(s.soloRoutes ?? []))
  setters.setTrackSoundModes?.(s.trackSoundModes ?? {})
  setters.setTrackScales?.(s.trackScales ?? {})
  setters.setTrackSynthTypes?.(s.trackSynthTypes ?? {})
  setters.setTrackADSRs?.(s.trackADSRs ?? {})
  setters.setTrackFilters?.(s.trackFilters ?? {})
  setters.setTrackEqs?.(s.trackEqs ?? {})
  setters.setTrackPitchMaps?.(s.trackPitchMaps ?? {})
  setters.setTrackOctaves?.(s.trackOctaves ?? {})
  setters.setTrackGlides?.(s.trackGlides ?? {})
  setters.setTrackDroneModes?.(s.trackDroneModes ?? {})
  setters.setTrackDroneRoots?.(s.trackDroneRoots ?? {})
  setters.setTrackLoopRegions?.(s.trackLoopRegions ?? {})

  // 3. FX state (bulk) ───────────────────────────────────────────────────────
  setters.setActiveFxTracks?.(s.activeFxTracks ?? [])
  setters.setFxBusWet?.(s.fxBusWet ?? {})
  setters.setFxBusMuted?.(s.fxBusMuted ?? {})
  setters.setFxBusSoloed?.(s.fxBusSoloed ?? {})
  setters.setFxBusParams?.(s.fxBusParams ?? {})
  setters.setSendMatrix?.(s.sendMatrix ?? {})
  setters.setAutomationCfg?.(s.automationCfg ?? {})

  // 4. Replay onto engine (no-op if engine not ready; React state still
  //    drives subsequent play-time configuration via existing handlers). ────
  if (engine) _applyToEngine(s, engine, routes)
}

function _applyToEngine(s, engine, routes) {
  const routeById = new Map((routes ?? []).map(r => [r.id, r]))

  // Per-route config — order matches interactive handler order
  const routeIds = new Set([
    ...Object.keys(s.trackSynthTypes ?? {}),
    ...Object.keys(s.trackADSRs ?? {}),
    ...Object.keys(s.trackFilters ?? {}),
    ...Object.keys(s.trackEqs ?? {}),
    ...Object.keys(s.trackScales ?? {}),
    ...Object.keys(s.trackPitchMaps ?? {}),
    ...Object.keys(s.trackOctaves ?? {}),
    ...Object.keys(s.trackGlides ?? {}),
    ...Object.keys(s.trackDroneModes ?? {}),
    ...Object.keys(s.volumes ?? {}),
    ...Object.keys(s.muted ?? {}),
    ...Object.keys(s.pans ?? {}),
    ...Object.keys(s.trackSoundModes ?? {}),
    ...Object.keys(s.trackLoopRegions ?? {}),
  ])

  for (const rid of routeIds) {
    const route = routeById.get(rid)
    const routeType = route?.type
    const shortName = route?.name

    const synthType = s.trackSynthTypes?.[rid]
    const adsr      = s.trackADSRs?.[rid]
    if (synthType && routeType) {
      try { engine.setSynthType?.(rid, routeType, synthType, adsr ?? {}) } catch (e) { console.warn('apply setSynthType', e) }
    }
    if (adsr) {
      try { engine.updateEnvelope?.(rid, adsr) } catch (e) { console.warn('apply updateEnvelope', e) }
    }

    const filter = s.trackFilters?.[rid]
    if (filter) { try { engine.setRouteFilter?.(rid, filter) } catch (e) { console.warn('apply setRouteFilter', e) } }

    const eq = s.trackEqs?.[rid]
    if (eq) { try { engine.setRouteEq?.(rid, eq) } catch (e) { console.warn('apply setRouteEq', e) } }

    const scale = s.trackScales?.[rid]
    if (scale) {
      try { engine.setScale?.(rid, scale) } catch (e) { console.warn('apply setScale', e) }
      const mode = s.trackSoundModes?.[rid]
      if (mode && shortName) {
        try { engine.setSoundMode?.(shortName, mode, scale) } catch (e) { console.warn('apply setSoundMode', e) }
      }
    }

    const pitchMap = s.trackPitchMaps?.[rid]
    if (pitchMap) { try { engine.setPitchMap?.(rid, pitchMap) } catch (e) { console.warn('apply setPitchMap', e) } }

    const octave = s.trackOctaves?.[rid]
    if (octave != null) { try { engine.setOctaveShift?.(rid, octave) } catch (e) { console.warn('apply setOctaveShift', e) } }

    const glide = s.trackGlides?.[rid]
    if (glide != null) { try { engine.setGlide?.(rid, glide) } catch (e) { console.warn('apply setGlide', e) } }

    const droneOn = s.trackDroneModes?.[rid]
    const droneRoot = s.trackDroneRoots?.[rid] ?? 'C3'
    if (droneOn != null) {
      try { engine.setDroneMode?.(rid, !!droneOn, droneRoot) } catch (e) { console.warn('apply setDroneMode', e) }
    } else if (s.trackDroneRoots?.[rid] != null) {
      try { engine.setDroneRoot?.(rid, droneRoot) } catch (e) { console.warn('apply setDroneRoot', e) }
    }

    const vol = s.volumes?.[rid]
    if (vol != null) { try { engine.setRouteVolume?.(rid, vol) } catch (e) { console.warn('apply setRouteVolume', e) } }

    const pan = s.pans?.[rid]
    if (pan != null) { try { engine.setRoutePan?.(rid, pan) } catch (e) { console.warn('apply setRoutePan', e) } }

    if (s.muted?.[rid] != null) {
      try { engine.setRouteMute?.(rid, !!s.muted[rid]) } catch (e) { console.warn('apply setRouteMute', e) }
    }

    const loopRegion = s.trackLoopRegions?.[rid]
    if (loopRegion) {
      try { engine.setTrackLoopRegion?.(rid, loopRegion) } catch (e) { console.warn('apply setTrackLoopRegion', e) }
    }
  }

  // Solo
  for (const rid of s.soloRoutes ?? []) {
    try { engine.setSolo?.(rid, true) } catch (e) { console.warn('apply setSolo', e) }
  }

  // FX buses — params first, then wet/mute/solo
  for (const [busId, params] of Object.entries(s.fxBusParams ?? {})) {
    for (const [k, v] of Object.entries(params ?? {})) {
      try { engine.setFxBusParam?.(busId, k, v) } catch (e) { console.warn('apply setFxBusParam', e) }
    }
  }
  for (const [busId, wet] of Object.entries(s.fxBusWet ?? {})) {
    try { engine.setFxBusWet?.(busId, wet) } catch (e) { console.warn('apply setFxBusWet', e) }
  }
  for (const [busId, m] of Object.entries(s.fxBusMuted ?? {})) {
    try { engine.setFxBusMute?.(busId, !!m) } catch (e) { console.warn('apply setFxBusMute', e) }
  }
  for (const [busId, soloed] of Object.entries(s.fxBusSoloed ?? {})) {
    try { engine.setFxBusSolo?.(busId, !!soloed) } catch (e) { console.warn('apply setFxBusSolo', e) }
  }

  // Send matrix (key format "<routeId>:<busId>")
  for (const [key, level] of Object.entries(s.sendMatrix ?? {})) {
    const [routeId, busId] = key.split(':')
    if (!routeId || !busId) continue
    try { engine.setSendLevel?.(routeId, busId, level) } catch (e) { console.warn('apply setSendLevel', e) }
  }

  // Automation lanes
  for (const [routeId, lanes] of Object.entries(s.automationCfg ?? {})) {
    for (const [laneId, cfg] of Object.entries(lanes ?? {})) {
      try { engine.addAutomationLane?.(routeId, laneId, cfg) } catch (e) { console.warn('apply addAutomationLane', e) }
    }
  }
}
