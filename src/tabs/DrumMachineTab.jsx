import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Midi } from '@tonejs/midi'
import { useRoutes } from '../shared/useRoutes.js'
import {
  DrumEngine, PAD_DEFS, STEPS, SOURCE_STEPS,
  emptyPattern, emptyStops, patternFromRoute,
} from '../engines/drumEngine.js'
import './DrumMachineTab.css'

const PAD_MIDI_NOTES = {
  kick:  36,
  snare: 38,
  hat:   42,
  rim:   37,
  ride:  51,
  clap:  39,
}

export default function DrumMachineTab() {
  const routes    = useRoutes()
  const engineRef = useRef(null)

  const [bpm,        setBpm]        = useState(96)
  const [started,    setStarted]    = useState(false)
  const [activeStep, setActiveStep] = useState(-1)

  const [padRoutes, setPadRoutes] = useState({})                                            // padId → routeId
  const [patterns,  setPatterns]  = useState(() => Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyPattern()])))
  const [stepStops, setStepStops] = useState(() => Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyStops()])))
  const [offsets,   setOffsets]   = useState(() => Object.fromEntries(PAD_DEFS.map(p => [p.id, 0])))
  const [muted,     setMuted]     = useState({})

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
      engineRef.current?.setPattern(pad.id, pattern)
      engineRef.current?.setStops(pad.id, stops)
    }
    setPadRoutes(bind)
    setPatterns(initPatterns)
    setStepStops(initStops)
  }, [routes]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Controls ────────────────────────────────────────────────────────────
  const handlePlayStop = useCallback(async () => {
    const e = engineRef.current
    if (!e) return
    if (started) { e.stop(); setStarted(false) }
    else { await e.start(bpm); setStarted(true) }
  }, [started, bpm])

  const handleBpm = useCallback((v) => {
    const n = Math.max(40, Math.min(240, Number(v) || 120))
    setBpm(n)
    engineRef.current?.setBpm(n)
  }, [])

  const handleToggleStep = useCallback((padId, visibleIdx) => {
    engineRef.current?.toggleStep(padId, visibleIdx)
    setPatterns(prev => {
      const offset = offsets[padId] ?? 0
      const srcIdx = (offset + visibleIdx) % SOURCE_STEPS
      const next = prev[padId].slice()
      next[srcIdx] = !next[srcIdx]
      return { ...prev, [padId]: next }
    })
  }, [offsets])

  const handleMute = useCallback((padId) => {
    setMuted(m => {
      const next = !m[padId]
      engineRef.current?.setPadMute(padId, next)
      return { ...m, [padId]: next }
    })
  }, [])

  const handleClear = useCallback((padId) => {
    engineRef.current?.clear(padId)
    setPatterns(p => ({ ...p, [padId]: emptyPattern() }))
    setStepStops(s => ({ ...s, [padId]: emptyStops() }))
  }, [])

  const handleClearAll = useCallback(() => {
    engineRef.current?.clear()
    setPatterns(Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyPattern()])))
    setStepStops(Object.fromEntries(PAD_DEFS.map(p => [p.id, emptyStops()])))
  }, [])

  const handlePickRoute = useCallback((padId, routeId) => {
    setPadRoutes(r => ({ ...r, [padId]: routeId }))
    const route = routes?.find(r => r.id === routeId)
    const { pattern, stops } = route ? patternFromRoute(route) : { pattern: emptyPattern(), stops: emptyStops() }
    engineRef.current?.setPattern(padId, pattern)
    engineRef.current?.setStops(padId, stops)
    setPatterns(prev => ({ ...prev, [padId]: pattern }))
    setStepStops(prev => ({ ...prev, [padId]: stops }))
  }, [routes])

  const handleRegenerate = useCallback((padId) => {
    const routeId = padRoutes[padId]
    const route = routes?.find(r => r.id === routeId)
    if (!route) return
    const { pattern, stops } = patternFromRoute(route)
    engineRef.current?.setPattern(padId, pattern)
    engineRef.current?.setStops(padId, stops)
    setPatterns(prev => ({ ...prev, [padId]: pattern }))
    setStepStops(prev => ({ ...prev, [padId]: stops }))
  }, [padRoutes, routes])

  const handleOffset = useCallback((padId, value) => {
    const n = ((Math.round(value) % SOURCE_STEPS) + SOURCE_STEPS) % SOURCE_STEPS
    engineRef.current?.setOffset(padId, n)
    setOffsets(prev => ({ ...prev, [padId]: n }))
  }, [])

  const handleExportMidi = useCallback(() => {
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
            velocity: 0.9,
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
  }, [bpm, patterns, offsets])

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
                  const on       = pattern[srcIdx]
                  const stopList = stops[srcIdx] ?? []
                  const tip      = stopList.length
                    ? stopList.join(' · ')
                    : `(empty · slot ${srcIdx})`
                  return (
                    <button
                      key={i}
                      className={[
                        'drum-step',
                        on ? 'on' : '',
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
          Drag the offset slider to shift which slice plays. Hover any cell to see the stop name.
        </div>
      </footer>
    </div>
  )
}
