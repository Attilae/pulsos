import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Midi } from '@tonejs/midi'
import { useRoutes } from '@/lib/shared/useRoutes.js'
import {
  generateMotif, MotifPreview, midiToName,
  SCALE_ROOTS, SCALE_MODES, LENGTH_OPTIONS, STEPS_PER_BAR,
} from '@/lib/engines/motifEngine.js'
import './MotifTab.css'

const MODE_NAMES = Object.keys(SCALE_MODES)

export default function MotifTab() {
  const routes  = useRoutes()
  const playRef = useRef(null)

  const [routeId,  setRouteId]  = useState('')
  const [root,     setRoot]     = useState('D')
  const [mode,     setMode]     = useState('minor')
  const [bars,     setBars]     = useState(4)
  const [bpm,      setBpm]      = useState(110)
  const [seed,     setSeed]     = useState(0)
  const [motif,    setMotif]    = useState({ notes: [], totalSteps: 64 })
  const [playStep, setPlayStep] = useState(-1)
  const [playing,  setPlaying]  = useState(false)

  // ── Init preview engine ─────────────────────────────────────────────────
  useEffect(() => {
    const p = new MotifPreview()
    p.init()
    playRef.current = p
    return () => { p.dispose(); playRef.current = null }
  }, [])

  // ── Default to M3 once routes load ──────────────────────────────────────
  useEffect(() => {
    if (!routes || routeId) return
    const fallback = routes.find(r => r.type === 'metro' && r.name === 'M3')
                  || routes.find(r => r.type === 'metro')
                  || routes[0]
    if (fallback) setRouteId(fallback.id)
  }, [routes, routeId])

  // ── Auto-regenerate motif on any input change ───────────────────────────
  useEffect(() => {
    if (!routes) return
    const route = routes.find(r => r.id === routeId)
    if (!route) { setMotif({ notes: [], totalSteps: bars * STEPS_PER_BAR }); return }
    setMotif(generateMotif(route, { root, mode, bars, seed }))
  }, [routes, routeId, root, mode, bars, seed])

  // ── Sorted route list ──────────────────────────────────────────────────
  const sortedRoutes = useMemo(() => {
    if (!routes) return []
    return [...routes].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'metro' ? -1 : 1
      const an = isNaN(+a.name) ? 1000 : +a.name
      const bn = isNaN(+b.name) ? 1000 : +b.name
      return an - bn
    })
  }, [routes])

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleReroll = useCallback(() => {
    setSeed(Math.random())
  }, [])

  const handlePreview = useCallback(async () => {
    const p = playRef.current
    if (!p) return
    if (playing) { p.stop(); setPlaying(false); setPlayStep(-1); return }
    setPlaying(true)
    setPlayStep(-1)
    await p.play(motif.notes, bpm, setPlayStep, () => {
      setPlaying(false)
      setPlayStep(-1)
    })
  }, [motif, bpm, playing])

  const handleDownload = useCallback(() => {
    if (!motif.notes.length) return
    const midi = new Midi()
    midi.header.setTempo(bpm)
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
    const stepSeconds = (60 / bpm) / 4
    const track = midi.addTrack()
    track.name = `${routes?.find(r => r.id === routeId)?.name ?? 'motif'} · ${root} ${mode}`
    for (const n of motif.notes) {
      track.addNote({
        midi:     n.midi,
        time:     n.step * stepSeconds,
        duration: n.length * stepSeconds,
        velocity: 0.85,
      })
    }
    const blob = new Blob([midi.toArray()], { type: 'audio/midi' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `motif-${root}${mode}-${bars}bar-${Date.now()}.mid`
    a.click()
    URL.revokeObjectURL(url)
  }, [motif, bpm, routes, routeId, root, mode, bars])

  if (!routes) return <div className="tab-placeholder">Loading routes…</div>

  return (
    <div className="motif-tab">
      <header className="motif-header">
        <h2 className="motif-title">Motif Generator</h2>

        <div className="motif-field">
          <label>Line</label>
          <select value={routeId} onChange={e => setRouteId(e.target.value)}>
            {sortedRoutes.map(r => (
              <option key={r.id} value={r.id}>
                {r.name} {r.type === 'metro' ? '· metro' : r.type === 'tram' ? '· tram' : `· ${r.type}`}
              </option>
            ))}
          </select>
        </div>

        <div className="motif-field">
          <label>Key</label>
          <select value={root} onChange={e => setRoot(e.target.value)}>
            {SCALE_ROOTS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>

        <div className="motif-field">
          <label>Mode</label>
          <select value={mode} onChange={e => setMode(e.target.value)}>
            {MODE_NAMES.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>

        <div className="motif-field">
          <label>Length</label>
          <select value={bars} onChange={e => setBars(+e.target.value)}>
            {LENGTH_OPTIONS.map(b => <option key={b} value={b}>{b} bars</option>)}
          </select>
        </div>

        <div className="motif-field">
          <label>BPM</label>
          <input
            type="number" min="40" max="240"
            value={bpm}
            onChange={e => setBpm(Math.max(40, Math.min(240, +e.target.value || 110)))}
            disabled={playing}
          />
        </div>
      </header>

      <section className="motif-board">
        <MotifRoll motif={motif} playStep={playStep} />

        <div className="motif-meta">
          <span>{motif.notes.length} notes</span>
          <span className="motif-meta-sep">·</span>
          <span>{bars} bars</span>
          <span className="motif-meta-sep">·</span>
          <span>{root} {mode}</span>
        </div>

        <div className="motif-actions">
          <button className="motif-btn motif-btn--secondary" onClick={handleReroll}>
            ⟳ Reroll
          </button>
          <button
            className={`motif-btn motif-btn--primary ${playing ? 'on' : ''}`}
            onClick={handlePreview}
            disabled={!motif.notes.length}
          >
            {playing ? '⏹ Stop' : '▶ Preview'}
          </button>
          <button
            className="motif-btn motif-btn--secondary"
            onClick={handleDownload}
            disabled={!motif.notes.length}
          >
            ↓ MIDI
          </button>
        </div>
      </section>

      <footer className="motif-footer">
        <div className="motif-hint">
          Each motif is a window into the line's geography — Reroll shifts the
          starting point along the route. Drop the MIDI into your DAW.
        </div>
      </footer>
    </div>
  )
}

// ── Piano-roll renderer ───────────────────────────────────────────────────
function MotifRoll({ motif, playStep }) {
  const { notes, totalSteps } = motif
  const { minMidi, maxMidi } = useMemo(() => {
    if (!notes.length) return { minMidi: 48, maxMidi: 72 }
    let lo = Infinity, hi = -Infinity
    for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi }
    return { minMidi: lo - 1, maxMidi: hi + 1 }
  }, [notes])

  const W       = 1000
  const H       = 280
  const stepW   = W / totalSteps
  const rows    = Math.max(1, maxMidi - minMidi + 1)
  const rowH    = H / rows
  const beats   = Math.ceil(totalSteps / 4)
  const bars    = Math.ceil(totalSteps / STEPS_PER_BAR)

  return (
    <div className="motif-roll">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="motif-roll-svg">
        {/* Pitch row stripes for orientation */}
        {Array.from({ length: rows }).map((_, i) => {
          const midi = maxMidi - i
          const black = [1, 3, 6, 8, 10].includes(midi % 12)
          return (
            <rect key={`r${i}`} x={0} y={i * rowH} width={W} height={rowH}
              fill={black ? '#161616' : '#1d1d1d'} />
          )
        })}
        {/* Beat lines */}
        {Array.from({ length: beats - 1 }).map((_, i) => {
          const x = (i + 1) * 4 * stepW
          const isBar = ((i + 1) % 4) === 0
          return (
            <line key={`bl${i}`} x1={x} x2={x} y1={0} y2={H}
              stroke={isBar ? '#444' : '#2a2a2a'} strokeWidth={isBar ? 1 : 0.5} />
          )
        })}
        {/* Notes */}
        {notes.map((n, i) => {
          const x = n.step * stepW
          const y = (maxMidi - n.midi) * rowH
          const w = Math.max(2, n.length * stepW - 1)
          return (
            <rect
              key={i}
              x={x + 0.5} y={y + 1}
              width={w} height={Math.max(3, rowH - 2)}
              rx={1.5}
              fill="#c8f040"
              opacity="0.92"
            >
              <title>{`step ${n.step} · ${midiToName(n.midi)} · ${n.stop || ''}`}</title>
            </rect>
          )
        })}
        {/* Playhead */}
        {playStep >= 0 && (
          <line
            x1={playStep * stepW + stepW / 2}
            x2={playStep * stepW + stepW / 2}
            y1={0} y2={H}
            stroke="#fff" strokeWidth="1.2" opacity="0.7"
          />
        )}
        {/* Bar number labels */}
        {Array.from({ length: bars }).map((_, i) => {
          const x = i * STEPS_PER_BAR * stepW + 4
          return (
            <text key={`bn${i}`} x={x} y={12} fill="#555" fontSize="9" fontFamily="monospace">
              {i + 1}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
