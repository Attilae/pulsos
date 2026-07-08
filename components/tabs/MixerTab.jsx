import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { TransitEngine, SYNTH_DEFAULTS, availableAutomationTargets, DEFAULT_ARP, DEFAULT_GRANULAR } from '@/lib/engine.js'
import { FX_BUSES } from '@/lib/fxTrack.js'
import { randomFromScale, shiftOctaveNote, geoToMidi, routeBounds, midiToNote, noteToMidi, SCALES, MODES, setCityBounds } from '@/lib/mappings.js'
import { fetchLines } from '@/lib/shared/useRoutes.js'
import { useCitySelection } from '@/lib/shared/CityContext.jsx'
import { useDrumClipboard } from '@/lib/shared/DrumClipboardContext.jsx'
import DawView, { NOTE_ROOTS, SCALE_TYPES } from '../DawView.jsx'
import MapView from '../MapView.jsx'
import AIComposerPanel from '../AIComposerPanel.jsx'
import SongMenu from '../SongMenu.jsx'
import { useSongPersistence } from '../../lib/useSongPersistence.js'
import {
  MidiSessionRecorder, exportRouteMidi, exportMixMidi,
  isRouteExportable, isRouteAudible, buildLoopMidiEvents,
} from '@/lib/midiExport.js'
import { exportRouteAudio, exportMixAudio } from '@/lib/audioExport.js'

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

