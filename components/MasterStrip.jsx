'use client'

export default function MasterStrip({ volume, onVolume, variant = 'rack' }) {
  return (
    <div className={`master-strip master-strip--${variant}`}>
      <span className="master-strip-label">Master</span>
      <div className="master-vol-row">
        <span className="master-vol-label">Vol</span>
        <input
          type="range" min="-40" max="0" step="1"
          value={volume}
          onChange={e => onVolume(Number(e.target.value))}
          aria-label="Master volume"
          aria-valuetext={`${volume} dB`}
          className="master-vol-slider"
        />
        <span className="master-vol-val">{volume}dB</span>
      </div>
      {variant === 'sheet' && <button type="button" className="lsheet-action" onClick={() => onVolume(0)}>Reset master volume</button>}
    </div>
  )
}
