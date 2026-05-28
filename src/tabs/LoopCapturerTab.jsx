import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Midi } from '@tonejs/midi'
import { useRoutes } from '../shared/useRoutes.js'
import {
  LoopEngine, BARS, STEPS_PER_BAR, TOTAL_STEPS, SLOT_COUNT, SLOT_IDS, SLOT_COLORS,
  SCALE_ROOTS, SCALE_MODES, notesFromRoute, midiToName,
} from '../engines/loopEngine.js'
import './LoopCapturerTab.css'

const MODE_NAMES = Object.keys(SCALE_MODES)

export default function LoopCapturerTab() {
  const routes    = useRoutes()
  const engineRef = useRef(null)

  const [bpm,       setBpm]       = useState(96)
  const [started,   setStarted]   = useState(false)
  const [step,      setStep]      = useState(-1)

  const [routeId,   setRouteId]   = useState('')
  const [root,      setRoot]      = useState('D')
  const [mode,      setMode]      = useState('minor')
  const [liveMute,  setLiveMute]  = useState(false)

  // Slot UI state mirrors engine state; engine is source of truth.
  const [slots, setSlots] = useState(
    () => SLOT_IDS.map(() => ({ notes: [], muted: false, solo: false, captured: false }))
  )

  // ── Engine init ─────────────────────────────────────────────────────────
  useEffect(() => {
    const e = new LoopEngine()
    e.init()
    e.setOnStep(setStep)
    engineRef.current = e
    return () => { e.dispose(); engineRef.current = null }
  }, [])

  // ── Default to Tram 6 once routes load ──────────────────────────────────
  useEffect(() => {
    if (!routes || routeId) return
    const fallback = routes.find(r => r.type === 'tram' && r.name === '6')
                  || routes.find(r => r.type === 'metro')
                  || routes[0]
    if (fallback) setRouteId(fallback.id)
  }, [routes, routeId])

  // ── Derive the live phrase whenever line/scale changes ──────────────────
  const liveNotes = useMemo(() => {
    if (!routes) return []
    const r = routes.find(x => x.id === routeId)
    if (!r) return []
    return notesFromRoute(r, root, mode)
  }, [routes, routeId, root, mode])

  useEffect(() => {
    engineRef.current?.setLiveNotes(liveNotes)
  }, [liveNotes])

  useEffect(() => {
    engineRef.current?.setLiveMute(liveMute)
  }, [liveMute])

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

  // ── Controls ────────────────────────────────────────────────────────────
  const handlePlayStop = useCallback(async () => {
    const e = engineRef.current
    if (!e) return
    if (started) { e.stop(); setStarted(false) }
    else { await e.start(bpm); setStarted(true) }
  }, [started, bpm])

  const handleBpm = useCallback((v) => {
    const n = Math.max(40, Math.min(240, Number(v) || 96))
    setBpm(n)
    engineRef.current?.setBpm(n)
  }, [])

  const handleCapture = useCallback((slotIdx) => {
    const e = engineRef.current
    if (!e) return
    e.capture(slotIdx)
    const snap = e.getSlot(slotIdx)
    setSlots(s => s.map((x, i) => i === slotIdx ? { ...x, notes: snap.notes, captured: snap.captured } : x))
  }, [])

  const handleClearSlot = useCallback((slotIdx) => {
    engineRef.current?.clear(slotIdx)
    setSlots(s => s.map((x, i) => i === slotIdx ? { ...x, notes: [], captured: false } : x))
  }, [])

  const handleMute = useCallback((slotIdx) => {
    setSlots(s => {
      const next = !s[slotIdx].muted
      engineRef.current?.setMute(slotIdx, next)
      return s.map((x, i) => i === slotIdx ? { ...x, muted: next } : x)
    })
  }, [])

  const handleSolo = useCallback((slotIdx) => {
    setSlots(s => {
      const next = !s[slotIdx].solo
      engineRef.current?.setSolo(slotIdx, next)
      return s.map((x, i) => i === slotIdx ? { ...x, solo: next } : x)
    })
  }, [])

  const handleExportSlot = useCallback((slotIdx) => {
    const slot = slots[slotIdx]
    if (!slot?.notes?.length) return
    exportNotesToMidi(slot.notes, bpm, `loop-${SLOT_IDS[slotIdx]}-${Date.now()}.mid`)
  }, [slots, bpm])

  const handleExportLive = useCallback(() => {
    if (!liveNotes.length) return
    exportNotesToMidi(liveNotes, bpm, `loop-live-${Date.now()}.mid`)
  }, [liveNotes, bpm])

  if (!routes) return <div className="tab-placeholder">Loading routes…</div>

  const activeBar = step >= 0 ? Math.floor(step / STEPS_PER_BAR) : -1

  return (
    <div className="loop-tab">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="loop-header">
        <h2 className="loop-title">Loop Capturer</h2>

        <div className="loop-field">
          <label>Line</label>
          <select value={routeId} onChange={e => setRouteId(e.target.value)}>
            {sortedRoutes.map(r => (
              <option key={r.id} value={r.id}>
                {r.name} {r.type === 'metro' ? '· metro' : r.type === 'tram' ? '· tram' : `· ${r.type}`}
              </option>
            ))}
          </select>
        </div>

        <div className="loop-field">
          <label>Key</label>
          <select value={root} onChange={e => setRoot(e.target.value)}>
            {SCALE_ROOTS.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>

        <div className="loop-field">
          <label>Mode</label>
          <select value={mode} onChange={e => setMode(e.target.value)}>
            {MODE_NAMES.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>

        <div className="loop-field">
          <label>BPM</label>
          <input
            type="number" min="40" max="240"
            value={bpm}
            onChange={e => handleBpm(e.target.value)}
            disabled={started}
          />
        </div>

        <button
          className={`loop-btn loop-btn--transport ${started ? 'stop' : 'play'}`}
          onClick={handlePlayStop}
        >
          {started ? '⏹ Stop' : '▶ Play'}
        </button>
      </header>

      {/* ── Live recorder ───────────────────────────────────────────────── */}
      <section className="loop-live">
        <div className="loop-live-meta">
          <span className="loop-live-label">Recording — {BARS} bars</span>
          <span className="loop-live-count">{liveNotes.length} notes</span>
          <button
            className={`loop-mini-btn ${liveMute ? 'on' : ''}`}
            onClick={() => setLiveMute(m => !m)}
            title="Mute live phrase"
          >M</button>
          <button
            className="loop-mini-btn"
            onClick={handleExportLive}
            title="Export live phrase as MIDI"
            disabled={!liveNotes.length}
          >↓</button>
        </div>
        <PianoRoll
          notes={liveNotes}
          currentStep={step}
          color="#c8f040"
          height={84}
        />
        <div className="loop-bar-strip">
          {Array.from({ length: BARS }).map((_, i) => (
            <div
              key={i}
              className={`loop-bar ${activeBar === i ? 'active' : ''}`}
            >{i + 1}</div>
          ))}
        </div>
      </section>

      {/* ── Slots ───────────────────────────────────────────────────────── */}
      <section className="loop-slots">
        {SLOT_IDS.map((id, i) => {
          const slot  = slots[i]
          const color = SLOT_COLORS[i]
          return (
            <div key={id} className={`loop-slot ${slot.muted ? 'is-muted' : ''}`}>
              <header className="loop-slot-head">
                <span className="loop-slot-id" style={{ color }}>{id}</span>
                <span className="loop-slot-count">
                  {slot.captured ? `${slot.notes.length} notes` : 'empty'}
                </span>
                <div className="loop-slot-controls">
                  <button
                    className="loop-btn loop-btn--cap"
                    onClick={() => handleCapture(i)}
                    disabled={!liveNotes.length}
                    title={`Capture current live phrase into slot ${id}`}
                  >● Capture</button>
                  <button
                    className={`loop-mini-btn ${slot.solo ? 'on solo' : ''}`}
                    onClick={() => handleSolo(i)}
                    title="Solo"
                  >S</button>
                  <button
                    className={`loop-mini-btn ${slot.muted ? 'on' : ''}`}
                    onClick={() => handleMute(i)}
                    title="Mute"
                    disabled={!slot.captured}
                  >M</button>
                  <button
                    className="loop-mini-btn"
                    onClick={() => handleExportSlot(i)}
                    title="Export MIDI"
                    disabled={!slot.captured}
                  >↓</button>
                  <button
                    className="loop-mini-btn"
                    onClick={() => handleClearSlot(i)}
                    title="Clear slot"
                    disabled={!slot.captured}
                  >⌫</button>
                </div>
              </header>
              <PianoRoll
                notes={slot.notes}
                currentStep={slot.captured ? step : -1}
                color={color}
                height={56}
                dim={!slot.captured}
              />
            </div>
          )
        })}
      </section>

      <footer className="loop-footer">
        <div className="loop-hint">
          Pick a line + key + mode → press play to hear the rolling 8-bar phrase.
          Hit Capture A–D to lock the current phrase into a slot; slots keep playing
          while you reshape the live recorder. Stack up to four lines.
        </div>
      </footer>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────
function exportNotesToMidi(notes, bpm, filename) {
  const midi = new Midi()
  midi.header.setTempo(bpm)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
  const stepSeconds = (60 / bpm) / 4
  const track = midi.addTrack()
  for (const n of notes) {
    track.addNote({
      midi:     n.midi,
      time:     n.step * stepSeconds,
      duration: stepSeconds * 2,
      velocity: 0.8,
    })
  }
  const blob = new Blob([midi.toArray()], { type: 'audio/midi' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function PianoRoll({ notes, currentStep, color, height = 64, dim = false }) {
  // Pitch range for vertical scaling — derived from notes themselves, or a
  // sensible default if empty.
  const { minMidi, maxMidi } = useMemo(() => {
    if (!notes.length) return { minMidi: 48, maxMidi: 84 }
    let lo = Infinity, hi = -Infinity
    for (const n of notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi }
    // Pad 2 semitones each side so notes don't sit on the edge.
    return { minMidi: lo - 2, maxMidi: hi + 2 }
  }, [notes])

  const range  = Math.max(1, maxMidi - minMidi)
  const W      = 1000     // viewBox width — scales to container
  const H      = height
  const noteW  = W / TOTAL_STEPS

  return (
    <div className="piano-roll" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="piano-roll-svg">
        {/* Bar dividers */}
        {Array.from({ length: BARS - 1 }).map((_, i) => {
          const x = ((i + 1) * STEPS_PER_BAR) * noteW
          return <line key={`b${i}`} x1={x} x2={x} y1={0} y2={H} stroke="#333" strokeWidth="1" />
        })}
        {/* Notes */}
        {notes.map((n, i) => {
          const x = n.step * noteW
          const y = H - ((n.midi - minMidi) / range) * H
          return (
            <rect
              key={i}
              x={x}
              y={Math.max(0, y - 3)}
              width={Math.max(2, noteW * 1.6)}
              height={4}
              rx={1}
              fill={color}
              opacity={dim ? 0.35 : 0.95}
            >
              <title>{`step ${n.step} · ${midiToName(n.midi)} · ${n.stop || ''}`}</title>
            </rect>
          )
        })}
        {/* Playhead */}
        {currentStep >= 0 && (
          <line
            x1={currentStep * noteW + noteW / 2}
            x2={currentStep * noteW + noteW / 2}
            y1={0} y2={H}
            stroke="#fff" strokeWidth="1" opacity="0.55"
          />
        )}
      </svg>
    </div>
  )
}
