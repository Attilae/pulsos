import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { TransitEngine, SYNTH_DEFAULTS, availableAutomationTargets, DEFAULT_ARP, DEFAULT_GRANULAR, DEFAULT_SIDECHAIN, SIDECHAIN_ANY_DRUM, SIDECHAIN_PAD_SOURCES, DEFAULT_PITCH_VARIETY, DRUMS_ROUTE_ID } from '@/lib/engine.js'
import { FX_BUSES } from '@/lib/fxTrack.js'
import { randomFromScale, shiftOctaveNote, geoToMidi, routeBounds, midiToNote, noteToMidi, SCALES, MODES, setCityBounds } from '@/lib/mappings.js'
import { fetchLines } from '@/lib/shared/useRoutes.js'
import { useCitySelection } from '@/lib/shared/CityContext.jsx'
import { getCityEntry, linesUrlFor } from '@/lib/shared/cities.js'
import { resolveSnapshotLanes, clampMode } from '@/lib/songLanes.js'
import { normalizeLaneTag } from '@/lib/laneTags.js'
import { useDrumClipboard } from '@/lib/shared/DrumClipboardContext.jsx'
import { cycleStepValue } from '@/lib/engines/drumEngine.js'
import DawView, { NOTE_ROOTS, SCALE_TYPES } from '../DawView.jsx'
import MapView from '../MapView.jsx'
import AIComposerPanel from '../AIComposerPanel.jsx'
import SongMenu from '../SongMenu.jsx'
import { useSongPersistence } from '../../lib/useSongPersistence.js'
import { applySnapshot } from '@/lib/songState.js'
import {
  MidiSessionRecorder, exportRouteMidi, exportMixMidi,
  isRouteExportable, isRouteAudible, buildLoopMidiEvents,
} from '@/lib/midiExport.js'
import { exportRouteAudio, exportMixAudio } from '@/lib/audioExport.js'
import { useEntitlements } from '@/lib/shared/EntitlementsContext.jsx'
import { countActiveLanes, normalizeLaneAccess, normalizeSnapshotLaneAccess } from '@/lib/billing/plans.js'
import { buildReplacementLaneState } from '@/lib/ai/planApply.js'
import { trackProductEvent } from '@/lib/productAnalytics.js'
import { unlockAudio, releaseAudioSession, probeOutputPeak } from '@/lib/audioSession.js'
import { registerSoundCheck } from '@/lib/shared/soundCheck.js'
import AudioTroubleshooter from '../AudioTroubleshooter.jsx'
import MobileDaw from '../mobile/MobileDaw.jsx'
import { useIsPhone } from '@/lib/shared/useViewport.js'

const MAX_EVENTS = 80

// Startup lane caps per line type. Metro is capped too: most cities have a
// handful of metro lines, but some (e.g. NYC's 28-route subway) have many —
// without a cap they'd all open at once and freeze the map/DAW render. ≥9 keeps
// every current non-NYC city unchanged.
const STARTUP_PICKS = { metro: 10, tram: 5, trolley: 5, bus: 5 }

// FX rack buses present in a fresh session (new song / city switch / reset).
const DEFAULT_FX_TRACKS = ['reverb', 'delay', 'chorus', 'distortion']

