// The thumb bar: the three controls you touch while music is playing.
//
// Lives in the grid, never position:fixed — .daw-header is already sticky, and
// on iOS a fixed bottom bar and a sticky top bar overlap each other whenever
// the URL bar collapses.
//
// Carries the one shared playhead for the whole phone view (desktop runs one
// rAF per lane; see MobileLaneStrip for why that doesn't survive a phone).
'use client'

import { useEffect, useRef } from 'react'
import * as Tone from 'tone'

export default function MobileTransportBar({
  started,
  onPlayPause,
  bpm,
  onBpm,
  view,
  onView,
  needsGesture,
  onGestureStart,
  noOutput,
  onSoundCheck,
}) {
  const playheadRef = useRef(null)

  // One rAF for the whole view, writing a transform directly rather than going
  // through React — a setState per frame would re-render every lane strip.
  useEffect(() => {
    if (!started) {
      if (playheadRef.current) playheadRef.current.style.transform = 'scaleX(0)'
      return undefined
    }
    let raf = 0
    const tick = () => {
      const el = playheadRef.current
      if (el) {
        // Position within the 4-bar grid the lanes are quantised to.
        const bars = Tone.Transport.seconds / ((60 / (Tone.Transport.bpm.value || 120)) * 4)
        el.style.transform = `scaleX(${(bars % 4) / 4})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [started])

  return (
    <div className="mtransport">
      <span ref={playheadRef} className="mtransport-playhead" aria-hidden="true" />

      {needsGesture ? (
        <button type="button" className="mtransport-gesture" onClick={onGestureStart}>
          ▶ Tap to start audio
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`mtransport-play ${started ? 'is-playing' : ''}`}
            onClick={onPlayPause}
            data-tour="transport"
            aria-label={started ? 'Stop' : 'Play'}
          >
            {started ? '⏹' : '▶'}
          </button>

          <div className="mtransport-bpm">
            <button type="button" onClick={() => onBpm(Math.max(40, bpm - 1))} aria-label="Slower">−</button>
            <span className="mono" aria-label={`${bpm} beats per minute`}>{bpm}</span>
            <button type="button" onClick={() => onBpm(Math.min(240, bpm + 1))} aria-label="Faster">+</button>
          </div>

          {noOutput && (
            <button type="button" className="mtransport-nooutput" onClick={onSoundCheck}>
              No output?
            </button>
          )}

          <div className="mtransport-view" data-tour="view" role="tablist">
            <button
              type="button" role="tab" aria-selected={view === 'map'}
              className={view === 'map' ? 'is-active' : ''}
              onClick={() => onView('map')}
            >Map</button>
            <button
              type="button" role="tab" aria-selected={view === 'daw'}
              className={view === 'daw' ? 'is-active' : ''}
              onClick={() => onView('daw')}
            >Lanes</button>
          </div>
        </>
      )}
    </div>
  )
}
