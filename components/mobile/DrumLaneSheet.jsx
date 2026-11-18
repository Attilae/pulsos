'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import Sheet from '../Sheet.jsx'
import { DRUMS_ROUTE_ID } from '@/lib/soundSpecs.js'
import { PAD_DEFS, STEPS, SOURCE_STEPS, normalizeStep } from '@/lib/drumSpecs.js'
import { drumSourceStep, drumVisibleStep, drumSourcePage, drumPlaybackStep, drumVelocityClass, drumWindowLabel } from '@/lib/drumLane.js'
import { subscribePlayhead } from '@/lib/shared/playheadTicker.js'
import LaneMixFields from './lane/LaneMixFields.jsx'
import { Field, GroupHead } from './lane/fields.jsx'

export default function DrumLaneSheet({ open, onClose, drums, started, onVolume, onFilter, onSendLevel, activeFxTracks, sendMatrix, onClear }) {
  const [segment, setSegment] = useState('pads')
  const [page, setPage] = useState(() => drumSourcePage(drums.pattern.offsets?.kick ?? 0))
  const rootRef = useRef(null)
  const pagesRef = useRef(null)
  const frameRef = useRef({ step: -1, pads: [], pages: [] })
  // Cache DOM nodes after each React commit, since edits can replace styles.
  // The frame callback reads Transport and writes transforms only when a step changes.
  useLayoutEffect(() => {
    const root = rootRef.current
    frameRef.current = {
      step: -1,
      pages: Array.from(pagesRef.current?.querySelectorAll('[data-drum-page]') ?? []),
      pads: PAD_DEFS.map(pad => ({
        indicator: root?.querySelector(`[data-drum-cursor="${pad.id}"]`),
        offset: drums.pattern.offsets?.[pad.id] ?? 0,
      })),
    }
  })
  useEffect(() => {
    const clear = () => {
      const f = frameRef.current
      f.step = -1
      for (const pad of f.pads) if (pad.indicator) pad.indicator.hidden = true
      for (const button of f.pages) button.removeAttribute('data-playing')
    }
    if (!open || segment !== 'pads' || !started) { clear(); return }
    const unsubscribe = subscribePlayhead(() => {
      const transport = Tone.getTransport()
      const step = drumPlaybackStep(transport.seconds, transport.bpm.value)
      const f = frameRef.current
      if (f.step === step) return
      f.step = step
      const playingPages = new Set()
      for (const pad of f.pads) {
        const source = drumSourceStep(pad.offset, step)
        const sourcePage = drumSourcePage(source)
        playingPages.add(sourcePage)
        if (!pad.indicator) continue
        pad.indicator.hidden = sourcePage !== page
        const cell = source % STEPS, col = cell % 4, row = Math.floor(cell / 4)
        pad.indicator.style.transform = `translate(calc(${col * 100}% + ${col} * var(--mdrum-gap)), calc(${row * 100}% + ${row} * var(--mdrum-gap)))`
        pad.indicator.dataset.sourceStep = String(source)
      }
      for (const button of f.pages) {
        if (playingPages.has(Number(button.dataset.drumPage))) button.dataset.playing = 'true'
        else button.removeAttribute('data-playing')
      }
    })
    return () => { unsubscribe(); clear() }
  }, [open, segment, started, page])

  return <Sheet open={open} onClose={onClose} title="Drum lane" className="lane-sheet drum-lane-sheet"
    footer={<button type="button" className="lsheet-action mdrum-remove" onClick={onClear}>Remove drum lane</button>}
    toolbar={<div className="mdrum-toolbar"><div className="lsheet-segments" role="tablist" aria-label="Drum lane sections">
      {['pads', 'mix'].map(id => <button key={id} type="button" role="tab" aria-selected={segment === id}
        className={`lsheet-segment${segment === id ? ' is-active' : ''}`} onClick={() => setSegment(id)}>{id === 'pads' ? 'Pads' : 'Mix'}</button>)}
    </div>{segment === 'pads' && <div ref={pagesRef} className="mdrum-pages" role="group" aria-label="Drum pattern pages">
          {Array.from({ length: SOURCE_STEPS / STEPS }, (_, i) => <button key={i} type="button" data-drum-page={i}
            className={`lsheet-action${page === i ? ' is-selected' : ''}`} aria-pressed={page === i}
            aria-label={`Show drum steps ${i * STEPS + 1} to ${(i + 1) * STEPS}`} onClick={() => setPage(i)}>{i * STEPS + 1}–{(i + 1) * STEPS}</button>)}
        </div>}</div>}>
    {segment === 'pads' ? <div ref={rootRef} className="lsheet-body">
      <section className="lsheet-group">
        <GroupHead title="Pattern pages" description="Each pad loops 16 steps. Pages show all 64 saved steps; outlined steps are in the pad’s play window." />

      </section>
      {PAD_DEFS.map(pad => {
        const offset = drums.pattern.offsets?.[pad.id] ?? 0
        const padMuted = !!drums.pattern.muted?.[pad.id]
        return <section className="lsheet-group mdrum-pad" key={pad.id} aria-label={`${pad.label} pad`}>
          <div className="mdrum-pad-head">
            <div><h3>{pad.label}</h3><span className="lsheet-hint">Loops {drumWindowLabel(offset)}</span></div>
            <button type="button" className={`lsheet-action${padMuted ? ' is-muted' : ''}`} aria-label={`Mute ${pad.label}`}
              aria-pressed={padMuted} onClick={() => drums.onTogglePadMute(pad.id)}>{padMuted ? 'Muted' : 'Mute'}</button>
          </div>
          <div className="mdrum-grid" role="group" aria-label={`${pad.label} steps`}>
            {Array.from({ length: STEPS }, (_, i) => {
              const source = page * STEPS + i
              const v = normalizeStep(drums.pattern.patterns?.[pad.id]?.[source])
              const inWindow = drumVisibleStep(offset, source) < STEPS
              return <button key={source} type="button" data-source-step={source}
                className={`mdrum-step ${drumVelocityClass(v)}${v ? ' on' : ''}${inWindow ? ' in-window' : ''}`}
                aria-label={`${pad.label} step ${source + 1}, ${v ? `velocity ${Math.round(v * 100)}%` : 'off'}${inWindow ? '' : ', outside play window'}`}
                aria-pressed={v > 0} onClick={() => drums.onToggleStep(pad.id, drumVisibleStep(offset, source))}>
                <span>{source + 1}</span><span className="mdrum-velocity">{v ? `${Math.round(v * 100)}%` : 'Off'}</span>
              </button>
            })}
            <span data-drum-cursor={pad.id} className="mdrum-cursor" hidden aria-hidden="true" />
          </div>
        </section>
      })}
    </div> : <div className="lsheet-body">
      <Field label={`Level · ${drums.volume} dB`}>
        <input type="range" min={-40} max={6} step={1} value={drums.volume} aria-label="Drum level"
          onChange={e => onVolume(DRUMS_ROUTE_ID, Number(e.target.value))} />
      </Field>
      <LaneMixFields routeId={DRUMS_ROUTE_ID} filter={drums.filter} onFilter={onFilter}
        activeFxTracks={activeFxTracks} sendMatrix={sendMatrix} onSendLevel={onSendLevel} />
    </div>}
  </Sheet>
}
