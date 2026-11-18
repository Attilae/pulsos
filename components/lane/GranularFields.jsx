'use client'
import { DEFAULT_GRANULAR } from '@/lib/engine.js'
import { autoCtl } from '@/lib/automationControl.js'
export default function GranularFields({ route, granular, onGranular, autoTargets = {}, variant = 'rack' }) {
  const gg = { ...DEFAULT_GRANULAR, ...granular }
  const grainOn = !!gg.enabled
  const dim = grainOn ? {} : { opacity: 0.4 }
  // Sliders mirror live grain.* automation (greyed + swept value) like
  // the other instrument controls.
  const grainRow = (label, key, min, max, step, fmt) => {
    const a = autoCtl(autoTargets, `grain.${key}`)
    const val = a.display ?? gg[key]
    return (
      <div className="glide-row" style={dim}>
        <span className="glide-label">{label}</span>
        <input
          type="range" min={min} max={max} step={step}
          value={val}
          disabled={!grainOn || a.disabled}
          aria-label={`${route.name} grain ${label}`}
          aria-valuetext={a.disabled ? 'automated' : String(fmt(val))}
          onChange={e => onGranular({ [key]: parseFloat(e.target.value) })}
          className="glide-slider"
        />
        <span className="glide-val">{a.disabled ? 'auto' : fmt(val)}</span>
        {variant === 'sheet' && <button type="button" disabled={!grainOn || a.disabled} onClick={() => onGranular({ [key]: DEFAULT_GRANULAR[key] })} aria-label={`Reset grain ${label}`}>Reset</button>}
      </div>
    )
  }
  const pct = v => `${Math.round(v * 100)}%`
  const ms  = v => `${Math.round(v * 1000)}ms`
  return (
    <div className="rack-card rack-card--sound" data-tour="rack-granular">
      <div className="rack-card-head">
        Granular
        <button
          aria-pressed={grainOn}
          className={`legato-btn ${grainOn ? 'active' : ''}`}
          onClick={() => onGranular({ enabled: !grainOn })}
          title={grainOn
            ? 'Granular layer on. Click to disable'
            : 'Layer a grain cloud rendered from this track’s instrument'}
          style={{ marginLeft: 'auto', ...(grainOn ? { borderColor: route.color, color: route.color } : {}) }}
        >GRAIN</button>
      </div>

      {grainRow('MIX',   'mix',          0,    1,   0.01,  pct)}
      {grainRow('SIZE',  'grainSize',    0.01, 0.5, 0.005, ms)}
      {grainRow('OVLP',  'overlap',      0.01, 0.5, 0.005, ms)}
      {grainRow('RATE',  'playbackRate', 0.25, 4,   0.01,  v => `${Number(v).toFixed(2)}×`)}
      {grainRow('LP ST', 'loopStart',    0,    1,   0.01,  pct)}
      {grainRow('LP EN', 'loopEnd',      0,    1,   0.01,  pct)}
      {grainRow('JITR',  'jitter',       0,    1,   0.01,  pct)}

      <div className="speed-row" style={dim}>
        <span className="speed-label">DIR</span>
        <div className="speed-btns">
          <button
            className={`speed-btn ${!gg.reverse ? 'active' : ''}`}
            style={!gg.reverse ? { borderColor: route.color, color: route.color } : {}}
            disabled={!grainOn} onClick={() => onGranular({ reverse: false })}
          >FWD</button>
          <button
            className={`speed-btn ${gg.reverse ? 'active' : ''}`}
            style={gg.reverse ? { borderColor: route.color, color: route.color } : {}}
            disabled={!grainOn} onClick={() => onGranular({ reverse: true })}
          >REV</button>
        </div>
      </div>

      {grainRow('ATK', 'attack', 0, 2, 0.005, ms)}
      {grainRow('REL', 'release', 0.01, 6, 0.01, v => `${Number(v).toFixed(2)}s`)}
    </div>
  )
}
