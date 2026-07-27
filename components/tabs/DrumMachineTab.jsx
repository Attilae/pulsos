import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Midi } from '@tonejs/midi'
import { useRoutes } from '@/lib/shared/useRoutes.js'
import { useDrumClipboard } from '@/lib/shared/DrumClipboardContext.jsx'
import { useEntitlements } from '@/lib/shared/EntitlementsContext.jsx'
import {
  DrumEngine, PAD_DEFS, STEPS, SOURCE_STEPS,
  emptyPattern, emptyStops, patternFromRoute, cycleStepValue,
} from '@/lib/engines/drumEngine.js'
import { trackProductEvent } from '@/lib/productAnalytics.js'
import './DrumMachineTab.css'

const PAD_MIDI_NOTES = {
  kick:  36,
  snare: 38,
  hat:   42,
  rim:   37,
  ride:  51,
  clap:  39,
}

function cloneSharedPattern(value) {
  const rawBpm = Number(value?.bpm)
  return {
    patterns: Object.fromEntries(PAD_DEFS.map(p => [
      p.id,
      Array.from(
        { length: SOURCE_STEPS },
        (_, i) => value?.patterns?.[p.id]?.[i] ?? 0,
      ),
    ])),
    offsets: Object.fromEntries(PAD_DEFS.map(p => [
      p.id,
      ((Math.round(value?.offsets?.[p.id] ?? 0) % SOURCE_STEPS) + SOURCE_STEPS) % SOURCE_STEPS,
    ])),
    muted: Object.fromEntries(PAD_DEFS.map(p => [p.id, !!value?.muted?.[p.id]])),
    bpm: Math.max(40, Math.min(240, Number.isFinite(rawBpm) ? rawBpm : 96)),
  }
}

