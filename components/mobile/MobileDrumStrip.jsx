'use client'
import { DRUMS_ROUTE_ID } from '@/lib/soundSpecs.js'
import { IconMore } from '../icons.jsx'

export default function MobileDrumStrip({ drums, onVolume, onOpen }) {
  return <section className="mdrum-strip" aria-label="Drum lane">
    <div className="mdrum-strip-head">
      <h3>Drums</h3>
      <button type="button" className="mlane-btn" aria-label="Drum lane settings" onClick={onOpen}><IconMore /></button>
    </div>
    <div className="mdrum-strip-controls">
      <button type="button" className={`lsheet-action${drums.muted ? ' is-muted' : ''}`}
        aria-label="Mute all drums" aria-pressed={drums.muted} onClick={drums.onToggleMute}>{drums.muted ? 'Muted' : 'Mute all'}</button>
      <input type="range" min={-40} max={6} step={1} value={drums.volume}
        aria-label="Drum lane volume" aria-valuetext={`${drums.volume} dB`}
        onChange={e => onVolume(DRUMS_ROUTE_ID, Number(e.target.value))} />
      <span className="mono">{drums.volume} dB</span>
    </div>
  </section>
}