// Fisher–Yates shuffle in place (unseeded — a fresh roll each call).
function shuffle(pool) {
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

// Randomly pick up to n routes of a single type (only routes that have stops).
function pickType(allRoutes, type, n) {
  const pool = allRoutes.filter(r => r.type === type && r.stops?.length)
  shuffle(pool)
  return pool.slice(0, n)
}

function pickStartupRoutes(allRoutes) {
  // Metro: keep sort order (the "main" lines first), capped — not shuffled, so
  // e.g. Budapest stays M1–M4 and NYC gets its first N subway lines in order.
  const picked = [
    ...allRoutes.filter(r => r.type === 'metro' && r.stops?.length).slice(0, STARTUP_PICKS.metro),
  ]
  // Other types: a fresh random sample each load.
  for (const [type, n] of Object.entries(STARTUP_PICKS)) {
    if (type === 'metro') continue
    picked.push(...pickType(allRoutes, type, n))
  }
  return picked
}

// Every freshly (re)picked track starts disabled — the user builds up the mix
// by enabling lanes one at a time rather than hearing the whole city at once.
function allDisabledMap(routes) {
  return Object.fromEntries(routes.map(r => [r.id, true]))
}

// Changing a lane's line mints a new synthetic route id. A sidechain map is keyed
// by *destination* but also stores a *source* id, so both sides have to move —
// otherwise every lane ducking off the changed line silently stops pumping.
function remapSidechainSource(map, oldId, newId) {
  const entries = Object.entries(map ?? {})
  if (!entries.some(([rid, cfg]) => rid === oldId || cfg?.source === oldId)) return map
  const next = {}
  for (const [rid, cfg] of entries) {
    next[rid === oldId ? newId : rid] = cfg?.source === oldId ? { ...cfg, source: newId } : cfg
  }
  return next
}

// Drop a removed lane from a sidechain map: its own cfg goes, and anyone ducking
// off it loses the trigger rather than pointing at a route that will never fire.
function dropSidechainSource(map, routeId) {
  const entries = Object.entries(map ?? {})
  if (!entries.some(([rid, cfg]) => rid === routeId || cfg?.source === routeId)) return map
  const next = {}
  for (const [rid, cfg] of entries) {
    if (rid === routeId) continue
    next[rid] = cfg?.source === routeId ? { ...cfg, source: '', enabled: false } : cfg
  }
  return next
}

// Derive interchange "hubs" for the network-convergence chords from the route
// list: the stops served by the most distinct routes, with averaged coords.
// Used for cities other than Budapest (which keeps its curated hubs).
function deriveHubs(allRoutes, n = 6) {
  const byName = new Map()  // stopName → { routes:Set, lat, lng, count }
  for (const route of allRoutes ?? []) {
    for (const s of route.stops ?? []) {
      if (!s.name || !Number.isFinite(s.lat)) continue
      let e = byName.get(s.name)
      if (!e) { e = { name: s.name, routes: new Set(), lat: 0, lng: 0, count: 0 }; byName.set(s.name, e) }
      e.routes.add(route.id)
      e.lat += s.lat; e.lng += (s.lon ?? s.lng ?? 0); e.count++
    }
  }
  return [...byName.values()]
    .filter(e => e.routes.size >= 2)
    .sort((a, b) => b.routes.size - a.routes.size)
    .slice(0, n)
    .map(e => ({ name: e.name, lat: e.lat / e.count, lng: e.lng / e.count }))
}

export default function MixerTab({ active = true }) {
  const { cityId, setCityId, cityEntry } = useCitySelection()
  const { limits, claim, openUpgrade } = useEntitlements()
  const loadedCityRef    = useRef(null)   // last city whose routes are loaded
  const engineRef        = useRef(null)
  const stoppingRef      = useRef(false)
  // A preset load owns the session while it's in flight: `pendingPresetRef` is set
  // *synchronously* before setCityId so the city effect below can see it and stand
  // down (it would otherwise reset + randomly re-pick over the loaded song).
  // `presetTokenRef` supersedes stale applies when loads or switches overlap.
  const pendingPresetRef = useRef(null)   // { token, cityId } | null
  const presetTokenRef   = useRef(0)
  // Latest values for applyPreset to read without becoming a new function on every
  // change — it must stay referentially stable or useSongPersistence re-hydrates.
  const cityIdRef        = useRef(cityId)
  const limitsRef        = useRef(limits)
  const startedRef       = useRef(false)
  const resetSessionRef  = useRef(null)
  const masterVolumeRef  = useRef(0)
  const citySwitchAwayRef = useRef(null)
  const midiRecorderRef  = useRef(null)
  const pendingEventsRef = useRef([])     // notes buffered between animation frames
  const eventsRafRef     = useRef(null)   // pending rAF flush handle
  const [hasMidiSession, setHasMidiSession] = useState(false)
  const [audioExporting, setAudioExporting] = useState(false)
  const [audioProgress,  setAudioProgress]  = useState(0)

  const [view,    setView]    = useState('daw')   // 'map' | 'daw'
  const [mode,    setMode]    = useState('mock')  // 'mock' | 'live'
  const [started, setStarted] = useState(false)
  const [pendingAiStart, setPendingAiStart] = useState(0)
  // Set when audio was asked to start outside a user gesture and the browser
  // refused (iOS). The transport then offers an explicit tap instead of
  // pretending playback began — see the pendingAiStart effect below.
  const [needsGesture, setNeedsGesture] = useState(false)
  // The output bus has been measurably silent while playing — offer the check.
  const [noOutput, setNoOutput] = useState(false)
  const [soundCheck, setSoundCheck] = useState(null)   // null | 'manual' | 'auto'
  // The AI panel is a floating 340px card on desktop; on a phone it covers the
  // whole view, so it starts closed and is launched from the More sheet.
  const [aiOpen, setAiOpen] = useState(false)
  const isPhone = useIsPhone()
  // applyPreset/loadCity must stay referentially stable (the persistence hook
  // keys off them), so the phone flag is read through a ref there — same
  // pattern as cityIdRef/limitsRef.
  const isPhoneRef = useRef(isPhone)
  useEffect(() => { isPhoneRef.current = isPhone }, [isPhone])
  const [events,  setEvents]  = useState([])

  const [volumes, setVolumes] = useState({})
  const [disabledRoutes, setDisabledRoutes] = useState({})
  const [pans,    setPans]    = useState({})

  const [trackSoundModes, setTrackSoundModes] = useState({})
  const [trackScales,     setTrackScales]     = useState({})
  const [trackSynthTypes, setTrackSynthTypes] = useState({})
  const [trackADSRs,      setTrackADSRs]      = useState({})
  const [trackFilters,    setTrackFilters]    = useState({})
  const [trackEqs,        setTrackEqs]        = useState({})

  const [sendMatrix, setSendMatrix] = useState({})

  const [automationCfg, setAutomationCfg] = useState({})

  const automationSourceIds = useMemo(() => {
    const ids = new Set()
    for (const lanes of Object.values(automationCfg))
      for (const lane of Object.values(lanes))
        if (lane?.sourceRouteId) ids.add(lane.sourceRouteId)
    return ids
  }, [automationCfg])

  const [fxBusWet, setFxBusWet] = useState(() =>
    Object.fromEntries(FX_BUSES.map(b => [b.id, b.defaults?.wet ?? 1.0]))
  )
  const [fxBusMuted,  setFxBusMuted]  = useState({})
  const [fxBusSoloed, setFxBusSoloed] = useState({})
  const [fxBusParams, setFxBusParams] = useState({})

  const [routes, setRoutes] = useState(null)
  const [city, setCity] = useState(null)   // city metadata block from lines.json
  // True while a city switch is loading its route data. On a switch MixerTab keeps
  // the previous city's `routes` until the new fetch resolves, so `!routes` alone
  // never signals the wait — this drives the switch preloader overlay.
  const [switching, setSwitching] = useState(false)
  const allRoutesRef = useRef(null)   // full lines.json route list, for re-picking
  // The live lane list, for resetSessionState: it can be invoked from an async
  // caller (newSong awaits a save first), and disabling a closed-over, by then
  // outgoing set of route ids would leave the current lanes with no entry in the
  // disable map at all — i.e. reading as enabled.
  const routesRef = useRef(null)
  useEffect(() => { routesRef.current = routes }, [routes])

  const [soloRoutes, setSoloRoutes] = useState(() => new Set())

  const [bpm, setBpm] = useState(120)

  // Last harmony applied via the global selector (shown when lanes diverge)
  const [globalHarmony, setGlobalHarmony] = useState({ root: 'C', scaleType: 'major' })

  const [activeFxTracks, setActiveFxTracks] = useState(() => DEFAULT_FX_TRACKS)

  const [masterVolume, setMasterVolume] = useState(0)

  const [trackOctaves,    setTrackOctaves]    = useState({})
  // Per-lane chromatic transpose (semitones), set when a lane is duplicated with
  // a transpose. routeId → integer offset.
  const [trackSemitones,  setTrackSemitones]  = useState({})
  const [trackGlides,     setTrackGlides]     = useState({})
  const [trackLegatos,    setTrackLegatos]    = useState({})
  const [trackDroneModes, setTrackDroneModes] = useState({})
  const [trackDroneRoots, setTrackDroneRoots] = useState({})
  const [trackSpeeds,     setTrackSpeeds]     = useState({})
  const [trackLoopRegions, setTrackLoopRegions] = useState({})
  const [trackGridResolutions, setTrackGridResolutions] = useState({})
  const [trackPitchVariety, setTrackPitchVariety] = useState({})
  // Per-stop authored velocities: routeId → { stopId: 0.2..1 } (stop-editor modal).
  const [trackStopVelocities, setTrackStopVelocities] = useState({})
  // Per-stop diatonic pitch offsets: routeId → { stopId: degrees } (stop-editor modal).
  // Applies to every lane (base + duplicate); engine re-pitches via setPitchOffsets.
  const [trackPitchOffsets, setTrackPitchOffsets] = useState({})
  const [trackArps,       setTrackArps]       = useState({})
  const [trackGranulars,  setTrackGranulars]  = useState({})
  const [trackSidechains, setTrackSidechains] = useState({})
  // Per-lane role label: routeId → { text, color } (lib/laneTags.js). Annotation
  // only — no engine involvement; the colour paints the lane box's left border.
  const [trackLabels,     setTrackLabels]     = useState({})

  // Duplicate lanes (chord layers): clones of a base route with a synthetic id.
  // Descriptors: { id, sourceId, name }. Per-stop pitch lives in trackPitchOffsets.
  const [duplicates, setDuplicates] = useState([])

  // Merged lanes: several base lanes folded into one Tone.PolySynth chord lane.
  // Descriptors: { id, sourceIds: [...], name, synthType }. The source lanes are
  // hidden/consumed (see mergedConsumedIds) and their notes stack into the merged
  // lane's polyphonic voice (engine: setMerge + _buildMergedRoutePart).
  const [merges, setMerges] = useState([])

  // Optional drum backing linked to the Drum Machine tab through the app-level
  // pattern channel. null = unlinked. Shape: { patterns, offsets, muted, bpm }.
  const [drumPattern, setDrumPatternState] = useState(null)
  const drumPatternRef = useRef(null)
  const pendingPublishedDrumRef = useRef(null)
  const [drumsMuted,  setDrumsMuted]  = useState(false)   // session-only UI toggle
  const drumClipboard = useDrumClipboard()

  const setLocalDrumPattern = useCallback((next) => {
    drumPatternRef.current = next
    setDrumPatternState(next)
  }, [])

  // Commit a Map-side edit locally and to the shared channel in one direction.
  // A null value only unlinks the Map lane; it leaves the Drum Machine's pattern.
  const setSyncedDrumPattern = useCallback((value) => {
    const previous = drumPatternRef.current
    const next = typeof value === 'function' ? value(previous) : value
    setLocalDrumPattern(next)
    if (next) {
      const cloned = JSON.parse(JSON.stringify(next))
      pendingPublishedDrumRef.current = JSON.stringify(cloned)
      drumClipboard.setPattern(cloned)
    } else {
      pendingPublishedDrumRef.current = null
    }
  }, [drumClipboard.setPattern, setLocalDrumPattern])

  // Base route ids that have been folded into a merged PolySynth lane — hidden
  // from the visible lane list (they play only through the merged lane).
  const mergedConsumedIds = useMemo(() => {
    const s = new Set()
    for (const m of merges) for (const id of m.sourceIds ?? []) s.add(id)
    return s
  }, [merges])

  // Base routes + a reconstructed clone route per duplicate descriptor + a synthetic
  // route per merged lane (carrying its source routes' geometry). This is the list
  // the engine/DAW/MIDI act on; the map deliberately uses the base `routes`.
  // Consumed source lanes stay in the list (so the engine keeps their Parts alive
  // and gates them silent — see engine._mergeConsumed); DawView hides them via
  // mergedConsumedIds so only the merged lane shows.
  const mergedRoutes = useMemo(() => {
    if (!routes) return routes
    if (!duplicates.length && !merges.length) return routes
    const byId = new Map(routes.map(r => [r.id, r]))

    const clonesBySource = {}
    for (const d of duplicates) {
      const src = byId.get(d.sourceId)
      if (!src) continue
      ;(clonesBySource[d.sourceId] ??= []).push(
        { ...src, id: d.id, name: d.name, sourceId: d.sourceId, isDuplicate: true }
      )
    }

    // Anchor each merged lane after its first source; it carries the resolved
    // source routes so the engine can stack their notes into chords.
    const mergesByAnchor = {}
    for (const m of merges) {
      const srcRoutes = (m.sourceIds ?? []).map(id => byId.get(id)).filter(Boolean)
      if (!srcRoutes.length) continue
      const base = srcRoutes[0]
      ;(mergesByAnchor[base.id] ??= []).push({
        ...base, id: m.id, name: m.name, type: base.type,
        isMerged: true, sourceIds: m.sourceIds, sourceRoutes: srcRoutes,
      })
    }

    // Insert each clone/merged lane directly after its source so it appears right
    // beneath the lane it came from (not at the bottom of the section).
    const out = []
    for (const r of routes) {
      out.push(r)
      if (clonesBySource[r.id]) out.push(...clonesBySource[r.id])
      if (mergesByAnchor[r.id]) out.push(...mergesByAnchor[r.id])
    }
    return out
  }, [routes, duplicates, merges])

  const visibleInstrumentRoutes = useMemo(() => (mergedRoutes ?? []).filter(route =>
    !mergedConsumedIds.has(route.id) && !automationSourceIds.has(route.id) && route.id !== DRUMS_ROUTE_ID
  ), [mergedRoutes, mergedConsumedIds, automationSourceIds])

  // Pickable sidechain trigger sources, grouped for the source <select>. Drum
  // entries only appear once a pattern is imported — there is nothing to duck off
  // otherwise. A lane can't be its own trigger; the picker filters that per-lane.
  const sidechainSources = useMemo(() => {
    const out = []
    if (drumPattern) {
      out.push({ value: SIDECHAIN_ANY_DRUM, label: 'Any pad', group: 'Drums' })
      for (const pad of SIDECHAIN_PAD_SOURCES) out.push({ ...pad, group: 'Drums' })
    }
    for (const route of visibleInstrumentRoutes) {
      out.push({ value: route.id, label: route.name, group: 'Lanes' })
    }
    return out
  }, [drumPattern, visibleInstrumentRoutes])

  // Downgrades and imported/shared Pro songs keep every setting but excess lanes
  // are deterministically disabled in their saved/visible order.
  useEffect(() => {
    const { disabled, lockedIds } = normalizeLaneAccess(visibleInstrumentRoutes, disabledRoutes, limits.activeLanes)
    if (!lockedIds.length) return
    setDisabledRoutes(disabled)
    for (const id of lockedIds) engineRef.current?.setRouteDisabled(id, true)
  }, [visibleInstrumentRoutes, disabledRoutes, limits.activeLanes])

  const [liveSnapshot,    setLiveSnapshot]    = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  // Lanes a loaded song referenced that this city's route data no longer has.
  const [presetWarning, setPresetWarning] = useState(null)
  // Bumped to re-run the city effect after a failed preset load, so the user lands
  // on a normal randomly-picked session instead of an empty screen.
  const [cityNonce, setCityNonce] = useState(0)

  // Load one city's route data and make it the active city's data. Shared by the
  // city effect and applyPreset; fetchLines is promise-cached per URL, so both
  // calling it produces a single network fetch.
  const loadCity = useCallback(async (id) => {
    const entry = getCityEntry(id)
    const { routes: all, city } = await fetchLines(linesUrlFor(entry, { slim: isPhoneRef.current }))
    // Retune the pitch/pan fallbacks to this city before any notes are built.
    if (city?.bounds) setCityBounds(city.bounds)
    setCity(city ?? null)
    allRoutesRef.current = all
    loadedCityRef.current = id
    return all
  }, [])

  // Load the active city's route data. On a city *switch* (not first load), wipe
  // the session first so the engine + all per-track/FX state start clean.
  useEffect(() => {
    // A preset load already owns this switch: it will load the city and install
    // the song's own lanes. Resetting or re-picking here would wipe that.
    if (pendingPresetRef.current?.cityId === cityId) return
    // A manual city switch cancels any preset apply still in flight.
    presetTokenRef.current++
    pendingPresetRef.current = null

    const isSwitch = loadedCityRef.current !== null && loadedCityRef.current !== cityId
    // Preserve then detach the open song before wiping (see onCitySwitchAway):
    // route ids are city-scoped, so the song can't follow us to the new city, and
    // leaving it attached let autosave overwrite it with the wiped session.
    //
    // It is **async** — it awaits the preserving save before calling onReset — so the
    // new city's lanes must not be installed until it has settled. Otherwise the
    // reset lands *after* them and wipes the disable map with one keyed by the
    // outgoing city's ids: every fresh lane reads as enabled (undefined = not
    // disabled) and the map draws all of them at full weight, with stop markers
    // (~780 for NYC) — which is what froze the tab.
    let detached = Promise.resolve()
    if (isSwitch) {
      detached = Promise.resolve(citySwitchAwayRef.current?.()).catch(() => {})
      setSwitching(true)  // show the preloader while the new city's data loads
    }
    // Not just on a switch: a city with no feed can only run mock, and a restored
    // 'live' mode would otherwise leave Play calling startLive against nothing.
    if (!cityEntry.liveWsUrl) setMode('mock')

    let cancelled = false
    // The fetch runs in parallel with the detach; only the *picks* wait for both.
    Promise.all([loadCity(cityId), detached])
      .then(([all]) => {
        // Bail if a preset claimed the session while we were fetching.
        if (cancelled || pendingPresetRef.current) return
        const picked = pickStartupRoutes(all)
        setRoutes(picked)
        setDisabledRoutes(allDisabledMap(picked))
        for (const r of picked) engineRef.current?.setRouteDisabled(r.id, true)
        // Clear on the next frame so the overlay actually paints before the (heavy)
        // route/map render commits, rather than being torn down in the same tick.
        requestAnimationFrame(() => { if (!cancelled) setSwitching(false) })
      })
      .catch(() => { if (!cancelled) { setRoutes([]); setCity(null); setSwitching(false) } })
    return () => { cancelled = true }
  }, [cityId, cityNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-roll the random selection for a single line type (tram/trolley/bus),
  // keeping metro and the other types untouched. No-op while playing — the
  // running mock schedule is baked from `routes` at Start.
  const handleRepickType = useCallback((type) => {
    const all = allRoutesRef.current
    if (!all || started) return
    const fresh = pickType(all, type, STARTUP_PICKS[type] ?? 5)
    setRoutes(prev => [...(prev ?? []).filter(r => r.type !== type), ...fresh])
    setDisabledRoutes(d => ({ ...d, ...allDisabledMap(fresh) }))
    for (const r of fresh) engineRef.current?.setRouteDisabled(r.id, true)
  }, [started])

  // Re-roll the entire selection (capped metro + fresh tram/trolley/bus picks).
  const handleRepickAll = useCallback(() => {
    const all = allRoutesRef.current
    if (!all || started) return
    const fresh = pickStartupRoutes(all)
    setRoutes(fresh)
    setDisabledRoutes(allDisabledMap(fresh))
    for (const r of fresh) engineRef.current?.setRouteDisabled(r.id, true)
  }, [started])

  // ── Deliberate lane selection (LinePicker) ────────────────────────────────
  // Add a specific transit line as a new *active* lane. Stop-only, like re-pick.
  // Free is capped at limits.activeLanes audible lanes → the 5th add opens the
  // upgrade modal; Pro is unlimited.
  const handleAddLine = useCallback((route) => {
    if (!route || started) return
    if ((routes ?? []).some(r => r.id === route.id)) return   // already in the mix
    if (limits.activeLanes != null &&
        countActiveLanes(visibleInstrumentRoutes, disabledRoutes) >= limits.activeLanes) {
      openUpgrade('lane_limit')
      return
    }
    setRoutes(prev => [...(prev ?? []), route])
    setDisabledRoutes(m => ({ ...m, [route.id]: false }))   // added ACTIVE
    engineRef.current?.setRouteDisabled(route.id, false)
  }, [routes, started, limits.activeLanes, visibleInstrumentRoutes, disabledRoutes, openUpgrade])

  // Swap the transit line backing an existing lane, *keeping the lane's sound*
  // (synth, volume, FX, scale, arp, …). The active-lane count is unchanged, so
  // this is always allowed — the Free-plan escape hatch (stuck at N lanes, but
  // free to choose which lines). Stop-only. Dependents keyed to the old base id
  // (duplicates / merges / automation lanes) are dropped rather than left dangling.
  const handleChangeLine = useCallback((oldId, newRoute) => {
    if (!oldId || !newRoute || started) return
    if (newRoute.id === oldId) return
    if ((routes ?? []).some(r => r.id === newRoute.id)) return   // already present

    // Replace the route object in place (keeps the lane's section/position).
    setRoutes(prev => (prev ?? []).map(r => r.id === oldId ? newRoute : r))

    // Migrate every per-track setting oldId → newRoute.id so the lane keeps its
    // sound; the new line's stops/geography drive the notes at Start.
    const rename = (setter) => setter(m => {
      if (!(oldId in m)) return m
      const next = { ...m, [newRoute.id]: m[oldId] }
      delete next[oldId]
      return next
    })
    rename(setVolumes); rename(setDisabledRoutes); rename(setPans)
    rename(setTrackSoundModes); rename(setTrackScales); rename(setTrackSynthTypes); rename(setTrackADSRs)
    rename(setTrackFilters); rename(setTrackEqs)
    rename(setTrackOctaves); rename(setTrackSemitones); rename(setTrackGlides); rename(setTrackLegatos)
    rename(setTrackDroneModes); rename(setTrackDroneRoots); rename(setTrackSpeeds); rename(setTrackLoopRegions)
    rename(setTrackGridResolutions); rename(setTrackPitchVariety); rename(setTrackArps); rename(setTrackGranulars)
    // The label names the lane's musical role, not the line, so it follows the swap.
    rename(setTrackLabels)
    // Sidechain needs more than a key rename: lanes ducking *off* the old id would
    // be left pointing at a source that no longer fires.
    setTrackSidechains(m => remapSidechainSource(m, oldId, newRoute.id))
    // Per-stop maps reference the old line's stop ids — they don't apply to the
    // new line, so drop them.
    const drop = (setter) => setter(m => {
      if (!(oldId in m)) return m
      const next = { ...m }; delete next[oldId]; return next
    })
    drop(setTrackStopVelocities); drop(setTrackPitchOffsets)
    setSoloRoutes(prev => {
      if (!prev.has(oldId)) return prev
      const next = new Set(prev); next.delete(oldId); next.add(newRoute.id); return next
    })
    setSendMatrix(m => {
      const next = {}
      for (const [k, v] of Object.entries(m)) {
        const [rid, bus] = k.split(':')
        next[rid === oldId ? `${newRoute.id}:${bus}` : k] = v
      }
      return next
    })
    // Dependents keyed to the old base id would otherwise dangle.
    setDuplicates(prev => prev.filter(d => d.sourceId !== oldId))
    setMerges(prev => prev.filter(mg => !(mg.sourceIds ?? []).includes(oldId)))
    setAutomationCfg(prev => {
      if (!(oldId in prev)) return prev
      const next = { ...prev }; delete next[oldId]; return next
    })

    // Engine: drop the old base route's synth/maps, then persist the migrated
    // settings under the new id (mirrors handleDuplicateTrack). Synth type / ADSR /
    // sound mode / scale are re-applied from React state at Start; the rest live in
    // the engine's per-route maps, so push them now for a stopped session.
    const engine = engineRef.current
    if (!engine) return
    engine.removeRoute(oldId)
    engine.setRouteDisabled(newRoute.id, !!disabledRoutes[oldId])
    if (volumes[oldId]      != null) engine.setRouteVolume(newRoute.id, volumes[oldId])
    if (pans[oldId]         != null) engine.setRoutePan(newRoute.id, pans[oldId])
    if (trackScales[oldId])          engine.setScale(newRoute.id, trackScales[oldId])
    if (trackFilters[oldId])         engine.setRouteFilter(newRoute.id, trackFilters[oldId])
    if (trackEqs[oldId])             engine.setRouteEqState(newRoute.id, trackEqs[oldId])
    if (trackOctaves[oldId])         engine.setOctaveShift(newRoute.id, trackOctaves[oldId])
    if (trackSemitones[oldId])       engine.setSemitoneShift(newRoute.id, trackSemitones[oldId])
    if (trackGlides[oldId]  != null) engine.setGlide(newRoute.id, trackGlides[oldId])
    if (trackLegatos[oldId])         engine.setLegato(newRoute.id, true)
    if (trackArps[oldId])            engine.setArpeggiator(newRoute.id, trackArps[oldId])
    if (trackGranulars[oldId])       engine.setGranular(newRoute.id, trackGranulars[oldId])
    // removeRoute above cleared every cfg sourced from oldId, so re-push the
    // remapped set: the moved lane's own cfg plus anyone that ducked off it.
    for (const [rid, cfg] of Object.entries(remapSidechainSource(trackSidechains, oldId, newRoute.id))) {
      engine.setSidechain(rid, cfg)
    }
    if (trackSpeeds[oldId]  != null) engine.setTrackSpeed(newRoute.id, trackSpeeds[oldId])
    if (trackLoopRegions[oldId])     engine.setTrackLoopRegion(newRoute.id, trackLoopRegions[oldId])
    if (trackGridResolutions[oldId]) engine.setGridResolution(newRoute.id, trackGridResolutions[oldId])
    if (trackPitchVariety[oldId])    engine.setPitchVariety(newRoute.id, trackPitchVariety[oldId])
    if (trackDroneModes[oldId])      engine.setDroneMode(newRoute.id, true, trackDroneRoots[oldId] ?? 'C3')
    for (const [key, level] of Object.entries(sendMatrix)) {
      const [rid, bus] = key.split(':')
      if (rid === oldId && level) engine.setSendLevel(newRoute.id, bus, level)
    }
  }, [routes, started, disabledRoutes, volumes, pans, trackScales, trackFilters, trackEqs,
      trackOctaves, trackSemitones, trackGlides, trackLegatos, trackArps, trackGranulars,
      trackSidechains, trackSpeeds, trackLoopRegions, trackGridResolutions, trackPitchVariety,
      trackDroneModes, trackDroneRoots, sendMatrix])

  // Remove a base lane entirely (drop its route + all per-track state). Stop-only.
  const handleRemoveLine = useCallback((routeId) => {
    if (!routeId || started) return
    setRoutes(prev => (prev ?? []).filter(r => r.id !== routeId))
    const drop = (setter) => setter(m => {
      if (!(routeId in m)) return m
      const next = { ...m }; delete next[routeId]; return next
    })
    drop(setVolumes); drop(setDisabledRoutes); drop(setPans)
    drop(setTrackSoundModes); drop(setTrackScales); drop(setTrackSynthTypes); drop(setTrackADSRs)
    drop(setTrackFilters); drop(setTrackEqs)
    drop(setTrackOctaves); drop(setTrackSemitones); drop(setTrackGlides); drop(setTrackLegatos)
    drop(setTrackDroneModes); drop(setTrackDroneRoots); drop(setTrackSpeeds); drop(setTrackLoopRegions)
    drop(setTrackGridResolutions); drop(setTrackPitchVariety); drop(setTrackStopVelocities); drop(setTrackPitchOffsets)
    drop(setTrackArps); drop(setTrackGranulars); drop(setTrackLabels)
    setTrackSidechains(m => dropSidechainSource(m, routeId))
    setSoloRoutes(prev => {
      if (!prev.has(routeId)) return prev
      const next = new Set(prev); next.delete(routeId); return next
    })
    setSendMatrix(m => {
      const next = {}
      for (const [k, v] of Object.entries(m)) if (k.split(':')[0] !== routeId) next[k] = v
      return next
    })
    // Any dependents attached to this base lane go with it.
    setDuplicates(prev => prev.filter(d => d.sourceId !== routeId))
    setMerges(prev => prev.filter(mg => !(mg.sourceIds ?? []).includes(routeId)))
    setAutomationCfg(prev => {
      if (!(routeId in prev)) return prev
      const next = { ...prev }; delete next[routeId]; return next
    })
    engineRef.current?.removeRoute(routeId)
  }, [started])

  // The engine fires onEvent once per note, per track — dozens/sec with several
  // active tracks. Coalesce them into one state update per animation frame so the
  // re-render rate no longer scales with note throughput (was a lag/freeze source).
  const flushEvents = useCallback(() => {
    eventsRafRef.current = null
    const buffered = pendingEventsRef.current
    if (!buffered.length) return
    pendingEventsRef.current = []
    // Newest first (matches the old [ev, ...prev] order); buffer is oldest-first.
    buffered.reverse()
    setEvents(prev => [...buffered, ...prev].slice(0, MAX_EVENTS))
  }, [])

  // Build a fresh engine + MIDI recorder and stash them on the refs. Used both
  // for the initial mount and to get a clean audio graph on "New session".
  const createEngine = useCallback(() => {
    const recorder = new MidiSessionRecorder()
    midiRecorderRef.current = recorder
    setHasMidiSession(false)
    const engine = new TransitEngine((ev) => {
      pendingEventsRef.current.push(ev)
      if (eventsRafRef.current == null) {
        eventsRafRef.current = requestAnimationFrame(flushEvents)
      }
    })
    engine.init()
    engine.setMidiRecorder(recorder)
    // The weq8 curve editor mutates the EQ runtime directly; mirror each change
    // back into React state so autosave/persistence stays in sync.
    engine.setOnRouteEqChange((routeId, spec) => {
      setTrackEqs(e => ({ ...e, [routeId]: spec }))
    })
    engineRef.current = engine
    // Dev-only handle for inspecting the live audio graph from the console.
    if (process.env.NODE_ENV !== 'production') window.__leidEngine = engine
    return engine
  }, [flushEvents])

  useEffect(() => {
    createEngine()
    return () => {
      if (eventsRafRef.current != null) cancelAnimationFrame(eventsRafRef.current)
      eventsRafRef.current = null
      pendingEventsRef.current = []
      engineRef.current?.dispose()
    }
  }, [createEngine])

  // For cities other than Budapest, retune the network hubs to interchanges
  // derived from the loaded routes (Budapest keeps its curated hubs).
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !routes?.length || !city || city.id === 'budapest') return
    const hubs = deriveHubs(allRoutesRef.current ?? routes, 6)
    if (hubs.length) engine.setNetworkHubs(hubs)
  }, [city, routes])

  // Drive tempo live: the whole transport-scheduled arrangement and any
  // tempo-synced FX track the BPM slider immediately, not just on next Start.
  useEffect(() => {
    engineRef.current?.setBpm(bpm)
  }, [bpm])

  // Mirror the imported drum backing into the engine (adds/removes/updates it
  // live if playing; otherwise it's picked up on the next Start). The mute toggle
  // silences every pad without discarding the pattern.
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (drumPattern && drumsMuted) {
      const silenced = { ...drumPattern, muted: Object.fromEntries(Object.keys(drumPattern.patterns ?? {}).map(k => [k, true])) }
      engine.setDrumPattern(silenced)
    } else {
      engine.setDrumPattern(drumPattern)
    }
  }, [drumPattern, drumsMuted])

  const clipboardDrums = drumClipboard.pattern
  const canImportDrums = !!clipboardDrums &&
    JSON.stringify(clipboardDrums) !== JSON.stringify(drumPattern)

  // Once linked, adopt edits from the Drum Machine. This inbound path deliberately
  // updates only local state so it cannot echo or race with outgoing Map edits.
  useEffect(() => {
    if (!clipboardDrums || drumPatternRef.current == null) return
    const incoming = JSON.stringify(clipboardDrums)
    if (pendingPublishedDrumRef.current) {
      // A Map edit updates this component before the Provider's new value reaches
      // it. Ignore the old context render, then clear the guard when our exact
      // published value arrives.
      if (incoming === pendingPublishedDrumRef.current) {
        pendingPublishedDrumRef.current = null
      } else {
        return
      }
    }
    if (incoming === JSON.stringify(drumPatternRef.current)) return
    setLocalDrumPattern(JSON.parse(JSON.stringify(clipboardDrums)))
  }, [clipboardDrums, setLocalDrumPattern])

  const handleImportDrums = useCallback(() => {
    if (!drumClipboard.pattern) return
    // Deep-clone so later edits in the Drum Machine tab don't mutate our copy.
    pendingPublishedDrumRef.current = null
    setLocalDrumPattern(JSON.parse(JSON.stringify(drumClipboard.pattern)))
    setDrumsMuted(false)
  }, [drumClipboard.pattern, setLocalDrumPattern])

  const handleClearDrums = useCallback(() => {
    pendingPublishedDrumRef.current = null
    setLocalDrumPattern(null)
    setDrumsMuted(false)
  }, [setLocalDrumPattern])

  const handleToggleDrumsMute = useCallback(() => setDrumsMuted(m => !m), [])

  // Cycle a step's velocity level by *visible* index (0..15); map through the pad's
  // offset to the 64-slot source buffer, same as DrumMachineTab. Live: the effect
  // re-pushes into the engine's sequencer, which reads the updated buffer on the
  // next 16th.
  const handleToggleDrumStep = useCallback((padId, visibleIdx) => {
    setSyncedDrumPattern(prev => {
      if (!prev) return prev
      const SOURCE_STEPS = 64
      const offset = prev.offsets?.[padId] ?? 0
      const src = (offset + visibleIdx) % SOURCE_STEPS
      const padPat = (prev.patterns?.[padId] ?? new Array(SOURCE_STEPS).fill(0)).slice()
      padPat[src] = cycleStepValue(padPat[src])
      return { ...prev, patterns: { ...prev.patterns, [padId]: padPat } }
    })
  }, [setSyncedDrumPattern])

  const handleToggleDrumPadMute = useCallback((padId) => {
    setSyncedDrumPattern(prev => {
      if (!prev) return prev
      return { ...prev, muted: { ...prev.muted, [padId]: !prev.muted?.[padId] } }
    })
  }, [setSyncedDrumPattern])

  const fetchSnapshot = useCallback(async () => {
    setSnapshotLoading(true)
    try {
      const res  = await fetch('/api/snapshot')
      const data = await res.json()
      setLiveSnapshot(data)
    } catch (e) {
      console.error('snapshot failed', e)
    } finally {
      setSnapshotLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode === 'live') fetchSnapshot()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayPause = async () => {
    const engine = engineRef.current
    if (!engine) return

    if (started) {
      if (stoppingRef.current) return
      stoppingRef.current = true

      const FADE_OUT = 0.35
      Tone.getDestination().volume.rampTo(-80, FADE_OUT)
      setTimeout(() => {
        engine.stopMock()
        Tone.getDestination().volume.value = masterVolume
        setStarted(false)
        setHasMidiSession(midiRecorderRef.current?.hasData() ?? false)
        stoppingRef.current = false
        // Stop holding the OS audio session open (iOS lock-screen controls).
        releaseAudioSession()
      }, FADE_OUT * 1000 + 60)
    } else {
      // engine.start() → unlockAudio(), which must run before any other await
      // in this handler so the user gesture is still spendable on iOS.
      await engine.start()
      setNeedsGesture(false)
      setNoOutput(false)

      // Start silent, fade in after transport starts
      Tone.getDestination().volume.value = -80

      const smMap = {}
      for (const [rid, m] of Object.entries(trackSoundModes)) {
        smMap[rid] = { mode: m, scale: trackScales[rid] ?? { root: 'C', scaleType: 'major' } }
      }

      if (mode === 'mock') {
        engine.startMock(mergedRoutes ?? [], smMap, bpm, trackSynthTypes, trackADSRs)
      } else {
        engine.startLive(mergedRoutes ?? [], smMap, bpm, trackSynthTypes, trackADSRs)
      }
      setStarted(true)
      trackProductEvent('playback_started', {
        city: cityId,
        mode,
        view,
        active_lane_count: Object.values(disabledRoutes).filter(disabled => !disabled).length,
      })

      Tone.getDestination().volume.rampTo(masterVolume, 0.5)
    }
  }

  // AI Apply batches a large set of React updates. Starting from an effect makes
  // the engine read the committed BPM, harmony, instruments, and lane state
  // instead of the pre-Apply values captured by the click handler.
  useEffect(() => {
    if (!pendingAiStart) return undefined
    let cancelled = false
    const start = async () => {
      const engine = engineRef.current
      if (!engine) return
      try {
        await engine.start()
        if (cancelled) return
        // This start comes from an effect, not a click — the gesture that
        // triggered Generate is long gone. On iOS that means Tone.start()
        // resolves without actually resuming, so verify rather than assume:
        // starting the transport into a suspended context looks like playback
        // and sounds like nothing.
        if (engine.getAudioContext?.()?.state !== 'running') {
          setNeedsGesture(true)
          return
        }
        Tone.getDestination().volume.value = -80
        const smMap = {}
        for (const [rid, soundMode] of Object.entries(trackSoundModes)) {
          smMap[rid] = {
            mode: soundMode,
            scale: trackScales[rid] ?? { root: 'C', scaleType: 'major' },
          }
        }
        engine.startMock(mergedRoutes ?? [], smMap, bpm, trackSynthTypes, trackADSRs)
        setStarted(true)
        Tone.getDestination().volume.rampTo(masterVolume, 0.5)
      } catch (error) {
        console.error('AI plan playback failed:', error)
      } finally {
        if (!cancelled) setPendingAiStart(0)
      }
    }
    start()
    return () => { cancelled = true }
  }, [pendingAiStart]) // intentionally keyed to the post-commit start request

  // Let the header menu (and the first-run notice) open the sound check, which
  // lives here because it needs the live mix context to say anything useful.
  useEffect(() => registerSoundCheck(trigger => setSoundCheck(trigger)), [])

  // Retry path for the case above: this IS a gesture, so the unlock can stick.
  const handleGestureStart = useCallback(async () => {
    const ok = await unlockAudio()
    setNeedsGesture(!ok)
    if (ok) setPendingAiStart(value => value + 1)
  }, [])

  // Watch the master bus while playing and surface a hint if it stays silent.
  // Deliberately starts late: handlePlayPause drops the destination to -80 dB
  // and ramps back over 0.5s, so probing immediately reports silence on every
  // single start.
  useEffect(() => {
    if (!started || !active) { setNoOutput(false); return undefined }
    let cancelled = false
    let silentRuns = 0
    let intervalId = 0

    const check = async () => {
      const db = await probeOutputPeak(300)
      if (cancelled) return
      if (db != null && db <= -80) silentRuns += 1
      else { silentRuns = 0; setNoOutput(false) }
      // Two consecutive silent windows — a rest between notes isn't enough.
      if (silentRuns >= 2) setNoOutput(true)
    }

    const startId = setTimeout(() => {
      check()
      intervalId = setInterval(check, 1200)
    }, 1500)

    return () => {
      cancelled = true
      clearTimeout(startId)
      if (intervalId) clearInterval(intervalId)
    }
  }, [started, active])

  // Stop playback when this tab is hidden (the component stays mounted so all
  // settings persist, but we don't want a background tab fighting over the
  // shared global Tone.Transport / destination).
  useEffect(() => {
    if (active || !started) return
    const engine = engineRef.current
    Tone.getDestination().volume.value = masterVolume  // undo any in-progress fade
    engine?.stopMock()
    stoppingRef.current = false
    setStarted(false)
    setHasMidiSession(midiRecorderRef.current?.hasData() ?? false)
  }, [active, started, masterVolume])

  // Ableton-style solo: plain click solos only this lane (muting all others);
  // Cmd/Ctrl+click adds it to the soloed set instead of replacing it. Clicking
  // the sole soloed lane again clears solo entirely.
  const handleSolo = useCallback((routeId, additive) => {
    setSoloRoutes(prev => {
      let next
      if (additive) {
        next = new Set(prev)
        if (next.has(routeId)) next.delete(routeId)
        else next.add(routeId)
      } else {
        next = (prev.size === 1 && prev.has(routeId)) ? new Set() : new Set([routeId])
      }
      for (const id of prev) if (!next.has(id)) engineRef.current?.setSolo(id, false)
      for (const id of next) if (!prev.has(id)) engineRef.current?.setSolo(id, true)
      return next
    })
  }, [])

  const handleVehicleCrossed = useCallback((routeId, routeType, lat, stopId) => {
    const { root = 'C', scaleType = 'major' } = trackScales[routeId] ?? {}
    const octave = trackOctaves[routeId] ?? 0
    const route = routes?.find(r => r.id === routeId)
    const stop = stopId != null && route ? route.stops.find(s => s.id === stopId) : null
    const stopLat = lat ?? stop?.lat
    const stopLng = stop?.lon ?? stop?.lng

    let rawNote
    if (stopLat != null) {
      // Two-axis geographic pitch — same mapping the mock rail uses (engine.js),
      // normalized to this line's own lat/lon range so the melody is dynamic.
      const modeScale = SCALES[scaleType] ?? MODES.dorian
      const rootMidi  = noteToMidi(`${root}3`)
      const bounds    = route?.stops ? routeBounds(route.stops) : null
      rawNote = midiToNote(geoToMidi(stopLat, stopLng, rootMidi, modeScale, 3, bounds))
    } else {
      rawNote = randomFromScale(root, scaleType)
    }
    const note = shiftOctaveNote(rawNote, octave)

    engineRef.current?.triggerLiveNote(routeId, routeType, note)
  }, [trackScales, trackOctaves, routes])

  // Reset any automation lane whose target is no longer valid (synth type change,
  // granular toggled off). 'volume' is always valid.
  const resetInvalidAutomationLanes = useCallback((routeId, validIds) => {
    setAutomationCfg(a => {
      const lanes = a[routeId]
      if (!lanes) return a
      let changed = false
      const nextLanes = {}
      for (const [laneId, cfg] of Object.entries(lanes)) {
        if (cfg?.paramTarget && !validIds.has(cfg.paramTarget)) {
          nextLanes[laneId] = { ...cfg, paramTarget: 'volume' }
          engineRef.current?.updateAutomationLane(routeId, laneId, { paramTarget: 'volume' })
          changed = true
        } else {
          nextLanes[laneId] = cfg
        }
      }
      return changed ? { ...a, [routeId]: nextLanes } : a
    })
  }, [])

  const handleSynthType = useCallback((routeId, routeType, synthType) => {
    setTrackSynthTypes(s => ({ ...s, [routeId]: synthType }))
    const defaults = { ...SYNTH_DEFAULTS[synthType] }
    setTrackADSRs(a => ({ ...a, [routeId]: defaults }))
    engineRef.current?.setSynthType(routeId, routeType, synthType, defaults)

    // e.g. an FM-only param lane after switching to Drums
    const validIds = new Set(availableAutomationTargets(
      synthType, activeFxTracks, !!trackGranulars[routeId]?.enabled
    ).map(t => t.id))
    resetInvalidAutomationLanes(routeId, validIds)
  }, [activeFxTracks, trackGranulars, resetInvalidAutomationLanes])

  const handleADSR = useCallback((routeId, params) => {
    setTrackADSRs(a => {
      const next = { ...a, [routeId]: { ...a[routeId], ...params } }
      engineRef.current?.updateEnvelope(routeId, next[routeId])
      return next
    })
  }, [])

  const handleSamplerPreset = useCallback((routeId, routeType, presetId) => {
    setTrackADSRs(a => {
      const next = { ...a, [routeId]: { ...a[routeId], samplerPreset: presetId } }
      engineRef.current?.setSynthType(routeId, routeType, 'Sampler', next[routeId])
      return next
    })
  }, [])

  const handleDrumVoice = useCallback((routeId, routeType, voiceId) => {
    setTrackADSRs(a => {
      const next = { ...a, [routeId]: { ...a[routeId], drumVoice: voiceId } }
      engineRef.current?.setSynthType(routeId, routeType, 'Drums', next[routeId])
      return next
    })
  }, [])

  const handleSamplerUpload = useCallback(async (routeId, file, note) => {
    if (!file) return
    try {
      const buf = await file.arrayBuffer()
      const audioBuffer = await Tone.getContext().rawContext.decodeAudioData(buf)
      engineRef.current?.setSamplerBuffer(routeId, note, audioBuffer)
    } catch (err) {
      console.error('Sampler sample decode failed:', err)
    }
  }, [])

  const handleGranular = useCallback((routeId, params) => {
    setTrackGranulars(g => {
      const next = { ...g, [routeId]: { ...DEFAULT_GRANULAR, ...g[routeId], ...params } }
      engineRef.current?.setGranular(routeId, next[routeId])
      return next
    })
    // Toggling off invalidates this track's grain.* automation targets
    if (params.enabled === false) {
      const synthType = trackSynthTypes[routeId] ?? 'Synth'
      const validIds = new Set(availableAutomationTargets(synthType, activeFxTracks, false).map(t => t.id))
      resetInvalidAutomationLanes(routeId, validIds)
    }
  }, [trackSynthTypes, activeFxTracks, resetInvalidAutomationLanes])

  const handleFilter = useCallback((routeId, params) => {
    setTrackFilters(f => {
      const next = { ...f, [routeId]: { ...f[routeId], ...params } }
      engineRef.current?.setRouteFilter(routeId, params)
      return next
    })
  }, [])

  // The per-track EQ is now the weq8 curve editor bound directly to the engine's
  // WEQ8Runtime; get-or-create it lazily so the editor works even while stopped.
  const getEqRuntime = useCallback((routeId) => engineRef.current?.getRouteEqRuntime(routeId) ?? null, [])

  const handleSoundMode = (routeId, routeShortName, m) => {
    setTrackSoundModes(s => ({ ...s, [routeId]: m }))
    setTrackScales(s => {
      const scale = s[routeId] ?? { root: 'C', scaleType: 'major' }
      engineRef.current?.setSoundMode(routeShortName, m, scale)
      return s
    })
  }

  const handleScale = (routeId, routeShortName, scale) => {
    setTrackScales(s => ({ ...s, [routeId]: scale }))
    // setScale rebuilds the route's Part, which re-derives the geographic pitch map
    // from the new harmony — no manual pitch map to regenerate.
    engineRef.current?.setScale(routeId, scale)
    setTrackSoundModes(s => {
      engineRef.current?.setSoundMode(routeShortName, s[routeId] ?? 'harmonic', scale)
      return s
    })
  }

  // Apply one harmony to every lane at once.
  const handleGlobalHarmony = (scale) => {
    setGlobalHarmony(scale)
    for (const route of mergedRoutes ?? []) {
      handleScale(route.id, route.name, scale)
    }
  }

  // Do all lanes currently share one harmony? `common` is that shared value
  // when unified; when lanes diverge, `mixed` is true and the global selector
  // falls back to showing the last globally-applied harmony.
  const { harmonyMixed, harmonyCommon } = useMemo(() => {
    const ids = routes?.map(r => r.id) ?? []
    if (ids.length === 0) return { harmonyMixed: false, harmonyCommon: null }
    const first = trackScales[ids[0]] ?? { root: 'C', scaleType: 'major' }
    for (const id of ids) {
      const sc = trackScales[id] ?? { root: 'C', scaleType: 'major' }
      if (sc.root !== first.root || sc.scaleType !== first.scaleType) {
        return { harmonyMixed: true, harmonyCommon: null }
      }
    }
    return { harmonyMixed: false, harmonyCommon: first }
  }, [routes, trackScales])

  const harmonyValue = harmonyMixed ? globalHarmony : (harmonyCommon ?? globalHarmony)

  const handleSendLevel = useCallback((instRouteId, fxBusId, level) => {
    const key = `${instRouteId}:${fxBusId}`
    setSendMatrix(m => ({ ...m, [key]: level }))
    engineRef.current?.setSendLevel(instRouteId, fxBusId, level)
  }, [])

  const handleFxBusWet = useCallback((busId, value) => {
    setFxBusWet(w => ({ ...w, [busId]: value }))
    engineRef.current?.setFxBusWet(busId, value)
  }, [])

  const handleFxBusMute = useCallback((busId) => {
    setFxBusMuted(m => {
      const next = { ...m, [busId]: !m[busId] }
      engineRef.current?.setFxBusMute(busId, !!next[busId])
      return next
    })
  }, [])

  const handleFxBusParam = useCallback((busId, paramId, value) => {
    setFxBusParams(p => ({
      ...p,
      [busId]: { ...(p[busId] ?? {}), [paramId]: value },
    }))
    engineRef.current?.setFxBusParam(busId, paramId, value)
  }, [])

  const handleFxBusCustomIR = useCallback((busId, audioBuffer) => {
    setFxBusParams(p => ({
      ...p,
      [busId]: { ...(p[busId] ?? {}), irType: 'custom' },
    }))
    engineRef.current?.setFxBusCustomIR(busId, audioBuffer)
  }, [])

  const handleFxBusSolo = useCallback((busId) => {
    setFxBusSoloed(s => {
      const next = { ...s, [busId]: !s[busId] }
      engineRef.current?.setFxBusSolo(busId, !!next[busId])
      return next
    })
  }, [])

  const handleMasterVolume = useCallback((db) => {
    setMasterVolume(db)
    Tone.getDestination().volume.value = db
  }, [])

  const handleOctaveShift = useCallback((routeId, shift) => {
    setTrackOctaves(o => ({ ...o, [routeId]: shift }))
    engineRef.current?.setOctaveShift(routeId, shift)
  }, [])

  const handleGlide = useCallback((routeId, seconds) => {
    setTrackGlides(g => ({ ...g, [routeId]: seconds }))
    engineRef.current?.setGlide(routeId, seconds)
  }, [])

  const handleLegato = useCallback((routeId, enabled) => {
    setTrackLegatos(l => ({ ...l, [routeId]: enabled }))
    engineRef.current?.setLegato(routeId, enabled)
  }, [])

  const handleArp = useCallback((routeId, params) => {
    setTrackArps(a => {
      const next = { ...a, [routeId]: { ...DEFAULT_ARP, ...a[routeId], ...params } }
      engineRef.current?.setArpeggiator(routeId, next[routeId])
      return next
    })
  }, [])

  const handleSidechain = useCallback((routeId, params) => {
    setTrackSidechains(s => {
      const next = { ...s, [routeId]: { ...DEFAULT_SIDECHAIN, ...s[routeId], ...params } }
      engineRef.current?.setSidechain(routeId, next[routeId])
      return next
    })
  }, [])

  const handleDroneMode = useCallback((routeId, enabled) => {
    setTrackDroneModes(m => ({ ...m, [routeId]: enabled }))
    setTrackDroneRoots(r => {
      const root = r[routeId] ?? 'C3'
      engineRef.current?.setDroneMode(routeId, enabled, root)
      return r
    })
  }, [])

  const handleDroneRoot = useCallback((routeId, note) => {
    setTrackDroneRoots(r => ({ ...r, [routeId]: note }))
    engineRef.current?.setDroneRoot(routeId, note)
  }, [])

  const handleTrackSpeed = useCallback((routeId, multiplier) => {
    setTrackSpeeds(s => ({ ...s, [routeId]: multiplier }))
    engineRef.current?.setTrackSpeed(routeId, multiplier)
  }, [])

  const handleTrackLoopRegion = useCallback((routeId, region) => {
    setTrackLoopRegions(r => ({ ...r, [routeId]: region }))
    engineRef.current?.setTrackLoopRegion(routeId, region)
  }, [])

  const handleTrackGridResolution = useCallback((routeId, rate) => {
    setTrackGridResolutions(r => ({ ...r, [routeId]: rate }))
    engineRef.current?.setGridResolution(routeId, rate)
  }, [])

  const handlePitchVariety = useCallback((routeId, cfg) => {
    setTrackPitchVariety(p => {
      const next = { ...p, [routeId]: { ...DEFAULT_PITCH_VARIETY, ...p[routeId], ...cfg } }
      engineRef.current?.setPitchVariety(routeId, next[routeId])
      return next
    })
  }, [])

  // Set a lane's role label. `patch` is partial ({ text } / { color } / both),
  // so a preset chip can set name and colour in one call. An entry that ends up
  // blank is deleted rather than stored empty — the lane simply has no label.
  const handleLaneTag = useCallback((routeId, patch) => {
    setTrackLabels(prev => {
      const tag = normalizeLaneTag({ ...prev[routeId], ...patch })
      if (!tag.text && !tag.color) {
        if (!(routeId in prev)) return prev
        const next = { ...prev }; delete next[routeId]; return next
      }
      return { ...prev, [routeId]: tag }
    })
  }, [])

  // ── Duplicate lanes (chord layers) ────────────────────────────────────────
  // Copy a lane into a new clone keyed by a synthetic id, inheriting every
  // per-track setting. Stacking copies (each re-pitched within harmony) builds a
  // chord. The descriptor's sourceId always points at a *base* route so the clone
  // can be reconstructed on load.
  const handleDuplicateTrack = useCallback((sourceId, semitones = 0) => {
    const src = mergedRoutes?.find(r => r.id === sourceId)
    if (!src) return
    if (!disabledRoutes[sourceId] && limits.activeLanes != null && countActiveLanes(visibleInstrumentRoutes, disabledRoutes) >= limits.activeLanes) {
      openUpgrade('lane_limit')
      return
    }
    const realSourceId = src.sourceId ?? src.id
    const baseName = (allRoutesRef.current?.find(r => r.id === realSourceId)?.name) ?? src.name
    const n  = duplicates.filter(d => d.sourceId === realSourceId).length + 2
    // Random suffix so rapid/same-millisecond duplications can't collide on id.
    const id = `${realSourceId}~dup~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const name = `${baseName}·${n}`

    setDuplicates(prev => [...prev, { id, sourceId: realSourceId, name }])

    // Clone every per-track map entry sourceId → id.
    const copy = (setter) => setter(m => (sourceId in m ? { ...m, [id]: m[sourceId] } : m))
    copy(setVolumes); copy(setDisabledRoutes); copy(setPans)
    copy(setTrackSoundModes); copy(setTrackScales); copy(setTrackSynthTypes); copy(setTrackADSRs)
    copy(setTrackFilters); copy(setTrackEqs)
    copy(setTrackOctaves); copy(setTrackGlides); copy(setTrackLegatos)
    copy(setTrackDroneModes); copy(setTrackDroneRoots); copy(setTrackSpeeds); copy(setTrackLoopRegions)
    copy(setTrackGridResolutions); copy(setTrackPitchVariety); copy(setTrackStopVelocities); copy(setTrackPitchOffsets)
    copy(setTrackArps); copy(setTrackGranulars); copy(setTrackSidechains); copy(setTrackLabels)
    setSendMatrix(m => {
      const next = { ...m }
      for (const [key, level] of Object.entries(m)) {
        const [rid, bus] = key.split(':')
        if (rid === sourceId) next[`${id}:${bus}`] = level
      }
      return next
    })

    // Push the copied config into the engine for the new lane. addRoute materializes
    // the synth/Part when playing; the other setters persist into the engine's maps
    // so a later startMock picks them up when stopped.
    const engine = engineRef.current
    if (!engine) return
    const cloneRoute = { ...src, id, name, sourceId: realSourceId, isDuplicate: true }
    const soundMode  = { mode: trackSoundModes[sourceId] ?? 'harmonic', scale: trackScales[sourceId] ?? { root: 'C', scaleType: 'major' } }
    engine.addRoute(cloneRoute, soundMode, trackSynthTypes[sourceId] ?? 'Synth', trackADSRs[sourceId])
    if (volumes[sourceId]   != null) engine.setRouteVolume(id, volumes[sourceId])
    if (disabledRoutes[sourceId])    engine.setRouteDisabled(id, true)
    if (pans[sourceId]      != null) engine.setRoutePan(id, pans[sourceId])
    if (trackScales[sourceId])       engine.setScale(id, trackScales[sourceId])
    if (trackFilters[sourceId])      engine.setRouteFilter(id, trackFilters[sourceId])
    if (trackEqs[sourceId])          engine.setRouteEqState(id, trackEqs[sourceId])
    if (trackOctaves[sourceId])      engine.setOctaveShift(id, trackOctaves[sourceId])
    // Whole-lane chromatic transpose: the modal's value shifts the new copy
    // relative to its source (a plain base source contributes 0).
    const totalSemis = (trackSemitones[sourceId] ?? 0) + (semitones || 0)
    if (totalSemis) {
      setTrackSemitones(m => ({ ...m, [id]: totalSemis }))
      engine.setSemitoneShift(id, totalSemis)
    }
    if (trackGlides[sourceId] != null) engine.setGlide(id, trackGlides[sourceId])
    if (trackLegatos[sourceId])      engine.setLegato(id, true)
    if (trackArps[sourceId])         engine.setArpeggiator(id, trackArps[sourceId])
    if (trackGranulars[sourceId])    engine.setGranular(id, trackGranulars[sourceId])
    if (trackSidechains[sourceId])   engine.setSidechain(id, trackSidechains[sourceId])
    if (trackSpeeds[sourceId] != null) engine.setTrackSpeed(id, trackSpeeds[sourceId])
    if (trackLoopRegions[sourceId])  engine.setTrackLoopRegion(id, trackLoopRegions[sourceId])
    if (trackGridResolutions[sourceId]) engine.setGridResolution(id, trackGridResolutions[sourceId])
    if (trackPitchVariety[sourceId]) engine.setPitchVariety(id, trackPitchVariety[sourceId])
    if (trackStopVelocities[sourceId]) engine.setStopVelocities(id, trackStopVelocities[sourceId])
    if (trackPitchOffsets[sourceId]) engine.setPitchOffsets(id, trackPitchOffsets[sourceId])
    if (trackDroneModes[sourceId])   engine.setDroneMode(id, true, trackDroneRoots[sourceId] ?? 'C3')
    for (const [key, level] of Object.entries(sendMatrix)) {
      const [rid, bus] = key.split(':')
      if (rid === sourceId && level) engine.setSendLevel(id, bus, level)
    }
  }, [mergedRoutes, duplicates, volumes, disabledRoutes, pans, trackSoundModes, trackScales,
      trackSynthTypes, trackADSRs, trackFilters, trackEqs, trackOctaves, trackSemitones, trackGlides,
      trackLegatos, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions,
      trackGridResolutions, trackPitchVariety, trackStopVelocities, trackPitchOffsets, trackArps, trackGranulars, trackSidechains, sendMatrix,
      limits.activeLanes, visibleInstrumentRoutes, openUpgrade])

  const handleRemoveDuplicate = useCallback((dupId) => {
    setDuplicates(prev => prev.filter(d => d.id !== dupId))
    const drop = (setter) => setter(m => {
      if (!(dupId in m)) return m
      const next = { ...m }; delete next[dupId]; return next
    })
    drop(setVolumes); drop(setDisabledRoutes); drop(setPans)
    drop(setTrackSoundModes); drop(setTrackScales); drop(setTrackSynthTypes); drop(setTrackADSRs)
    drop(setTrackFilters); drop(setTrackEqs)
    drop(setTrackOctaves); drop(setTrackSemitones); drop(setTrackGlides); drop(setTrackLegatos)
    drop(setTrackDroneModes); drop(setTrackDroneRoots); drop(setTrackSpeeds); drop(setTrackLoopRegions)
    drop(setTrackGridResolutions); drop(setTrackPitchVariety); drop(setTrackStopVelocities); drop(setTrackPitchOffsets)
    drop(setTrackArps); drop(setTrackGranulars); drop(setTrackLabels)
    setTrackSidechains(m => dropSidechainSource(m, dupId))
    setSoloRoutes(prev => {
      if (!prev.has(dupId)) return prev
      const next = new Set(prev); next.delete(dupId); return next
    })
    setSendMatrix(m => {
      const next = {}
      for (const [k, v] of Object.entries(m)) if (k.split(':')[0] !== dupId) next[k] = v
      return next
    })
    engineRef.current?.removeRoute(dupId)
  }, [])

  // Set one stop's authored velocity (stop-editor modal). Values within a hair of
  // 1 clear the entry — the stop falls back to the variety-derived map.
  const handleStopVelocity = useCallback((routeId, stopId, vel) => {
    setTrackStopVelocities(prev => {
      const map = { ...(prev[routeId] ?? {}) }
      const v = Math.max(0.2, Math.min(1, vel))
      if (Math.abs(v - 1) < 0.01) delete map[stopId]
      else map[stopId] = Math.round(v * 100) / 100
      engineRef.current?.setStopVelocities(routeId, map)
      if (!Object.keys(map).length) {
        const next = { ...prev }; delete next[routeId]; return next
      }
      return { ...prev, [routeId]: map }
    })
  }, [])

  // Re-pitch one stop of any lane by a diatonic degree offset (0 = clear). Same
  // per-route map for base and duplicate lanes; the engine applies it uniformly.
  const handleStopPitch = useCallback((routeId, stopId, degrees) => {
    setTrackPitchOffsets(prev => {
      const map = { ...(prev[routeId] ?? {}) }
      if (degrees) map[stopId] = degrees
      else delete map[stopId]
      engineRef.current?.setPitchOffsets(routeId, map)
      if (!Object.keys(map).length) {
        const next = { ...prev }; delete next[routeId]; return next
      }
      return { ...prev, [routeId]: map }
    })
  }, [])

  // ── Merged lanes (PolySynth chords) ───────────────────────────────────────
  // Fold several base lanes into one polyphonic lane. The sources are hidden and
  // gated silent (engine.setMerge); the merged lane stacks their per-stop notes
  // into chords through a single Tone.PolySynth.
  const handleMergeLanes = useCallback((sourceIds) => {
    // Only plain base lanes can be merged; drop unknown / already-consumed ids.
    const byId = new Map((routes ?? []).map(r => [r.id, r]))
    const already = new Set(merges.flatMap(m => m.sourceIds ?? []))
    const ids = [...new Set(sourceIds)].filter(id => byId.has(id) && !already.has(id))
    if (ids.length < 2) return
    const currentActive = countActiveLanes(visibleInstrumentRoutes, disabledRoutes)
    const activeSources = ids.filter(id => !disabledRoutes[id]).length
    if (limits.activeLanes != null && currentActive - activeSources + 1 > limits.activeLanes) {
      openUpgrade('lane_limit')
      return
    }

    const srcRoutes = ids.map(id => byId.get(id))
    const base  = srcRoutes[0]
    const id    = `merge~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const rawName = srcRoutes.map(r => r.name).join('+')
    const name  = rawName.length > 24 ? `${rawName.slice(0, 23)}…` : rawName
    const scale = trackScales[base.id] ?? globalHarmony ?? { root: 'C', scaleType: 'major' }
    const adsr  = { ...SYNTH_DEFAULTS.PolySynth }

    setMerges(prev => [...prev, { id, sourceIds: ids, name, synthType: 'PolySynth' }])
    setTrackSynthTypes(s => ({ ...s, [id]: 'PolySynth' }))
    setTrackADSRs(a => ({ ...a, [id]: adsr }))
    setTrackScales(s => ({ ...s, [id]: scale }))
    setTrackSoundModes(s => ({ ...s, [id]: 'harmonic' }))
    setVolumes(v => ({ ...v, [id]: 0 }))
    setPans(p => ({ ...p, [id]: 0 }))

    const engine = engineRef.current
    if (!engine) return
    const mergedRoute = { ...base, id, name, type: base.type, isMerged: true, sourceIds: ids, sourceRoutes: srcRoutes }
    engine.setMerge(id, ids)   // gate sources silent first
    engine.addRoute(mergedRoute, { mode: 'harmonic', scale }, 'PolySynth', adsr)
    engine.setScale(id, scale)
  }, [routes, merges, trackScales, globalHarmony, visibleInstrumentRoutes, disabledRoutes, limits.activeLanes, openUpgrade])

  const handleUnmerge = useCallback((mergeId) => {
    const merge = merges.find(item => item.id === mergeId)
    const currentActive = countActiveLanes(visibleInstrumentRoutes, disabledRoutes)
    const mergeActive = disabledRoutes[mergeId] ? 0 : 1
    const restoredActive = (merge?.sourceIds ?? []).filter(id => !disabledRoutes[id]).length
    if (limits.activeLanes != null && currentActive - mergeActive + restoredActive > limits.activeLanes) {
      openUpgrade('lane_limit')
      return
    }
    setMerges(prev => prev.filter(m => m.id !== mergeId))
    const drop = (setter) => setter(m => {
      if (!(mergeId in m)) return m
      const next = { ...m }; delete next[mergeId]; return next
    })
    drop(setVolumes); drop(setDisabledRoutes); drop(setPans)
    drop(setTrackSoundModes); drop(setTrackScales); drop(setTrackSynthTypes); drop(setTrackADSRs)
    drop(setTrackFilters); drop(setTrackEqs)
    drop(setTrackOctaves); drop(setTrackSemitones); drop(setTrackGlides); drop(setTrackLegatos)
    drop(setTrackDroneModes); drop(setTrackDroneRoots); drop(setTrackSpeeds); drop(setTrackLoopRegions)
    drop(setTrackGridResolutions); drop(setTrackPitchVariety); drop(setTrackStopVelocities); drop(setTrackPitchOffsets)
    drop(setTrackArps); drop(setTrackGranulars); drop(setTrackLabels)
    setTrackSidechains(m => dropSidechainSource(m, mergeId))
    setSoloRoutes(prev => {
      if (!prev.has(mergeId)) return prev
      const next = new Set(prev); next.delete(mergeId); return next
    })
    setSendMatrix(m => {
      const next = {}
      for (const [k, v] of Object.entries(m)) if (k.split(':')[0] !== mergeId) next[k] = v
      return next
    })
    const engine = engineRef.current
    if (!engine) return
    engine.setMerge(mergeId, null)   // un-gate the source lanes (their Parts resume)
    engine.removeRoute(mergeId)
  }, [merges, visibleInstrumentRoutes, disabledRoutes, limits.activeLanes, openUpgrade])

  const handleAddFxTrack = useCallback((busId) => {
    setActiveFxTracks(prev => prev.includes(busId) ? prev : [...prev, busId])
  }, [])

  const handleRemoveFxTrack = useCallback((busId) => {
    setActiveFxTracks(prev => prev.filter(id => id !== busId))
    if (mergedRoutes) {
      for (const route of mergedRoutes) {
        const key = `${route.id}:${busId}`
        setSendMatrix(m => ({ ...m, [key]: 0 }))
        engineRef.current?.setSendLevel(route.id, busId, 0)
      }
    }
  }, [mergedRoutes])

  const handleAddAutomationLane = useCallback((routeId) => {
    const laneId = `lane_${Date.now()}`
    const cfg = { sourceRouteId: '', paramTarget: 'volume', points: {}, speed: 1, glide: 0, loopRegion: null }
    setAutomationCfg(a => ({
      ...a,
      [routeId]: { ...(a[routeId] ?? {}), [laneId]: cfg },
    }))
    engineRef.current?.addAutomationLane(routeId, laneId, cfg)
  }, [])

  const handleRemoveAutomationLane = useCallback((routeId, laneId) => {
    setAutomationCfg(a => {
      const lanes = { ...(a[routeId] ?? {}) }
      delete lanes[laneId]
      return { ...a, [routeId]: lanes }
    })
    engineRef.current?.removeAutomationLane(routeId, laneId)
  }, [])

  const handleUpdateAutomationLane = useCallback((routeId, laneId, cfg) => {
    setAutomationCfg(a => ({
      ...a,
      [routeId]: {
        ...(a[routeId] ?? {}),
        [laneId]: { ...(a[routeId]?.[laneId] ?? {}), ...cfg },
      },
    }))
    engineRef.current?.updateAutomationLane(routeId, laneId, cfg)
  }, [])

  const handleVolume = (routeId, val) => {
    const db = Number(val)
    setVolumes(v => ({ ...v, [routeId]: db }))
    engineRef.current?.setRouteVolume(routeId, db)
  }

  const handleDisable = useCallback((routeId) => {
    const next = !disabledRoutes[routeId]
    if (!next && limits.activeLanes != null && countActiveLanes(visibleInstrumentRoutes, disabledRoutes) >= limits.activeLanes) {
      openUpgrade('lane_limit')
      return
    }
    engineRef.current?.setRouteDisabled(routeId, next)
    setDisabledRoutes(m => ({ ...m, [routeId]: next }))
  }, [disabledRoutes, limits.activeLanes, visibleInstrumentRoutes, openUpgrade])

  const handlePan = (routeId, value) => {
    setPans(p => ({ ...p, [routeId]: value }))
    engineRef.current?.setRoutePan(routeId, value)
  }

  // Lanes disabled by the plan's active-lane cap rather than by the user, so
  // the phone strip can badge them PRO instead of looking merely switched off.
  const lockedLaneIdSet = useMemo(
    () => new Set(normalizeLaneAccess(visibleInstrumentRoutes, disabledRoutes, limits.activeLanes).lockedIds),
    [visibleInstrumentRoutes, disabledRoutes, limits.activeLanes],
  )

  // How many lanes can actually be heard right now — the answer the sound check
  // needs, and the reason a fresh session is silent (every lane starts off).
  const activeLaneCount = useMemo(
    () => countActiveLanes(visibleInstrumentRoutes, disabledRoutes),
    [visibleInstrumentRoutes, disabledRoutes],
  )

  // "Enable a lane" from the sound check: turn on the first available one
  // rather than making the user hunt for a track they haven't seen yet.
  const handleEnableFirstLane = useCallback(() => {
    const first = visibleInstrumentRoutes.find(r => disabledRoutes[r.id])
    if (first) handleDisable(first.id)
  }, [visibleInstrumentRoutes, disabledRoutes, handleDisable])

  // Apply a validated AI Composer plan by replaying the same handlers a human
  // would click. Order matters: harmony before per-track scale, scale before
  // pitch strategy (handleScale rewrites the manual pitch map), FX track added
  // before its wet/params/sends are set.
  const applyAIPlan = useCallback(async (plan) => {
    if (!plan?.tracks?.length) throw new Error('The generated plan did not contain any playable tracks.')

    const engine = engineRef.current
    if (started && engine) {
      if (stoppingRef.current) return { appliedCount: 0 }
      stoppingRef.current = true
      Tone.getDestination().volume.rampTo(-80, 0.35)
      await new Promise(resolve => setTimeout(resolve, 410))
      engine.stopMock()
      Tone.getDestination().volume.value = masterVolume
      setStarted(false)
      setHasMidiSession(midiRecorderRef.current?.hasData() ?? false)
      stoppingRef.current = false
    }

    const replacement = buildReplacementLaneState(
      visibleInstrumentRoutes,
      plan.tracks.map(track => track.routeId),
      disabledRoutes,
      limits.activeLanes,
    )
    const activeIds = new Set(replacement.activeIds)

    for (const id of soloRoutes) engineRef.current?.setSolo(id, false)
    setSoloRoutes(new Set())
    setDisabledRoutes(replacement.disabled)
    for (const route of visibleInstrumentRoutes) {
      engineRef.current?.setRouteDisabled(route.id, replacement.disabled[route.id])
    }

    setMode('mock')
    setView('daw')

    if (plan.bpm != null)          setBpm(plan.bpm)
    if (plan.masterVolume != null) handleMasterVolume(plan.masterVolume)
    if (plan.harmony)              handleGlobalHarmony(plan.harmony)

    if (plan.drums) {
      if (!plan.drums.enabled) {
        handleClearDrums()
        engine?.setDrumPattern(null)
      } else {
        const padIds = Object.keys(plan.drums.patterns ?? {})
        const nextDrumPattern = {
          patterns: plan.drums.patterns,
          offsets: Object.fromEntries(padIds.map(id => [id, 0])),
          muted: Object.fromEntries(padIds.map(id => [id, false])),
          bpm: plan.bpm ?? bpm,
        }
        setSyncedDrumPattern(nextDrumPattern)
        // Apply directly as well as through the React mirror effect. AI Apply
        // starts playback from another effect in this same commit; making the
        // engine write synchronous guarantees startMock sees the new backing.
        engine?.setDrumPattern(nextDrumPattern)
        engine?.setRouteDisabled(DRUMS_ROUTE_ID, false)
        setDrumsMuted(false)
        if (plan.drums.volume != null) handleVolume(DRUMS_ROUTE_ID, plan.drums.volume)
        if (plan.drums.filter) handleFilter(DRUMS_ROUTE_ID, plan.drums.filter)
      }
    }

    for (const t of plan.tracks ?? []) {
      if (!activeIds.has(t.routeId)) continue
      const route = routes?.find(r => r.id === t.routeId)
      if (!route) continue

      if (t.synthType)    handleSynthType(t.routeId, route.type, t.synthType)
      if (t.samplerPreset) handleSamplerPreset(t.routeId, route.type, t.samplerPreset)
      if (t.drumVoice)    handleDrumVoice(t.routeId, route.type, t.drumVoice)
      if (t.envelope)     handleADSR(t.routeId, t.envelope)
      if (t.filter)       handleFilter(t.routeId, t.filter)
      if (t.granular)     handleGranular(t.routeId, t.granular)
      if (t.volume != null) handleVolume(t.routeId, t.volume)
      if (t.pan != null)    handlePan(t.routeId, t.pan)
      if (t.octave != null) handleOctaveShift(t.routeId, t.octave)
      if (t.glide != null)  handleGlide(t.routeId, t.glide)
      if (t.legato != null) handleLegato(t.routeId, t.legato)
      if (t.scale)          handleScale(t.routeId, route.name, t.scale)
      if (t.drone) {
        handleDroneMode(t.routeId, !!t.drone.enabled)
        if (t.drone.root) handleDroneRoot(t.routeId, t.drone.root)
      }
      if (t.arp) handleArp(t.routeId, t.arp)
      if (t.speed != null) handleTrackSpeed(t.routeId, t.speed)
      if (t.loopRegion) handleTrackLoopRegion(t.routeId, t.loopRegion)
      if (t.gridResolution) handleTrackGridResolution(t.routeId, t.gridResolution)
      if (t.pitchVariety) handlePitchVariety(t.routeId, t.pitchVariety)
      if (t.label) handleLaneTag(t.routeId, t.label)
      if (t.sidechain) handleSidechain(t.routeId, t.sidechain)
    }

    for (const f of plan.fx ?? []) {
      handleAddFxTrack(f.busId)
      if (f.wet != null) handleFxBusWet(f.busId, f.wet)
      for (const [paramId, value] of Object.entries(f.params ?? {})) {
        handleFxBusParam(f.busId, paramId, value)
      }
      for (const s of f.sends ?? []) {
        handleSendLevel(s.routeId, f.busId, s.level)
      }
    }

    setPendingAiStart(value => value + 1)
    return { appliedCount: replacement.activeIds.length, skippedCount: replacement.skippedIds.length }
  }, [
    routes, started, masterVolume, bpm, visibleInstrumentRoutes, disabledRoutes, limits.activeLanes, soloRoutes,
    handleMasterVolume, handleGlobalHarmony, handleSynthType, handleSamplerPreset, handleDrumVoice, handleGranular,
    handleADSR, handleFilter, handleVolume, handlePan, handleScale, handleOctaveShift, handleGlide, handleLegato, handleArp,
    handleSidechain, handleLaneTag, handleClearDrums, setSyncedDrumPattern,
    handleDroneMode, handleDroneRoot, handleAddFxTrack, handleFxBusWet,
    handleFxBusParam, handleSendLevel, handleTrackSpeed, handleTrackLoopRegion,
    handleTrackGridResolution, handlePitchVariety,
  ])

  const midiExportCtx = useMemo(() => ({
    bpm,
    disabled: disabledRoutes,
    soloRoutes,
    trackScales,
    trackOctaves,
    trackSemitones,
    trackSoundModes,
    trackLegatos,
    trackSpeeds,
    trackLoopRegions,
    trackGridResolutions,
    trackPitchVariety,
    trackStopVelocities,
    trackDroneModes,
    automationSourceIds,
    perStopSteps: trackPitchOffsets,
    recorder: midiRecorderRef.current,
  }), [
    bpm, disabledRoutes, soloRoutes, trackScales, trackOctaves, trackSemitones, trackSoundModes,
    trackLegatos, trackSpeeds, trackLoopRegions, trackGridResolutions, trackPitchVariety, trackStopVelocities, trackDroneModes,
    automationSourceIds, trackPitchOffsets, hasMidiSession,
  ])

  const canExportMix = useMemo(() => {
    if (!mergedRoutes?.length) return false
    const ctx = { ...midiExportCtx, recorder: midiRecorderRef.current }
    if (midiRecorderRef.current?.hasData()) {
      return mergedRoutes.some(r =>
        isRouteExportable(r, r.id, ctx) && midiRecorderRef.current.getRouteEvents(r.id).length,
      )
    }
    return mergedRoutes.some(r =>
      isRouteExportable(r, r.id, ctx) && isRouteAudible(r.id, ctx) && buildLoopMidiEvents(r, ctx).length,
    )
  }, [mergedRoutes, midiExportCtx])

  const handleExportRouteMidi = useCallback(async (routeId) => {
    const route = mergedRoutes?.find(r => r.id === routeId)
    if (!route) return
    if (!(await claim('export', 'export_limit'))) return
    exportRouteMidi(route, { ...midiExportCtx, recorder: midiRecorderRef.current })
  }, [mergedRoutes, midiExportCtx, claim])

  const handleExportMixMidi = useCallback(async () => {
    if (!(await claim('export', 'export_limit'))) return
    exportMixMidi(mergedRoutes ?? [], { ...midiExportCtx, recorder: midiRecorderRef.current })
  }, [mergedRoutes, midiExportCtx, claim])

  // Real-time WAV capture taps the live engine, so it needs playback running.
  const runAudioExport = useCallback(async (fn) => {
    if (!engineRef.current || !started || audioExporting) return
    setAudioExporting(true)
    setAudioProgress(0)
    try {
      await fn(engineRef.current, { ...midiExportCtx, recorder: undefined }, setAudioProgress)
    } finally {
      setAudioExporting(false)
      setAudioProgress(0)
    }
  }, [started, audioExporting, midiExportCtx])

  const handleExportRouteAudio = useCallback(async (routeId) => {
    const route = mergedRoutes?.find(r => r.id === routeId)
    if (!route) return
    if (!(await claim('export', 'export_limit'))) return
    runAudioExport((engine, ctx, onProgress) => exportRouteAudio(engine, route, ctx, { onProgress }))
  }, [mergedRoutes, runAudioExport, claim])

  const handleExportMixAudio = useCallback(async () => {
    if (!(await claim('export', 'export_limit'))) return
    runAudioExport((engine, ctx, onProgress) => exportMixAudio(engine, mergedRoutes ?? [], ctx, { onProgress }))
  }, [mergedRoutes, runAudioExport, claim])

  const songState = useMemo(() => ({
    // Route ids are city-scoped, so the city and the exact lane list are part of
    // the song — without them a load can't reproduce which lines were playing.
    cityId,
    routeIds: (routes ?? []).map(route => route.id),
    bpm, mode, view, masterVolume, globalHarmony,
    volumes, disabledRoutes, pans, soloRoutes,
    trackSoundModes, trackScales, trackSynthTypes, trackADSRs,
    trackFilters, trackEqs,
    trackOctaves, trackSemitones, trackGlides, trackLegatos, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions, trackGridResolutions, trackPitchVariety, trackStopVelocities, trackPitchOffsets, trackArps, trackGranulars, trackSidechains, trackLabels,
    activeFxTracks, fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
    sendMatrix, automationCfg, duplicates, merges, drumPattern, drumsMuted,
    laneManifest: visibleInstrumentRoutes.map(route => ({
      id: route.id,
      sourceId: route.sourceId ?? null,
      kind: route.isDuplicate ? 'duplicate' : route.isMerged ? 'merge' : 'base',
    })),
  }), [
    cityId, routes,
    bpm, mode, view, masterVolume, globalHarmony,
    volumes, disabledRoutes, pans, soloRoutes,
    trackSoundModes, trackScales, trackSynthTypes, trackADSRs,
    trackFilters, trackEqs,
    trackOctaves, trackSemitones, trackGlides, trackLegatos, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions, trackGridResolutions, trackPitchVariety, trackStopVelocities, trackPitchOffsets, trackArps, trackGranulars, trackSidechains, trackLabels,
    activeFxTracks, fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
    sendMatrix, automationCfg, duplicates, merges, drumPattern, drumsMuted, visibleInstrumentRoutes,
  ])

  // Wipe the session to a clean, empty state: stop playback, dispose the audio
  // graph and rebuild it fresh, then reset every per-track/FX setting to default.
  // The set of routes/tracks itself is left in place, unless `routes` is overridden
  // (a preset load passes [] — it's about to install the song's own lanes, and
  // writing disable flags for the outgoing city's ids would be pointless).
  const resetSessionState = useCallback(({ routes: routesOverride } = {}) => {
    const laneRoutes = routesOverride ?? routesRef.current ?? []
    stoppingRef.current = false
    if (eventsRafRef.current != null) cancelAnimationFrame(eventsRafRef.current)
    eventsRafRef.current = null
    pendingEventsRef.current = []
    try { engineRef.current?.dispose() } catch {}
    const engine = createEngine()
    try { Tone.getDestination().volume.value = 0 } catch {}
    setStarted(false)
    setEvents([])

    setVolumes({}); setDisabledRoutes(allDisabledMap(laneRoutes)); setPans({}); setSoloRoutes(new Set())
    for (const r of laneRoutes) engine.setRouteDisabled(r.id, true)
    setTrackSoundModes({}); setTrackScales({}); setTrackSynthTypes({}); setTrackADSRs({})
    setTrackFilters({}); setTrackEqs({})
    setTrackOctaves({}); setTrackSemitones({}); setTrackGlides({}); setTrackLegatos({})
    setTrackDroneModes({}); setTrackDroneRoots({}); setTrackSpeeds({}); setTrackLoopRegions({})
    setTrackGridResolutions({})
    setTrackPitchVariety({})
    setTrackStopVelocities({})
    setTrackPitchOffsets({})
    setTrackArps({})
    setTrackGranulars({})
    setTrackSidechains({})
    setTrackLabels({})
    setActiveFxTracks(DEFAULT_FX_TRACKS)
    setFxBusWet(Object.fromEntries(FX_BUSES.map(b => [b.id, b.defaults?.wet ?? 1.0])))
    setFxBusMuted({}); setFxBusSoloed({}); setFxBusParams({})
    setSendMatrix({}); setAutomationCfg({})
    setDuplicates([]); setMerges([])
    pendingPublishedDrumRef.current = null
    setLocalDrumPattern(null); setDrumsMuted(false)
    setBpm(120); setMasterVolume(0)
    setGlobalHarmony({ root: 'C', scaleType: 'major' })
  }, [createEngine, setLocalDrumPattern])

  const songSetters = useMemo(() => ({
    setBpm, setMode, setView, setMasterVolume, setGlobalHarmony,
    setVolumes, setDisabledRoutes, setPans, setSoloRoutes,
    setTrackSoundModes, setTrackScales, setTrackSynthTypes, setTrackADSRs,
    setTrackFilters, setTrackEqs,
    setTrackOctaves, setTrackSemitones, setTrackGlides, setTrackLegatos, setTrackDroneModes, setTrackDroneRoots, setTrackSpeeds, setTrackLoopRegions, setTrackGridResolutions, setTrackPitchVariety, setTrackStopVelocities, setTrackPitchOffsets, setTrackArps, setTrackGranulars, setTrackSidechains, setTrackLabels,
    setActiveFxTracks, setFxBusWet, setFxBusMuted, setFxBusSoloed, setFxBusParams,
    setSendMatrix, setAutomationCfg, setDuplicates, setMerges,
    setDrumPattern: setSyncedDrumPattern, setDrumsMuted,
  }), [setSyncedDrumPattern])

  // Keep the refs applyPreset reads in sync, so it can stay referentially stable.
  useEffect(() => { cityIdRef.current       = cityId       }, [cityId])
  useEffect(() => { limitsRef.current       = limits       }, [limits])
  useEffect(() => { startedRef.current      = started      }, [started])
  useEffect(() => { masterVolumeRef.current = masterVolume }, [masterVolume])
  useEffect(() => { resetSessionRef.current = resetSessionState }, [resetSessionState])

  /**
   * Apply a saved song: the single entry point for every snapshot (open, autoload,
   * shared link). A song owns its city and its exact lane list, so this switches
   * city if needed, waits for that city's route data, wipes the session, installs
   * the song's own lanes, then replays the snapshot.
   *
   * Must stay referentially stable — useSongPersistence keys `open` and its
   * hydration effect off it, so a churning identity would re-trigger hydration.
   */
  const applyPreset = useCallback(async (song) => {
    const token = ++presetTokenRef.current      // supersede anything already in flight
    const raw = song?.state ?? song
    if (!raw) return null
    const target = raw.cityId ?? song?.cityId ?? cityIdRef.current
    const targetEntry = getCityEntry(target)

    // Stop playback before the engine is disposed underneath it.
    if (startedRef.current) {
      Tone.getDestination().volume.rampTo(-80, 0.1)
      try { engineRef.current?.stopMock() } catch {}
      setStarted(false)
      stoppingRef.current = false
    }

    // Claim the switch synchronously, *before* setCityId — the city effect reads
    // this ref and must see it whether it runs before or after the await below.
    if (targetEntry.id !== cityIdRef.current) {
      pendingPresetRef.current = { token, cityId: targetEntry.id }
      setSwitching(true)
      setCityId(targetEntry.id)
    }

    try {
      const all = await loadCity(targetEntry.id)
      if (presetTokenRef.current !== token) return null   // superseded

      // Full dispose+recreate: nothing else clears the engine's own maps
      // (_routeDisabled, _soloRoutes, _merges, _granulars, automation lanes), so
      // this is the only guarantee this song doesn't inherit the last one's graph.
      resetSessionRef.current?.({ routes: [] })

      const { base, lanes, missingIds } = resolveSnapshotLanes(all, raw)
      setRoutes(base)

      const clamped = { ...raw, mode: clampMode(raw.mode, targetEntry) }
      // Gate lanes against the plan using the *target* city's resolved lanes.
      const normalized = normalizeSnapshotLaneAccess(clamped, lanes, limitsRef.current.activeLanes)
      // engineRef.current is re-read here on purpose: resetSessionState just
      // replaced the instance, and configuring the disposed one would be silent.
      applySnapshot(normalized, songSetters, engineRef.current, base)

      setPresetWarning(missingIds.length ? { name: song?.name ?? null, missingIds } : null)
      if (missingIds.length) {
        console.warn('[preset] lanes missing from this city\'s route data:', missingIds)
      }
      return { base, missingIds }
    } catch (e) {
      console.warn('[preset] load failed', e)
      if (pendingPresetRef.current?.token === token) {
        pendingPresetRef.current = null
        // Fall back to a normal randomly-picked session for this city.
        setCityNonce(n => n + 1)
      }
      return null
    } finally {
      if (pendingPresetRef.current?.token === token) pendingPresetRef.current = null
      requestAnimationFrame(() => { if (presetTokenRef.current === token) setSwitching(false) })
    }
  }, [loadCity, songSetters, setCityId])

  const song = useSongPersistence({
    state: songState,
    applyPreset,
    routes,
    onReset: resetSessionState,
    activeLaneLimit: limits.activeLanes,
  })

  // The city effect needs to preserve+detach the open song before wiping; expose
  // newSong (which saves, resets, then detaches) to it via a ref.
  useEffect(() => { citySwitchAwayRef.current = song.newSong }, [song.newSong])

  // Human-readable names for skipped lanes where the city data still knows the id
  // (a lane can go missing because the id was dropped, or because it's foreign).
  const missingLaneLabels = useMemo(() => {
    const ids = presetWarning?.missingIds ?? []
    if (!ids.length) return ''
    const byId = new Map((allRoutesRef.current ?? []).map(r => [r.id, r]))
    const shown = ids.slice(0, 6).map(id => byId.get(id)?.name ?? id)
    return shown.join(', ') + (ids.length > shown.length ? `, +${ids.length - shown.length} more` : '')
  }, [presetWarning])

  return (
    <div className={`daw ${view === 'map' ? 'daw--map' : ''} ${isPhone ? 'daw--phone' : ''}`}>
      {switching && (
        <div className="city-switch-overlay" role="status" aria-live="polite">
          <div className="city-switch-pulse" />
          <div className="city-switch-label">Loading {cityEntry.name}…</div>
        </div>
      )}
      {presetWarning && (
        <div className="preset-warning" role="status" aria-live="polite">
          <span>
            {presetWarning.missingIds.length}{' '}
            {presetWarning.missingIds.length === 1 ? 'lane' : 'lanes'}
            {presetWarning.name ? ` from “${presetWarning.name}”` : ''} {' '}
            {presetWarning.missingIds.length === 1 ? 'is' : 'are'} not in {cityEntry.name}’s
            current route data and {presetWarning.missingIds.length === 1 ? 'was' : 'were'} skipped:{' '}
            {missingLaneLabels}
          </span>
          <button
            type="button"
            className="preset-warning-close"
            onClick={() => setPresetWarning(null)}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}
      {!isPhone && (
      <header className="daw-header">
        <h2 className="daw-subtitle">Map</h2>
        <p className="daw-sub">{cityEntry.name} public transport → generative music</p>

        <SongMenu {...song} />

        <div className="view-toggle" data-tour="view">
          <button
            className={`mode-btn ${view === 'map' ? 'active' : ''}`}
            onClick={() => setView('map')}
          >Map</button>
          <button
            className={`mode-btn ${view === 'daw' ? 'active' : ''}`}
            onClick={() => setView('daw')}
          >DAW</button>
        </div>

        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'mock' ? 'active' : ''}`}
            onClick={() => { if (started) { engineRef.current?.stopMock(); setStarted(false) }; setMode('mock') }}
          >Mock</button>
          {cityEntry.liveWsUrl && (
            <button
              className={`mode-btn ${mode === 'live' ? 'active' : ''}`}
              onClick={() => { if (started) { engineRef.current?.stopMock(); setStarted(false) }; setMode('live') }}
            >{cityEntry.name} Live</button>
          )}
        </div>

        <div className="harmony-control">
          <label>Harmony</label>
          <select
            className="scale-root-select"
            value={harmonyValue.root}
            onChange={e => handleGlobalHarmony({ ...harmonyValue, root: e.target.value })}
          >
            {NOTE_ROOTS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            className="scale-type-select"
            value={harmonyValue.scaleType}
            onChange={e => handleGlobalHarmony({ ...harmonyValue, scaleType: e.target.value })}
          >
            {SCALE_TYPES.map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          {harmonyMixed && (
            <span
              className="harmony-mixed-indicator"
              title="Lanes are not all in the same harmony — pick a value to re-sync them all"
            >● Mixed</span>
          )}
        </div>

        <button
          type="button"
          className="repick-btn"
          onClick={handleRepickAll}
          disabled={started || !routes}
          title="Randomly re-select all tram, trolley and bus lines"
        >↻ Re-pick all</button>

        <button
          type="button"
          className={`midi-export-btn midi-export-btn--global${hasMidiSession ? ' has-session' : ''}`}
          onClick={handleExportMixMidi}
          disabled={!canExportMix}
          title="Download multi-track MIDI (session if recorded, else 4-bar loop of audible lines)"
        >↓ MIDI</button>

        <button
          type="button"
          className="midi-export-btn midi-export-btn--global"
          onClick={handleExportMixAudio}
          disabled={!started || audioExporting}
          title="Record the live mix to a WAV file (real-time capture — play first)"
        >{audioExporting ? `↓ WAV ${Math.round(audioProgress * 100)}%` : '↓ WAV'}</button>

        <div className="bpm-control">
          <label>BPM</label>
          <input
            type="number" min="40" max="240"
            value={bpm}
            onChange={e => setBpm(Number(e.target.value))}
            disabled={started}
          />
        </div>

        {canImportDrums ? (
          <button
            type="button"
            className="drums-import-btn"
            onClick={handleImportDrums}
            title="Add the pattern sent from the Drum Machine tab"
          >♪ {drumPattern ? 'Update drums' : 'Add drums'}</button>
        ) : null}

        <button
          className={`transport-btn ${started ? 'stop' : 'play'}`}
          data-tour="transport"
          onClick={handlePlayPause}
        >
          {started ? '⏹ Stop' : '▶ Play'}
        </button>

        {needsGesture && (
          <button className="audio-gesture-btn" onClick={handleGestureStart}>
            ▶ Tap to start audio
          </button>
        )}

        {noOutput && !needsGesture && (
          <button
            className="audio-nooutput-chip"
            onClick={() => setSoundCheck('auto')}
            title="Playing, but nothing is reaching the output"
          >
            No output?
          </button>
        )}
      </header>
      )}

      <MapView
        className={view !== 'map' ? 'view-hidden' : ''}
        active={view === 'map'}
        routes={routes}
        city={city}
        started={started}
        mode={mode}
        disabled={disabledRoutes}
        soloRoutes={soloRoutes}
        trackLabels={trackLabels}
        liveSnapshot={liveSnapshot}
      />
      <AIComposerPanel
        className={view !== 'map' && view !== 'daw' ? 'view-hidden' : ''}
        routes={routes}
        cityId={cityId}
        cityName={cityEntry.name}
        onApply={applyAIPlan}
        {...(isPhone ? { open: aiOpen, onOpenChange: setAiOpen } : {})}
      />
      {!isPhone && (
      <DawView
        className={view !== 'daw' ? 'view-hidden' : ''}
        mode={mode}
        started={started}
        events={events}
        routes={mergedRoutes}
        allRoutes={allRoutesRef.current}
        onRepickType={handleRepickType}
        onAddLine={handleAddLine}
        onChangeLine={handleChangeLine}
        onRemoveLine={handleRemoveLine}
        onDuplicateTrack={handleDuplicateTrack}
        onRemoveDuplicate={handleRemoveDuplicate}
        onStopPitch={handleStopPitch}
        perStopStepsById={trackPitchOffsets}
        onMergeLanes={handleMergeLanes}
        onUnmerge={handleUnmerge}
        mergedConsumedIds={mergedConsumedIds}
        volumes={volumes}
        disabled={disabledRoutes}
        pans={pans}
        soloRoutes={soloRoutes}
        bpm={bpm}
        drumPattern={drumPattern}
        drumsMuted={drumsMuted}
        onToggleDrumStep={handleToggleDrumStep}
        onToggleDrumPadMute={handleToggleDrumPadMute}
        onToggleDrumsMute={handleToggleDrumsMute}
        onClearDrums={handleClearDrums}
        drumVolume={volumes[DRUMS_ROUTE_ID] ?? 0}
        drumFilter={trackFilters[DRUMS_ROUTE_ID]}
        onDrumVolume={v => handleVolume(DRUMS_ROUTE_ID, v)}
        onDrumFilter={p => handleFilter(DRUMS_ROUTE_ID, p)}
        onDrumSendLevel={(bus, lvl) => handleSendLevel(DRUMS_ROUTE_ID, bus, lvl)}
        getDrumEqRuntime={() => getEqRuntime(DRUMS_ROUTE_ID)}
        liveSnapshot={liveSnapshot}
        snapshotLoading={snapshotLoading}
        trackSoundModes={trackSoundModes}
        trackScales={trackScales}
        trackSynthTypes={trackSynthTypes}
        trackADSRs={trackADSRs}
        trackFilters={trackFilters}
        getEqRuntime={getEqRuntime}
        sendMatrix={sendMatrix}
        automationCfg={automationCfg}
        automationSourceIds={automationSourceIds}
        fxBusWet={fxBusWet}
        activeFxTracks={activeFxTracks}
        masterVolume={masterVolume}
        trackOctaves={trackOctaves}
        trackSemitones={trackSemitones}
        trackGlides={trackGlides}
        onGlide={handleGlide}
        trackLegatos={trackLegatos}
        onLegato={handleLegato}
        trackArps={trackArps}
        onArp={handleArp}
        trackGranulars={trackGranulars}
        onGranular={handleGranular}
        trackSidechains={trackSidechains}
        onSidechain={handleSidechain}
        sidechainSources={sidechainSources}
        trackSpeeds={trackSpeeds}
        onTrackSpeed={handleTrackSpeed}
        trackLoopRegions={trackLoopRegions}
        onTrackLoopRegion={handleTrackLoopRegion}
        trackGridResolutions={trackGridResolutions}
        onGridResolution={handleTrackGridResolution}
        trackPitchVariety={trackPitchVariety}
        onPitchVariety={handlePitchVariety}
        trackStopVelocities={trackStopVelocities}
        onStopVelocity={handleStopVelocity}
        trackLabels={trackLabels}
        onLaneTag={handleLaneTag}
        trackDroneModes={trackDroneModes}
        trackDroneRoots={trackDroneRoots}
        onDroneMode={handleDroneMode}
        onDroneRoot={handleDroneRoot}
        onVolume={handleVolume}
        onDisable={handleDisable}
        onPan={handlePan}
        onSolo={handleSolo}
        onSoundMode={handleSoundMode}
        onScale={handleScale}
        onSynthType={handleSynthType}
        onADSR={handleADSR}
        onSamplerPreset={handleSamplerPreset}
        onDrumVoice={handleDrumVoice}
        onSamplerUpload={handleSamplerUpload}
        onFilter={handleFilter}
        onSendLevel={handleSendLevel}
        onFxBusWet={handleFxBusWet}
        fxBusMuted={fxBusMuted}
        fxBusSoloed={fxBusSoloed}
        onFxBusMute={handleFxBusMute}
        onFxBusSolo={handleFxBusSolo}
        fxBusParams={fxBusParams}
        onFxBusParam={handleFxBusParam}
        onFxBusCustomIR={handleFxBusCustomIR}
        onAddFxTrack={handleAddFxTrack}
        onRemoveFxTrack={handleRemoveFxTrack}
        onMasterVolume={handleMasterVolume}
        onOctaveShift={handleOctaveShift}
        onAddAutomationLane={handleAddAutomationLane}
        onRemoveAutomationLane={handleRemoveAutomationLane}
        onUpdateAutomationLane={handleUpdateAutomationLane}
        onRefetch={fetchSnapshot}
        onVehicleCrossed={handleVehicleCrossed}
        onExportRouteMidi={handleExportRouteMidi}
        onExportRouteAudio={handleExportRouteAudio}
        audioExportActive={started && !audioExporting}
      />
      )}

      {isPhone && (
        <MobileDaw
          controls={{
            cityName: cityEntry.name,
            view, onView: setView,
            started, onPlayPause: handlePlayPause,
            bpm, onBpm: setBpm,
            mode, onMode: setMode, liveAvailable: !!cityEntry.liveWsUrl,
            harmony: harmonyCommon ?? globalHarmony,
            onHarmony: handleGlobalHarmony,
            harmonyMixed,
            onRepick: handleRepickAll,
            onExportMidi: handleExportMixMidi,
            onExportWav: handleExportMixAudio,
            canExport: canExportMix,
            audioExporting,
            canImportDrums, hasDrums: !!drumPattern, onImportDrums: handleImportDrums,
            onOpenAi: () => setAiOpen(true),
            onSoundCheck: () => setSoundCheck('manual'),
            needsGesture, onGestureStart: handleGestureStart,
            noOutput,
            song,
          }}
          lanes={{
            routes: visibleInstrumentRoutes,
            mergedConsumedIds,
            disabled: disabledRoutes,
            soloRoutes,
            volumes, pans,
            lockedIds: lockedLaneIdSet,
            labels: trackLabels,
            synthTypes: trackSynthTypes,
            scales: trackScales,
            octaves: trackOctaves,
            semitones: trackSemitones,
            pitchVariety: trackPitchVariety,
            pitchOffsets: trackPitchOffsets,
            stopVelocities: trackStopVelocities,
            sidechains: trackSidechains,
            sidechainSources,
            sendMatrix,
            activeFxTracks,
            onDisable: handleDisable,
            onSolo: handleSolo,
            onVolume: handleVolume,
            onPan: handlePan,
            onSynthType: handleSynthType,
            onScale: handleScale,
            onOctaveShift: handleOctaveShift,
            onSendLevel: handleSendLevel,
            onSidechain: handleSidechain,
            onStopPitch: handleStopPitch,
            onStopVelocity: handleStopVelocity,
            onLaneTag: handleLaneTag,
          }}
        />
      )}

      <AudioTroubleshooter
        open={soundCheck != null}
        onClose={() => setSoundCheck(null)}
        started={started}
        masterVolume={masterVolume}
        onMasterVolume={handleMasterVolume}
        activeLaneCount={activeLaneCount}
        onEnableLanes={handleEnableFirstLane}
        trigger={soundCheck ?? 'manual'}
      />
    </div>
  )
}