function sameSharedPattern(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function DrumMachineTab({ active = true }) {
  const routes    = useRoutes()
  const engineRef = useRef(null)
  const clipboard = useDrumClipboard()
  const { claim } = useEntitlements()

  const [bpm,        setBpm]        = useState(96)
  const [started,    setStarted]    = useState(false)
  const [activeStep, setActiveStep] = useState(-1)
  const [sent,       setSent]       = useState(false)

  const [padRoutes, setPadRoutes] = useState({})                                            // padId → routeId
  const [patterns,  setPatterns]  = useState(() => Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyPattern()])))
  const [stepStops, setStepStops] = useState(() => Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyStops()])))
  const [offsets,   setOffsets]   = useState(() => Object.fromEntries(PAD_DEFS.map(p => [p.id, 0])))
  const [muted,     setMuted]     = useState({})
  const patternsRef = useRef(patterns)
  const offsetsRef  = useRef(offsets)
  const mutedRef    = useRef(muted)
  const bpmRef      = useRef(bpm)

  const sharedSnapshot = useCallback((overrides = {}) => cloneSharedPattern({
    patterns: overrides.patterns ?? patternsRef.current,
    offsets:  overrides.offsets  ?? offsetsRef.current,
    muted:    overrides.muted    ?? mutedRef.current,
    bpm:      overrides.bpm      ?? bpmRef.current,
  }), [])

  // Only publish automatic edits after a pattern has been sent at least once.
  // This keeps a fresh Map session drumless until the user explicitly adds it.
  const publishIfLinked = useCallback((overrides = {}) => {
    if (!clipboard.pattern) return
    clipboard.setPattern(sharedSnapshot(overrides))
  }, [clipboard.pattern, clipboard.setPattern, sharedSnapshot])

  // ── Engine init ─────────────────────────────────────────────────────────
  useEffect(() => {
    const e = new DrumEngine()
    e.init()
    e.setOnStep(setActiveStep)
    engineRef.current = e
    return () => { e.dispose(); engineRef.current = null }
  }, [])

  // ── Auto-bind default routes once routes load ───────────────────────────
  useEffect(() => {
    if (!routes || Object.keys(padRoutes).length > 0) return
    const bind = {}
    const initPatterns = {}
    const initStops    = {}
    for (const pad of PAD_DEFS) {
      const r = routes.find(r => r.name === pad.defaultRouteName)
      if (r) bind[pad.id] = r.id
      const { pattern, stops } = r ? patternFromRoute(r) : { pattern: emptyPattern(), stops: emptyStops() }
      initPatterns[pad.id] = pattern
      initStops[pad.id]    = stops
      engineRef.current?.setStops(pad.id, stops)
    }
    setPadRoutes(bind)
    setStepStops(initStops)

    // localStorage may restore the shared pattern before route data arrives.
    // Keep the route bindings/tooltips, but do not overwrite that linked pattern
    // with freshly generated defaults when the routes finish loading.
    const linked = clipboard.pattern ? cloneSharedPattern(clipboard.pattern) : null
    const nextPatterns = linked?.patterns ?? initPatterns
    patternsRef.current = nextPatterns
    setPatterns(nextPatterns)
    for (const pad of PAD_DEFS) {
      engineRef.current?.setPattern(pad.id, nextPatterns[pad.id])
    }
    if (linked) {
      offsetsRef.current = linked.offsets
      mutedRef.current = linked.muted
      bpmRef.current = linked.bpm
      setOffsets(linked.offsets)
      setMuted(linked.muted)
      setBpm(linked.bpm)
      for (const pad of PAD_DEFS) {
        engineRef.current?.setOffset(pad.id, linked.offsets[pad.id])
        engineRef.current?.setPadMute(pad.id, linked.muted[pad.id])
      }
      engineRef.current?.setBpm(linked.bpm)
    }
  }, [routes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Accept edits made in the Map/DAW tab (and patterns restored by a saved song)
  // without publishing them back again. Directional handlers below own outgoing
  // updates, which avoids two mirroring effects racing and overwriting each other.
  useEffect(() => {
    if (!clipboard.pattern) return
    const next = cloneSharedPattern(clipboard.pattern)
    if (sameSharedPattern(next, sharedSnapshot())) return

    patternsRef.current = next.patterns
    offsetsRef.current = next.offsets
    mutedRef.current = next.muted
    bpmRef.current = next.bpm
    setPatterns(next.patterns)
    setOffsets(next.offsets)
    setMuted(next.muted)
    setBpm(next.bpm)

    const engine = engineRef.current
    for (const pad of PAD_DEFS) {
      engine?.setPattern(pad.id, next.patterns[pad.id])
      engine?.setOffset(pad.id, next.offsets[pad.id])
      engine?.setPadMute(pad.id, next.muted[pad.id])
    }
    engine?.setBpm(next.bpm)
  }, [clipboard.pattern, sharedSnapshot])

  // ── Controls ────────────────────────────────────────────────────────────
  const handlePlayStop = useCallback(async () => {
    const e = engineRef.current
    if (!e) return
    if (started) { e.stop(); setStarted(false) }
    else { await e.start(bpm); setStarted(true) }
  }, [started, bpm])

  // Stop playback when this tab is hidden (component stays mounted; state persists).
  useEffect(() => {
    if (active || !started) return
    engineRef.current?.stop()
    setStarted(false)
  }, [active, started])

  const handleBpm = useCallback((v) => {
    const n = Math.max(40, Math.min(240, Number(v) || 120))
    bpmRef.current = n
    setBpm(n)
    engineRef.current?.setBpm(n)
    publishIfLinked({ bpm: n })
  }, [publishIfLinked])

  const handleToggleStep = useCallback((padId, visibleIdx) => {
    engineRef.current?.toggleStep(padId, visibleIdx)
    const offset = offsetsRef.current[padId] ?? 0
    const srcIdx = (offset + visibleIdx) % SOURCE_STEPS
    const padPattern = patternsRef.current[padId].slice()
    padPattern[srcIdx] = cycleStepValue(padPattern[srcIdx])
    const next = { ...patternsRef.current, [padId]: padPattern }
    patternsRef.current = next
    setPatterns(next)
    publishIfLinked({ patterns: next })
  }, [publishIfLinked])

  const handleMute = useCallback((padId) => {
    const padMuted = !mutedRef.current[padId]
    const next = { ...mutedRef.current, [padId]: padMuted }
    mutedRef.current = next
    setMuted(next)
    engineRef.current?.setPadMute(padId, padMuted)
    publishIfLinked({ muted: next })
  }, [publishIfLinked])

  const handleClear = useCallback((padId) => {
    engineRef.current?.clear(padId)
    const next = { ...patternsRef.current, [padId]: emptyPattern() }
    patternsRef.current = next
    setPatterns(next)
    setStepStops(s => ({ ...s, [padId]: emptyStops() }))
    publishIfLinked({ patterns: next })
  }, [publishIfLinked])

  const handleClearAll = useCallback(() => {
    engineRef.current?.clear()
    const next = Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyPattern()]))
    patternsRef.current = next
    setPatterns(next)
    setStepStops(Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyStops()])))
    publishIfLinked({ patterns: next })
  }, [publishIfLinked])

  const handlePickRoute = useCallback((padId, routeId) => {
    setPadRoutes(r => ({ ...r, [padId]: routeId }))
    const route = routes?.find(r => r.id === routeId)
    const { pattern, stops } = route ? patternFromRoute(route) : { pattern: emptyPattern(), stops: emptyStops() }
    engineRef.current?.setPattern(padId, pattern)
    engineRef.current?.setStops(padId, stops)
    const next = { ...patternsRef.current, [padId]: pattern }
    patternsRef.current = next
    setPatterns(next)
    setStepStops(prev => ({ ...prev, [padId]: stops }))
    publishIfLinked({ patterns: next })
  }, [routes, publishIfLinked])

  const handleRegenerate = useCallback((padId) => {
    const routeId = padRoutes[padId]
    const route = routes?.find(r => r.id === routeId)
    if (!route) return
    const { pattern, stops } = patternFromRoute(route)
    engineRef.current?.setPattern(padId, pattern)
    engineRef.current?.setStops(padId, stops)
    const next = { ...patternsRef.current, [padId]: pattern }
    patternsRef.current = next
    setPatterns(next)
    setStepStops(prev => ({ ...prev, [padId]: stops }))
    publishIfLinked({ patterns: next })
  }, [padRoutes, routes, publishIfLinked])

  const handleOffset = useCallback((padId, value) => {
    const n = ((Math.round(value) % SOURCE_STEPS) + SOURCE_STEPS) % SOURCE_STEPS
    engineRef.current?.setOffset(padId, n)
    const next = { ...offsetsRef.current, [padId]: n }
    offsetsRef.current = next
    setOffsets(next)
    publishIfLinked({ offsets: next })
  }, [publishIfLinked])

  const handleExportMidi = useCallback(async () => {
    if (!(await claim('export', 'export_limit'))) return
    const midi = new Midi()
    midi.header.setTempo(bpm)
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
    const stepSeconds = (60 / bpm) / 4

    for (const pad of PAD_DEFS) {
      const pattern = patterns[pad.id]
      const offset  = offsets[pad.id] ?? 0
      if (!pattern) continue
      // Compute the visible 16 (what plays) and export that.
      const visible = []
      for (let i = 0; i < STEPS; i++) visible.push(pattern[(offset + i) % SOURCE_STEPS])
      if (!visible.some(Boolean)) continue
      const track = midi.addTrack()
      track.name = pad.label
      for (let i = 0; i < STEPS; i++) {
        if (visible[i]) {
          track.addNote({
            midi:     PAD_MIDI_NOTES[pad.id] ?? 60,
            time:     i * stepSeconds,
            duration: stepSeconds,
            velocity: 0.9 * visible[i],  // full step keeps the old flat 0.9
          })
        }
      }
    }

    const blob = new Blob([midi.toArray()], { type: 'audio/midi' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `transit-drum-pattern-${Date.now()}.mid`
    a.click()
    URL.revokeObjectURL(url)
  }, [bpm, patterns, offsets, claim])

  // Push the current pattern into the app-level channel, establishing the link.
  const handleSendToMap = useCallback(() => {
    clipboard.setPattern(sharedSnapshot())
    trackProductEvent('drum_pattern_sent', { bpm: bpmRef.current })
    setSent(true)
    setTimeout(() => setSent(false), 1600)
  }, [clipboard.setPattern, sharedSnapshot])

  // ── Sorted routes for dropdowns ─────────────────────────────────────────
  const sortedRoutes = useMemo(() => {
    if (!routes) return []
    return [...routes].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'metro' ? -1 : 1
      const an = isNaN(+a.name) ? 1000 : +a.name
      const bn = isNaN(+b.name) ? 1000 : +b.name
      return an - bn
    })
  }, [routes])

  if (!routes) return <div className="tab-placeholder">Loading routes…</div>

  return (
    <div className="drum-tab">
      <header className="drum-header">
        <h2 className="drum-title">Drum Machine</h2>

        <div className="drum-bpm">
          <label>BPM</label>
          <input
            type="number" min="40" max="240"
            value={bpm}
            onChange={e => handleBpm(e.target.value)}
            disabled={started}
          />
        </div>

        <button className="drum-btn drum-btn--ghost" onClick={handleClearAll}>Clear</button>
        <button className="drum-btn drum-btn--ghost" onClick={handleExportMidi}>↓ MIDI</button>
        <button
          className={`drum-btn drum-btn--ghost ${sent ? 'is-sent' : ''}`}
          onClick={handleSendToMap}
          title="Send this pattern to the Map/DAW tab"
        >{sent ? '✓ Sent' : 'Send to Map ▶'}</button>

        <button
          className={`drum-btn drum-btn--transport ${started ? 'stop' : 'play'}`}
          onClick={handlePlayStop}
        >
          {started ? '⏹ Stop' : '▶ Play'}
        </button>
      </header>

      <div className="drum-grid">
        {PAD_DEFS.map(pad => {
          const pattern  = patterns[pad.id]  ?? emptyPattern()
          const stops    = stepStops[pad.id] ?? emptyStops()
          const offset   = offsets[pad.id]   ?? 0
          const isMuted  = !!muted[pad.id]
          const routeId  = padRoutes[pad.id] ?? ''
          return (
            <div key={pad.id} className={`drum-row ${isMuted ? 'is-muted' : ''}`}>
              <div className="drum-row-label">
                <span className="drum-pad-name">{pad.label}</span>
                <select
                  className="drum-route-pick"
                  value={routeId}
                  onChange={e => handlePickRoute(pad.id, e.target.value)}
                >
                  <option value="">(none)</option>
                  {sortedRoutes.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.type === 'metro' ? '· metro' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="drum-row-controls">
                <button
                  className={`drum-mini-btn ${isMuted ? 'on' : ''}`}
                  onClick={() => handleMute(pad.id)}
                  title="Mute"
                >M</button>
                <button
                  className="drum-mini-btn"
                  onClick={() => handleRegenerate(pad.id)}
                  title="Regenerate from line"
                  disabled={!routeId}
                >↻</button>
                <button
                  className="drum-mini-btn"
                  onClick={() => handleClear(pad.id)}
                  title="Clear row"
                >⌫</button>
              </div>

              <div className="drum-offset">
                <input
                  type="range"
                  min="0" max={SOURCE_STEPS - 1} step="1"
                  value={offset}
                  onChange={e => handleOffset(pad.id, +e.target.value)}
                  title={`Offset: ${offset} / ${SOURCE_STEPS - 1}`}
                />
                <span className="drum-offset-value">{String(offset).padStart(2, '0')}</span>
              </div>

              <div className="drum-steps">
                {Array.from({ length: STEPS }).map((_, i) => {
                  const srcIdx   = (offset + i) % SOURCE_STEPS
                  const vel      = pattern[srcIdx]
                  const level    = !vel ? '' : vel >= 0.85 ? 'vel-accent' : vel >= 0.55 ? 'vel-norm' : 'vel-soft'
                  const stopList = stops[srcIdx] ?? []
                  const tip      = (stopList.length ? stopList.join(' · ') : `(empty · slot ${srcIdx})`)
                    + (vel ? ` — vel ${Math.round(vel * 100)}%` : '')
                  return (
                    <button
                      key={i}
                      className={[
                        'drum-step',
                        vel ? 'on' : '',
                        level,
                        activeStep === i ? 'playing' : '',
                        i % 4 === 0 ? 'beat' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => handleToggleStep(pad.id, i)}
                      title={tip}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <footer className="drum-footer">
        <div className="drum-hint">
          Patterns derived as a 64-step buffer; the 16-cell grid shows a sliding window.
          Drag the offset slider to shift which slice plays. Click a step to cycle its
          velocity: full → norm → soft → off. Hover any cell to see the stop name.
        </div>
      </footer>
    </div>
  )
}
