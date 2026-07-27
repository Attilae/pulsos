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
import { availableAutomationTargets } from './engine.js'
import { normalizeEqState } from './eqMigrate.js'
import {
  resolveSnapshotLanes, snapshotBaseRouteIds, snapshotLaneDisabledMap,
} from './songLanes.js'

// Migrate a { routeId → EQ } map so every value is a valid weq8 spec (older songs
// stored the legacy Tone.EQ3 shape). Returns a new object.
function migrateTrackEqs(trackEqs) {
  const out = {}
  for (const [rid, eq] of Object.entries(trackEqs ?? {})) out[rid] = normalizeEqState(eq)
  return out
}

// Per-stop pitch offsets used to live inside each duplicate descriptor
// (duplicates[].perStopSteps). They now live in a general per-route map
// (trackPitchOffsets). Hoist the legacy shape by duplicate id so old songs keep
// their chord voicings. Returns { routeId → { stopId: degrees } }.
function _hoistLegacyPitchOffsets(s) {
  const out = {}
  for (const d of s.duplicates ?? []) {
    if (d?.perStopSteps && Object.keys(d.perStopSteps).length) out[d.id] = { ...d.perStopSteps }
  }
  return out
}

// ── Build ───────────────────────────────────────────────────────────────────

export function buildSnapshot(s) {
  return {
    schemaVersion: SCHEMA_VERSION,

    // Route ids are city-scoped, so a song is only meaningful in its own city —
    // loading one from elsewhere switches the city rather than orphaning every lane.
    cityId:       s.cityId ?? null,

    bpm:          s.bpm,
    mode:         s.mode,
    view:         s.view,
    masterVolume: s.masterVolume,
    globalHarmony: s.globalHarmony ?? null,

    // The exact lanes this song plays, in order. Without this the lane list was
    // re-rolled randomly on every load (pickStartupRoutes) and a song's non-metro
    // lanes were silently orphaned. Superset of laneManifest, which excludes
    // merge-consumed and automation-source lanes.
    routeIds:     (s.routeIds ?? []).filter(Boolean),

    // Stable visible-lane order lets entitlement downgrades disable only the
    // excess lanes without deleting configuration or relying on random picks.
    laneManifest: (s.laneManifest ?? []).map(lane => ({
      id: lane.id,
      sourceId: lane.sourceId ?? null,
      kind: lane.kind ?? 'base',
    })),

    volumes:         s.volumes         ?? {},
    muted:           s.disabledRoutes  ?? {},   // persisted key kept as 'muted' for old saves
    pans:            s.pans            ?? {},
    soloRoutes:      Array.from(s.soloRoutes ?? []),

    trackSoundModes: s.trackSoundModes ?? {},
    trackScales:     s.trackScales     ?? {},
    trackSynthTypes: s.trackSynthTypes ?? {},
    trackADSRs:      s.trackADSRs      ?? {},
    trackFilters:    s.trackFilters    ?? {},
    trackEqs:        s.trackEqs        ?? {},
    trackOctaves:    s.trackOctaves    ?? {},
    trackSemitones:  s.trackSemitones  ?? {},
    trackGlides:     s.trackGlides     ?? {},
    trackLegatos:    s.trackLegatos    ?? {},
    trackArps:       s.trackArps       ?? {},
    trackGranulars:  s.trackGranulars  ?? {},
    trackSpeeds:     s.trackSpeeds     ?? {},
    trackDroneModes: s.trackDroneModes ?? {},
    trackDroneRoots: s.trackDroneRoots ?? {},
    trackLoopRegions: s.trackLoopRegions ?? {},
    trackGridResolutions: s.trackGridResolutions ?? {},
    trackPitchVariety: s.trackPitchVariety ?? {},
    trackStopVelocities: s.trackStopVelocities ?? {},
    // Per-stop diatonic pitch offsets, all lanes. Migrated from legacy
    // duplicates[].perStopSteps on load when this key is absent.
    trackPitchOffsets: s.trackPitchOffsets ?? _hoistLegacyPitchOffsets(s),

    activeFxTracks:  s.activeFxTracks  ?? [],
    fxBusWet:        s.fxBusWet        ?? {},
    fxBusMuted:      s.fxBusMuted      ?? {},
    fxBusSoloed:     s.fxBusSoloed     ?? {},
    fxBusParams:     _stripCustomIRBuffers(s.fxBusParams ?? {}),

    sendMatrix:      s.sendMatrix      ?? {},
    automationCfg:   s.automationCfg   ?? {},

    // Duplicate lanes: descriptors only ({ id, sourceId, name }) — the clone
    // routes are reconstructed from the base routes on load. Per-stop pitch lives
    // in trackPitchOffsets (older snapshots carried it here as perStopSteps).
    duplicates:      (s.duplicates ?? []).map(({ perStopSteps, ...d }) => d),

    // Merged lanes: descriptors only ({ id, sourceIds, name, synthType }) — the
    // synthetic PolySynth route is reconstructed from the base routes on load.
    merges:          s.merges          ?? [],

    // Drum backing imported from the Drum Machine tab, or null.
    // Shape: { patterns, offsets, muted, bpm }.
    drumPattern:     s.drumPattern     ?? null,
    drumsMuted:      !!s.drumsMuted,
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

// Normalize saved automation lanes to the current schema so load is robust:
//   • keep only { sourceRouteId, paramTarget, points } (drop legacy source/mode)
//   • guarantee points is a fresh plain object (never aliases the snapshot)
//   • validate paramTarget against the lane's instrument synth type + the song's
//     active FX buses, falling back to 'volume' (always valid) for stale targets.
function normalizeAutomationCfg(automationCfg, trackSynthTypes = {}, activeFxTracks = [], trackGranulars = {}) {
  const out = {}
  for (const [routeId, lanes] of Object.entries(automationCfg ?? {})) {
    const synthType = trackSynthTypes[routeId] ?? 'Synth'
    const validIds  = new Set(availableAutomationTargets(
      synthType, activeFxTracks, !!trackGranulars[routeId]?.enabled
    ).map(t => t.id))
    const cleanLanes = {}
    for (const [laneId, cfg] of Object.entries(lanes ?? {})) {
      if (!cfg) continue
      cleanLanes[laneId] = {
        sourceRouteId: cfg.sourceRouteId ?? '',
        paramTarget:   validIds.has(cfg.paramTarget) ? cfg.paramTarget : 'volume',
        points:        (cfg.points && typeof cfg.points === 'object') ? { ...cfg.points } : {},
        speed:         typeof cfg.speed === 'number' ? cfg.speed : 1,
        glide:         typeof cfg.glide === 'number' ? cfg.glide : 0,
        loopRegion:    (cfg.loopRegion
          && typeof cfg.loopRegion.startCell === 'number'
          && typeof cfg.loopRegion.endCell   === 'number')
          ? { startCell: cfg.loopRegion.startCell, endCell: cfg.loopRegion.endCell }
          : null,
      }
    }
    out[routeId] = cleanLanes
  }
  return out
}

// ── Migration ───────────────────────────────────────────────────────────────

/**
 * Bring a saved snapshot up to the current schema. Pure — no engine, no React.
 *
 * Migrations used to be implicit shape-sniffing scattered through applySnapshot,
 * which made "will this old song load?" unanswerable without reading every
 * branch. They're now an ordered pipeline keyed off schemaVersion.
 *
 * A *newer* version than we know is applied best-effort with a warning rather
 * than refused: a save from a newer client must never become unopenable.
 *
 * @param {object} raw      - the bare snapshot body
 * @param {number} version  - its schemaVersion (1 when absent)
 */
export function migrateSnapshot(raw, version) {
  let s = { ...(raw ?? {}) }
  const from = Number.isFinite(version) ? version : 1

  if (from < 2) {
    // 'Granular' was briefly a synth type; it's now a per-track layer.
    s.trackSynthTypes = _coerceLegacySynthTypes(s.trackSynthTypes)
    // trackEqs held the legacy 3-band Tone.EQ3 shape before weq8.
    s.trackEqs = migrateTrackEqs(s.trackEqs)
    // Per-stop pitch offsets lived inside each duplicate descriptor.
    s.trackPitchOffsets = s.trackPitchOffsets ?? _hoistLegacyPitchOffsets(s)
    s.duplicates = (s.duplicates ?? []).map(({ perStopSteps, ...d }) => d)
  }

  if (from < 3) {
    // The lane list was never stored. Recover it from whatever carries route ids
    // so an old song opens with its own lanes instead of a random startup pick.
    s.routeIds = snapshotBaseRouteIds(s)
    // Pre-v3 songs have no city. null means "assume the currently-loaded city",
    // which is exactly how they behaved before cities were recorded.
    s.cityId = s.cityId ?? null
  }

  if (from > SCHEMA_VERSION) {
    console.warn(`[songState] snapshot schemaVersion ${from} is newer than ${SCHEMA_VERSION}; applying best-effort`)
  }

  // Version-independent hygiene: drop automation targets that no longer exist for
  // the lane's synth type / active FX buses (they'd otherwise bind to nothing).
  s.automationCfg = normalizeAutomationCfg(s.automationCfg, s.trackSynthTypes, s.activeFxTracks, s.trackGranulars)
  return s
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
  const raw = snapshot.state ?? snapshot   // allow either wrapped or bare
  // Bring old saves up to the current shape (EQ specs, pitch-offset location,
  // stale synth types, derived routeIds) before anything reads them.
  const s = migrateSnapshot(raw, snapshot.schemaVersion ?? raw.schemaVersion)

  // The lane set this snapshot plays: `routes` is the caller's base selection,
  // plus the duplicate/merged lanes reconstructed from the snapshot's descriptors.
  const { lanes } = resolveSnapshotLanes(routes, s)
  const laneIds = new Set(lanes.map(r => r.id))
  // Dense over every lane, so React state and engine gains can't diverge — a lane
  // the snapshot doesn't mention is disabled in *both*, never phantom-active.
  const disabled = snapshotLaneDisabledMap(lanes, s)
  // Drop solo ids that aren't in this lane set. A stale id would leave
  // engine._soloRoutes non-empty with nothing matching, gating every lane silent.
  const solos = (s.soloRoutes ?? []).filter(id => laneIds.has(id))

  // 1. Globals + master ──────────────────────────────────────────────────────
  if (s.bpm          != null) setters.setBpm?.(s.bpm)
  if (s.mode         != null) setters.setMode?.(s.mode)
  if (s.view         != null) setters.setView?.(s.view)
  if (s.masterVolume != null) {
    setters.setMasterVolume?.(s.masterVolume)
    try { Tone.getDestination().volume.value = s.masterVolume } catch {}
  }
  if (s.globalHarmony != null) setters.setGlobalHarmony?.(s.globalHarmony)

  // 2. Per-route React state (bulk-restore in one pass) ──────────────────────
  setters.setVolumes?.(s.volumes ?? {})
  setters.setDisabledRoutes?.(disabled)
  setters.setPans?.(s.pans ?? {})
  setters.setSoloRoutes?.(new Set(solos))
  setters.setTrackSoundModes?.(s.trackSoundModes ?? {})
  setters.setTrackScales?.(s.trackScales ?? {})
  setters.setTrackSynthTypes?.(s.trackSynthTypes ?? {})
  setters.setTrackADSRs?.(s.trackADSRs ?? {})
  setters.setTrackFilters?.(s.trackFilters ?? {})
  setters.setTrackEqs?.(s.trackEqs ?? {})
  setters.setTrackOctaves?.(s.trackOctaves ?? {})
  setters.setTrackSemitones?.(s.trackSemitones ?? {})
  setters.setTrackGlides?.(s.trackGlides ?? {})
  setters.setTrackLegatos?.(s.trackLegatos ?? {})
  setters.setTrackArps?.(s.trackArps ?? {})
  setters.setTrackGranulars?.(s.trackGranulars ?? {})
  setters.setTrackSpeeds?.(s.trackSpeeds ?? {})
  setters.setTrackDroneModes?.(s.trackDroneModes ?? {})
  setters.setTrackDroneRoots?.(s.trackDroneRoots ?? {})
  setters.setTrackLoopRegions?.(s.trackLoopRegions ?? {})
  setters.setTrackGridResolutions?.(s.trackGridResolutions ?? {})
  setters.setTrackPitchVariety?.(s.trackPitchVariety ?? {})
  setters.setTrackStopVelocities?.(s.trackStopVelocities ?? {})
  setters.setTrackPitchOffsets?.(s.trackPitchOffsets ?? {})

  // 3. FX state (bulk) ───────────────────────────────────────────────────────
  setters.setActiveFxTracks?.(s.activeFxTracks ?? [])
  setters.setFxBusWet?.(s.fxBusWet ?? {})
  setters.setFxBusMuted?.(s.fxBusMuted ?? {})
  setters.setFxBusSoloed?.(s.fxBusSoloed ?? {})
  setters.setFxBusParams?.(s.fxBusParams ?? {})
  setters.setSendMatrix?.(s.sendMatrix ?? {})

  // migrateSnapshot already normalized automation lanes; the same cleaned cfg goes
  // to React state and the engine so the UI and audio graph stay in lock-step.
  setters.setAutomationCfg?.(s.automationCfg ?? {})

  // Duplicate + merged lane descriptors. Their reconstructed routes are already in
  // `lanes` above, so the engine replay can resolve their synthetic ids.
  setters.setDuplicates?.(s.duplicates ?? [])
  setters.setMerges?.(s.merges ?? [])

  // Drum backing (Map/DAW): restore React state; engine replay happens below.
  setters.setDrumPattern?.(s.drumPattern ?? null)
  setters.setDrumsMuted?.(!!s.drumsMuted)

  // 4. Replay onto engine (no-op if engine not ready; React state still
  //    drives subsequent play-time configuration via existing handlers). ────
  if (engine) _applyToEngine({ ...s, muted: disabled, soloRoutes: solos }, engine, lanes, laneIds)
}

function _coerceLegacySynthTypes(trackSynthTypes) {
  const out = {}
  for (const [rid, t] of Object.entries(trackSynthTypes ?? {})) {
    out[rid] = t === 'Granular' ? 'Synth' : t
  }
  return out
}

function _applyToEngine(s, engine, routes, laneIds) {
  const routeById = new Map((routes ?? []).map(r => [r.id, r]))

  // Solo is additive in the engine (setSolo only adds to _soloRoutes), so a
  // previous song's solos would survive into this one — and any solo at all gates
  // every non-soloed lane silent. Start from a clean slate.
  try { engine.clearSolos?.() } catch (e) { console.warn('apply clearSolos', e) }

  // Per-route config — order matches interactive handler order. Every lane is
  // included even if the snapshot has no settings for it, so each one gets its
  // explicit setRouteDisabled below rather than inheriting a stale engine flag.
  const routeIds = new Set([
    ...(laneIds ?? []),
    ...Object.keys(s.trackSynthTypes ?? {}),
    ...Object.keys(s.trackADSRs ?? {}),
    ...Object.keys(s.trackFilters ?? {}),
    ...Object.keys(s.trackEqs ?? {}),
    ...Object.keys(s.trackScales ?? {}),
    ...Object.keys(s.trackOctaves ?? {}),
    ...Object.keys(s.trackSemitones ?? {}),
    ...Object.keys(s.trackGlides ?? {}),
    ...Object.keys(s.trackLegatos ?? {}),
    ...Object.keys(s.trackArps ?? {}),
    ...Object.keys(s.trackGranulars ?? {}),
    ...Object.keys(s.trackSpeeds ?? {}),
    ...Object.keys(s.trackDroneModes ?? {}),
    ...Object.keys(s.trackDroneRoots ?? {}),
    ...Object.keys(s.volumes ?? {}),
    ...Object.keys(s.muted ?? {}),
    ...Object.keys(s.pans ?? {}),
    ...Object.keys(s.trackSoundModes ?? {}),
    ...Object.keys(s.trackLoopRegions ?? {}),
    ...Object.keys(s.trackGridResolutions ?? {}),
    ...Object.keys(s.trackPitchVariety ?? {}),
    ...Object.keys(s.trackStopVelocities ?? {}),
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
    if (eq) { try { engine.setRouteEqState?.(rid, eq) } catch (e) { console.warn('apply setRouteEqState', e) } }

    const scale = s.trackScales?.[rid]
    if (scale) {
      try { engine.setScale?.(rid, scale) } catch (e) { console.warn('apply setScale', e) }
      const mode = s.trackSoundModes?.[rid]
      if (mode && shortName) {
        try { engine.setSoundMode?.(shortName, mode, scale) } catch (e) { console.warn('apply setSoundMode', e) }
      }
    }

    const octave = s.trackOctaves?.[rid]
    if (octave != null) { try { engine.setOctaveShift?.(rid, octave) } catch (e) { console.warn('apply setOctaveShift', e) } }

    const semitone = s.trackSemitones?.[rid]
    if (semitone != null) { try { engine.setSemitoneShift?.(rid, semitone) } catch (e) { console.warn('apply setSemitoneShift', e) } }

    const glide = s.trackGlides?.[rid]
    if (glide != null) { try { engine.setGlide?.(rid, glide) } catch (e) { console.warn('apply setGlide', e) } }

    const legato = s.trackLegatos?.[rid]
    if (legato != null) { try { engine.setLegato?.(rid, !!legato) } catch (e) { console.warn('apply setLegato', e) } }

    const arp = s.trackArps?.[rid]
    if (arp) { try { engine.setArpeggiator?.(rid, arp) } catch (e) { console.warn('apply setArpeggiator', e) } }

    const granular = s.trackGranulars?.[rid]
    if (granular) { try { engine.setGranular?.(rid, granular) } catch (e) { console.warn('apply setGranular', e) } }

    const speed = s.trackSpeeds?.[rid]
    if (speed != null) { try { engine.setTrackSpeed?.(rid, speed) } catch (e) { console.warn('apply setTrackSpeed', e) } }

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
      try { engine.setRouteDisabled?.(rid, !!s.muted[rid]) } catch (e) { console.warn('apply setRouteDisabled', e) }
    }

    const gridResolution = s.trackGridResolutions?.[rid]
    if (gridResolution) {
      try { engine.setGridResolution?.(rid, gridResolution) } catch (e) { console.warn('apply setGridResolution', e) }
    }

    const pitchVariety = s.trackPitchVariety?.[rid]
    if (pitchVariety) {
      try { engine.setPitchVariety?.(rid, pitchVariety) } catch (e) { console.warn('apply setPitchVariety', e) }
    }

    const stopVelocities = s.trackStopVelocities?.[rid]
    if (stopVelocities && Object.keys(stopVelocities).length) {
      try { engine.setStopVelocities?.(rid, stopVelocities) } catch (e) { console.warn('apply setStopVelocities', e) }
    }

    const loopRegion = s.trackLoopRegions?.[rid]
    if (loopRegion) {
      try { engine.setTrackLoopRegion?.(rid, loopRegion) } catch (e) { console.warn('apply setTrackLoopRegion', e) }
    }
  }

  // Solo — already filtered to live lanes by applySnapshot.
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

  // Drum backing — engine picks it up on its next startMock (or live if playing).
  try { engine.setDrumPattern?.(s.drumPattern ?? null) } catch (e) { console.warn('apply setDrumPattern', e) }

  // Per-stop diatonic pitch offsets, all lanes (applied when each Part builds).
  for (const [rid, map] of Object.entries(s.trackPitchOffsets ?? {})) {
    if (map && Object.keys(map).length) {
      try { engine.setPitchOffsets?.(rid, map) } catch (e) { console.warn('apply setPitchOffsets', e) }
    }
  }

  // Merged lanes: register the fold so source lanes are gated silent and the merged
  // lane builds its chord Part on the next startMock.
  for (const m of s.merges ?? []) {
    if (m?.id && m.sourceIds?.length) {
      try { engine.setMerge?.(m.id, m.sourceIds) } catch (e) { console.warn('apply setMerge', e) }
    }
  }
}
