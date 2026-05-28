import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRoutes } from '../shared/useRoutes.js'
import {
  PhonesEngine, VOICE_DEFS, BARS, TOTAL_BEATS, BPM, phraseFromRoute,
} from '../engines/phonesEngine.js'
import './HeadphoneTab.css'

export default function HeadphoneTab() {
  const routes    = useRoutes()
  const engineRef = useRef(null)

  const [started,  setStarted]  = useState(false)
  const [beat,     setBeat]     = useState(-1)
  const [brighter, setBrighter] = useState(false)
  const [volume,   setVolume]   = useState(-4)

  // ── Engine init ─────────────────────────────────────────────────────────
  useEffect(() => {
    const e = new PhonesEngine()
    e.init()
    e.setOnBeat(setBeat)
    engineRef.current = e
    return () => { e.dispose(); engineRef.current = null }
  }, [])

  // ── Resolve voices to routes + derive phrases ──────────────────────────
  const voices = useMemo(() => {
    if (!routes) return []
    return VOICE_DEFS.map(v => {
      const route = routes.find(r => r.type === v.routeType && r.name === v.routeName)
                 || routes.find(r => r.name === v.routeName)
      const phrase = route ? phraseFromRoute(route, v) : []
      return { ...v, route, phrase }
    })
  }, [routes])

  useEffect(() => {
    if (!engineRef.current) return
    for (const v of voices) engineRef.current.setPhrase(v.id, v.phrase)
  }, [voices])

  // ── Controls ────────────────────────────────────────────────────────────
  const handlePlayStop = useCallback(async () => {
    const e = engineRef.current
    if (!e) return
    if (started) { e.stop(); setStarted(false) }
    else { await e.start(); setStarted(true) }
  }, [started])

  const handleBrighter = useCallback(() => {
    setBrighter(b => {
      const next = !b
      engineRef.current?.setBrighter(next)
      return next
    })
  }, [])

  const handleVolume = useCallback((db) => {
    setVolume(db)
    engineRef.current?.setMasterVolume(db)
  }, [])

  if (!routes) return <div className="tab-placeholder">Loading…</div>

  const progress = beat >= 0 ? (beat + 1) / TOTAL_BEATS : 0
  const bar      = beat >= 0 ? Math.floor(beat / 4) + 1 : 0

  return (
    <div className="phones-tab">
      <div className="phones-stage">

        <div className={`phones-orb ${started ? 'on' : ''}`}>
          <div className="phones-orb-ring" style={{ transform: `rotate(${progress * 360}deg)` }} />
          <button
            className={`phones-play ${started ? 'on' : ''}`}
            onClick={handlePlayStop}
            aria-label={started ? 'Stop' : 'Play'}
          >
            <span className="phones-play-glyph">{started ? '■' : '▶'}</span>
          </button>
        </div>

        <div className="phones-caption">
          {started ? (
            <>
              <div className="phones-caption-big">Bar {bar} of {BARS}</div>
              <div className="phones-caption-sub">Budapest is playing for you</div>
            </>
          ) : (
            <>
              <div className="phones-caption-big">Put your headphones on</div>
              <div className="phones-caption-sub">Press play. Walk away. Come back later.</div>
            </>
          )}
        </div>

        <div className="phones-card">
          <header className="phones-card-head">Now playing</header>
          <ul className="phones-voice-list">
            {voices.map(v => {
              const noteNow = started && v.phrase.some(n => n.beat === beat)
              return (
                <li key={v.id} className={`phones-voice ${noteNow ? 'lit' : ''}`}>
                  <span className="phones-voice-line">{v.label}</span>
                  <span className="phones-voice-role">{v.role}</span>
                  <span className="phones-voice-dot" />
                </li>
              )
            })}
          </ul>
        </div>

        <div className="phones-controls">
          <button
            className={`phones-toggle ${brighter ? 'on' : ''}`}
            onClick={handleBrighter}
          >
            {brighter ? '☀ Brighter' : '☾ Warmer'}
          </button>

          <div className="phones-volume">
            <span className="phones-volume-icon">♪</span>
            <input
              type="range"
              min="-30" max="6" step="1"
              value={volume}
              onChange={e => handleVolume(+e.target.value)}
              aria-label="Volume"
            />
          </div>
        </div>

      </div>
    </div>
  )
}