export default function MixerTab() {
  const { cityId, cityEntry } = useCitySelection()
  const loadedCityRef    = useRef(null)   // last city whose routes are loaded
  const engineRef        = useRef(null)
  const stoppingRef      = useRef(false)
  const midiRecorderRef  = useRef(null)
  const pendingEventsRef = useRef([])     // notes buffered between animation frames
  const eventsRafRef     = useRef(null)   // pending rAF flush handle
  const [hasMidiSession, setHasMidiSession] = useState(false)
  const [audioExporting, setAudioExporting] = useState(false)
  const [audioProgress,  setAudioProgress]  = useState(0)

  const [view,    setView]    = useState('daw')   // 'map' | 'daw'
  const [mode,    setMode]    = useState('mock')  // 'mock' | 'live'
  const [started, setStarted] = useState(false)
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

  const [soloRoutes, setSoloRoutes] = useState(() => new Set())

  const [bpm, setBpm] = useState(120)

  // Last harmony applied via the global selector (shown when lanes diverge)
  const [globalHarmony, setGlobalHarmony] = useState({ root: 'C', scaleType: 'major' })

  const [activeFxTracks, setActiveFxTracks] = useState(() => DEFAULT_FX_TRACKS)

  const [masterVolume, setMasterVolume] = useState(0)

  const [trackOctaves,    setTrackOctaves]    = useState({})
  const [trackGlides,     setTrackGlides]     = useState({})
  const [trackLegatos,    setTrackLegatos]    = useState({})
  const [trackDroneModes, setTrackDroneModes] = useState({})
  const [trackDroneRoots, setTrackDroneRoots] = useState({})
  const [trackSpeeds,     setTrackSpeeds]     = useState({})
  const [trackLoopRegions, setTrackLoopRegions] = useState({})
  const [trackGridResolutions, setTrackGridResolutions] = useState({})
  const [trackArps,       setTrackArps]       = useState({})
  const [trackGranulars,  setTrackGranulars]  = useState({})

  // Duplicate lanes (chord layers): clones of a base route with a synthetic id and
  // per-stop diatonic pitch offsets. Descriptors: { id, sourceId, name, perStopSteps }.
  const [duplicates, setDuplicates] = useState([])

  // Optional drum backing imported from the Drum Machine tab (via the app-level
  // clipboard). null = none. Shape: { patterns, offsets, muted, bpm }.
  const [drumPattern, setDrumPattern] = useState(null)
  const [drumsMuted,  setDrumsMuted]  = useState(false)   // session-only UI toggle
  const drumClipboard = useDrumClipboard()

  // Base routes + a reconstructed clone route per duplicate descriptor. This is the
  // list the engine/DAW/MIDI act on; the map deliberately uses the base `routes`.
  const mergedRoutes = useMemo(() => {
    if (!routes || !duplicates.length) return routes
    const byId = new Map(routes.map(r => [r.id, r]))
    const clonesBySource = {}
    for (const d of duplicates) {
      const src = byId.get(d.sourceId)
      if (!src) continue
      ;(clonesBySource[d.sourceId] ??= []).push(
        { ...src, id: d.id, name: d.name, sourceId: d.sourceId, isDuplicate: true }
      )
    }
    // Insert each clone directly after its source so a new copy appears right
    // beneath the lane the user duplicated (not at the bottom of the section).
    const out = []
    for (const r of routes) {
      out.push(r)
      if (clonesBySource[r.id]) out.push(...clonesBySource[r.id])
    }
    return out
  }, [routes, duplicates])

  const dupStepsById = useMemo(
    () => Object.fromEntries(duplicates.map(d => [d.id, d.perStopSteps ?? {}])),
    [duplicates],
  )

  const [liveSnapshot,    setLiveSnapshot]    = useState(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  // Load the active city's route data. On a city *switch* (not first load), wipe
  // the session first so the engine + all per-track/FX state start clean.
  useEffect(() => {
    const isSwitch = loadedCityRef.current !== null && loadedCityRef.current !== cityId
    if (isSwitch) {
      resetSessionState()
      if (!cityEntry.liveWsUrl) setMode('mock')  // no feed for this city → mock only
      setSwitching(true)  // show the preloader while the new city's data loads
    }
    let cancelled = false
    fetchLines(cityEntry.linesUrl)
      .then(({ routes: all, city }) => {
        if (cancelled) return
        // Retune the pitch/pan fallbacks to this city before any notes are built.
        if (city?.bounds) setCityBounds(city.bounds)
        setCity(city ?? null)
        allRoutesRef.current = all
        const picked = pickStartupRoutes(all)
        setRoutes(picked)
        setDisabledRoutes(allDisabledMap(picked))
        for (const r of picked) engineRef.current?.setRouteDisabled(r.id, true)
        loadedCityRef.current = cityId
        // Clear on the next frame so the overlay actually paints before the (heavy)
        // route/map render commits, rather than being torn down in the same tick.
        requestAnimationFrame(() => { if (!cancelled) setSwitching(false) })
      })
      .catch(() => { if (!cancelled) { setRoutes([]); setCity(null); setSwitching(false) } })
    return () => { cancelled = true }
  }, [cityId]) // eslint-disable-line react-hooks/exhaustive-deps

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
    engineRef.current = engine
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

  const handleImportDrums = useCallback(() => {
    if (!drumClipboard.pattern) return
    // Deep-clone so later edits in the Drum Machine tab don't mutate our copy.
    setDrumPattern(JSON.parse(JSON.stringify(drumClipboard.pattern)))
    setDrumsMuted(false)
  }, [drumClipboard.pattern])

  const handleClearDrums = useCallback(() => {
    setDrumPattern(null)
    setDrumsMuted(false)
  }, [])

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
      }, FADE_OUT * 1000 + 60)
    } else {
      await engine.start()

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

      Tone.getDestination().volume.rampTo(masterVolume, 0.5)
    }
  }

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

  const handleEq = useCallback((routeId, params) => {
    setTrackEqs(e => {
      const next = { ...e, [routeId]: { ...e[routeId], ...params } }
      engineRef.current?.setRouteEq(routeId, params)
      return next
    })
  }, [])

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

  // ── Duplicate lanes (chord layers) ────────────────────────────────────────
  // Copy a lane into a new clone keyed by a synthetic id, inheriting every
  // per-track setting. Stacking copies (each re-pitched within harmony) builds a
  // chord. The descriptor's sourceId always points at a *base* route so the clone
  // can be reconstructed on load.
  const handleDuplicateTrack = useCallback((sourceId) => {
    const src = mergedRoutes?.find(r => r.id === sourceId)
    if (!src) return
    const realSourceId = src.sourceId ?? src.id
    const baseName = (allRoutesRef.current?.find(r => r.id === realSourceId)?.name) ?? src.name
    const n  = duplicates.filter(d => d.sourceId === realSourceId).length + 2
    // Random suffix so rapid/same-millisecond duplications can't collide on id.
    const id = `${realSourceId}~dup~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const name = `${baseName}·${n}`
    const perStopSteps = { ...(duplicates.find(d => d.id === sourceId)?.perStopSteps ?? {}) }

    setDuplicates(prev => [...prev, { id, sourceId: realSourceId, name, perStopSteps }])

    // Clone every per-track map entry sourceId → id.
    const copy = (setter) => setter(m => (sourceId in m ? { ...m, [id]: m[sourceId] } : m))
    copy(setVolumes); copy(setDisabledRoutes); copy(setPans)
    copy(setTrackSoundModes); copy(setTrackScales); copy(setTrackSynthTypes); copy(setTrackADSRs)
    copy(setTrackFilters); copy(setTrackEqs)
    copy(setTrackOctaves); copy(setTrackGlides); copy(setTrackLegatos)
    copy(setTrackDroneModes); copy(setTrackDroneRoots); copy(setTrackSpeeds); copy(setTrackLoopRegions)
    copy(setTrackGridResolutions)
    copy(setTrackArps); copy(setTrackGranulars)
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
    if (trackEqs[sourceId])          engine.setRouteEq(id, trackEqs[sourceId])
    if (trackOctaves[sourceId])      engine.setOctaveShift(id, trackOctaves[sourceId])
    if (trackGlides[sourceId] != null) engine.setGlide(id, trackGlides[sourceId])
    if (trackLegatos[sourceId])      engine.setLegato(id, true)
    if (trackArps[sourceId])         engine.setArpeggiator(id, trackArps[sourceId])
    if (trackGranulars[sourceId])    engine.setGranular(id, trackGranulars[sourceId])
    if (trackSpeeds[sourceId] != null) engine.setTrackSpeed(id, trackSpeeds[sourceId])
    if (trackLoopRegions[sourceId])  engine.setTrackLoopRegion(id, trackLoopRegions[sourceId])
    if (trackGridResolutions[sourceId]) engine.setGridResolution(id, trackGridResolutions[sourceId])
    if (trackDroneModes[sourceId])   engine.setDroneMode(id, true, trackDroneRoots[sourceId] ?? 'C3')
    for (const [key, level] of Object.entries(sendMatrix)) {
      const [rid, bus] = key.split(':')
      if (rid === sourceId && level) engine.setSendLevel(id, bus, level)
    }
    if (Object.keys(perStopSteps).length) engine.setPitchOffsets(id, perStopSteps)
  }, [mergedRoutes, duplicates, volumes, disabledRoutes, pans, trackSoundModes, trackScales,
      trackSynthTypes, trackADSRs, trackFilters, trackEqs, trackOctaves, trackGlides,
      trackLegatos, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions,
      trackGridResolutions, trackArps, trackGranulars, sendMatrix])

  const handleRemoveDuplicate = useCallback((dupId) => {
    setDuplicates(prev => prev.filter(d => d.id !== dupId))
    const drop = (setter) => setter(m => {
      if (!(dupId in m)) return m
      const next = { ...m }; delete next[dupId]; return next
    })
    drop(setVolumes); drop(setDisabledRoutes); drop(setPans)
    drop(setTrackSoundModes); drop(setTrackScales); drop(setTrackSynthTypes); drop(setTrackADSRs)
    drop(setTrackFilters); drop(setTrackEqs)
    drop(setTrackOctaves); drop(setTrackGlides); drop(setTrackLegatos)
    drop(setTrackDroneModes); drop(setTrackDroneRoots); drop(setTrackSpeeds); drop(setTrackLoopRegions)
    drop(setTrackGridResolutions)
    drop(setTrackArps); drop(setTrackGranulars)
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

  // Re-pitch one stop of a duplicate by a diatonic degree offset (0 = clear).
  const handleStopPitch = useCallback((dupId, stopId, degrees) => {
    setDuplicates(prev => prev.map(d => {
      if (d.id !== dupId) return d
      const perStopSteps = { ...(d.perStopSteps ?? {}) }
      if (degrees) perStopSteps[stopId] = degrees
      else delete perStopSteps[stopId]
      engineRef.current?.setPitchOffsets(dupId, perStopSteps)
      return { ...d, perStopSteps }
    }))
  }, [])

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

  const handleDisable = (routeId) => {
    setDisabledRoutes(m => {
      const next = !m[routeId]
      engineRef.current?.setRouteDisabled(routeId, next)
      return { ...m, [routeId]: next }
    })
  }

  const handlePan = (routeId, value) => {
    setPans(p => ({ ...p, [routeId]: value }))
    engineRef.current?.setRoutePan(routeId, value)
  }

  // Apply a validated AI Composer plan by replaying the same handlers a human
  // would click. Order matters: harmony before per-track scale, scale before
  // pitch strategy (handleScale rewrites the manual pitch map), FX track added
  // before its wet/params/sends are set.
  const applyAIPlan = useCallback((plan) => {
    if (!plan) return

    if (plan.bpm != null)          setBpm(plan.bpm)
    if (plan.masterVolume != null) handleMasterVolume(plan.masterVolume)
    if (plan.harmony)              handleGlobalHarmony(plan.harmony)

    for (const t of plan.tracks ?? []) {
      const route = routes?.find(r => r.id === t.routeId)
      if (!route) continue

      if (t.synthType)    handleSynthType(t.routeId, route.type, t.synthType)
      if (t.samplerPreset) handleSamplerPreset(t.routeId, route.type, t.samplerPreset)
      if (t.drumVoice)    handleDrumVoice(t.routeId, route.type, t.drumVoice)
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
  }, [
    routes, handleMasterVolume, handleSynthType, handleSamplerPreset, handleDrumVoice, handleGranular,
    handleOctaveShift, handleGlide, handleLegato, handleArp,
    handleDroneMode, handleDroneRoot, handleAddFxTrack, handleFxBusWet,
    handleFxBusParam, handleSendLevel,
  ])

  const midiExportCtx = useMemo(() => ({
    bpm,
    disabled: disabledRoutes,
    soloRoutes,
    trackScales,
    trackOctaves,
    trackSoundModes,
    trackLegatos,
    trackSpeeds,
    trackLoopRegions,
    trackGridResolutions,
    trackDroneModes,
    automationSourceIds,
    perStopSteps: dupStepsById,
    recorder: midiRecorderRef.current,
  }), [
    bpm, disabledRoutes, soloRoutes, trackScales, trackOctaves, trackSoundModes,
    trackLegatos, trackSpeeds, trackLoopRegions, trackGridResolutions, trackDroneModes,
    automationSourceIds, dupStepsById, hasMidiSession,
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

  const handleExportRouteMidi = useCallback((routeId) => {
    const route = mergedRoutes?.find(r => r.id === routeId)
    if (!route) return
    exportRouteMidi(route, { ...midiExportCtx, recorder: midiRecorderRef.current })
  }, [mergedRoutes, midiExportCtx])

  const handleExportMixMidi = useCallback(() => {
    exportMixMidi(mergedRoutes ?? [], { ...midiExportCtx, recorder: midiRecorderRef.current })
  }, [mergedRoutes, midiExportCtx])

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

  const handleExportRouteAudio = useCallback((routeId) => {
    const route = mergedRoutes?.find(r => r.id === routeId)
    if (!route) return
    runAudioExport((engine, ctx, onProgress) => exportRouteAudio(engine, route, ctx, { onProgress }))
  }, [mergedRoutes, runAudioExport])

  const handleExportMixAudio = useCallback(() => {
    runAudioExport((engine, ctx, onProgress) => exportMixAudio(engine, mergedRoutes ?? [], ctx, { onProgress }))
  }, [mergedRoutes, runAudioExport])

  const songState = useMemo(() => ({
    bpm, mode, view, masterVolume, globalHarmony,
    volumes, disabledRoutes, pans, soloRoutes,
    trackSoundModes, trackScales, trackSynthTypes, trackADSRs,
    trackFilters, trackEqs,
    trackOctaves, trackGlides, trackLegatos, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions, trackGridResolutions, trackArps, trackGranulars,
    activeFxTracks, fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
    sendMatrix, automationCfg, duplicates, drumPattern,
  }), [
    bpm, mode, view, masterVolume, globalHarmony,
    volumes, disabledRoutes, pans, soloRoutes,
    trackSoundModes, trackScales, trackSynthTypes, trackADSRs,
    trackFilters, trackEqs,
    trackOctaves, trackGlides, trackLegatos, trackDroneModes, trackDroneRoots, trackSpeeds, trackLoopRegions, trackGridResolutions, trackArps, trackGranulars,
    activeFxTracks, fxBusWet, fxBusMuted, fxBusSoloed, fxBusParams,
    sendMatrix, automationCfg, duplicates, drumPattern,
  ])

  // Wipe the session to a clean, empty state: stop playback, dispose the audio
  // graph and rebuild it fresh, then reset every per-track/FX setting to default.
  // The set of routes/tracks itself is left in place.
  const resetSessionState = useCallback(() => {
    stoppingRef.current = false
    if (eventsRafRef.current != null) cancelAnimationFrame(eventsRafRef.current)
    eventsRafRef.current = null
    pendingEventsRef.current = []
    try { engineRef.current?.dispose() } catch {}
    const engine = createEngine()
    try { Tone.getDestination().volume.value = 0 } catch {}
    setStarted(false)
    setEvents([])

    setVolumes({}); setDisabledRoutes(allDisabledMap(routes ?? [])); setPans({}); setSoloRoutes(new Set())
    for (const r of routes ?? []) engine.setRouteDisabled(r.id, true)
    setTrackSoundModes({}); setTrackScales({}); setTrackSynthTypes({}); setTrackADSRs({})
    setTrackFilters({}); setTrackEqs({})
    setTrackOctaves({}); setTrackGlides({}); setTrackLegatos({})
    setTrackDroneModes({}); setTrackDroneRoots({}); setTrackSpeeds({}); setTrackLoopRegions({})
    setTrackGridResolutions({})
    setTrackArps({})
    setTrackGranulars({})
    setActiveFxTracks(DEFAULT_FX_TRACKS)
    setFxBusWet(Object.fromEntries(FX_BUSES.map(b => [b.id, b.defaults?.wet ?? 1.0])))
    setFxBusMuted({}); setFxBusSoloed({}); setFxBusParams({})
    setSendMatrix({}); setAutomationCfg({})
    setDuplicates([])
    setDrumPattern(null); setDrumsMuted(false)
    setBpm(120); setMasterVolume(0)
    setGlobalHarmony({ root: 'C', scaleType: 'major' })
  }, [createEngine, routes])

  const songSetters = useMemo(() => ({
    setBpm, setMode, setView, setMasterVolume, setGlobalHarmony,
    setVolumes, setDisabledRoutes, setPans, setSoloRoutes,
    setTrackSoundModes, setTrackScales, setTrackSynthTypes, setTrackADSRs,
    setTrackFilters, setTrackEqs,
    setTrackOctaves, setTrackGlides, setTrackLegatos, setTrackDroneModes, setTrackDroneRoots, setTrackSpeeds, setTrackLoopRegions, setTrackGridResolutions, setTrackArps, setTrackGranulars,
    setActiveFxTracks, setFxBusWet, setFxBusMuted, setFxBusSoloed, setFxBusParams,
    setSendMatrix, setAutomationCfg, setDuplicates, setDrumPattern,
  }), [])

  const song = useSongPersistence({
    state:   songState,
    setters: songSetters,
    engineRef,
    routes,
    onReset: resetSessionState,
  })

  return (
    <div className={`daw ${view === 'map' ? 'daw--map' : ''}`}>
      {switching && (
        <div className="city-switch-overlay" role="status" aria-live="polite">
          <div className="city-switch-pulse" />
          <div className="city-switch-label">Loading {cityEntry.name}…</div>
        </div>
      )}
      <header className="daw-header">
        <h2 className="daw-subtitle">Map</h2>
        <p className="daw-sub">{cityEntry.name} public transport → generative music</p>

        <SongMenu {...song} />

        <div className="view-toggle">
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

        {drumPattern ? (
          <div className="drums-chip" title="Drum backing from the Drum Machine tab (plays in sync at the DAW BPM)">
            <span className="drums-chip-icon">♪</span>
            <span className="drums-chip-label">Drums</span>
            <button
              type="button"
              className={`drums-chip-btn ${drumsMuted ? 'on' : ''}`}
              onClick={() => setDrumsMuted(m => !m)}
              title={drumsMuted ? 'Unmute drums' : 'Mute drums'}
            >M</button>
            <button
              type="button"
              className="drums-chip-btn"
              onClick={handleClearDrums}
              title="Remove drum backing"
            >×</button>
          </div>
        ) : null}

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
          onClick={handlePlayPause}
        >
          {started ? '⏹ Stop' : '▶ Play'}
        </button>
      </header>

      <MapView
        className={view !== 'map' ? 'view-hidden' : ''}
        active={view === 'map'}
        routes={routes}
        city={city}
        started={started}
        mode={mode}
        disabled={disabledRoutes}
        soloRoutes={soloRoutes}
        liveSnapshot={liveSnapshot}
      />
      <AIComposerPanel
        className={view !== 'map' && view !== 'daw' ? 'view-hidden' : ''}
        routes={routes}
        started={started}
        onApply={applyAIPlan}
      />
      <DawView
        className={view !== 'daw' ? 'view-hidden' : ''}
        mode={mode}
        started={started}
        events={events}
        routes={mergedRoutes}
        onRepickType={handleRepickType}
        onDuplicateTrack={handleDuplicateTrack}
        onRemoveDuplicate={handleRemoveDuplicate}
        onStopPitch={handleStopPitch}
        perStopStepsById={dupStepsById}
        volumes={volumes}
        disabled={disabledRoutes}
        pans={pans}
        soloRoutes={soloRoutes}
        bpm={bpm}
        liveSnapshot={liveSnapshot}
        snapshotLoading={snapshotLoading}
        trackSoundModes={trackSoundModes}
        trackScales={trackScales}
        trackSynthTypes={trackSynthTypes}
        trackADSRs={trackADSRs}
        trackFilters={trackFilters}
        trackEqs={trackEqs}
        sendMatrix={sendMatrix}
        automationCfg={automationCfg}
        automationSourceIds={automationSourceIds}
        fxBusWet={fxBusWet}
        activeFxTracks={activeFxTracks}
        masterVolume={masterVolume}
        trackOctaves={trackOctaves}
        trackGlides={trackGlides}
        onGlide={handleGlide}
        trackLegatos={trackLegatos}
        onLegato={handleLegato}
        trackArps={trackArps}
        onArp={handleArp}
        trackGranulars={trackGranulars}
        onGranular={handleGranular}
        trackSpeeds={trackSpeeds}
        onTrackSpeed={handleTrackSpeed}
        trackLoopRegions={trackLoopRegions}
        onTrackLoopRegion={handleTrackLoopRegion}
        trackGridResolutions={trackGridResolutions}
        onGridResolution={handleTrackGridResolution}
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
        onEq={handleEq}
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
    </div>
  )
}
