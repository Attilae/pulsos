'use client'
import { useEffect, useState } from 'react'
import { getMasterBus } from '@/lib/masterBus.js'
import { MASTER_CHAIN_DEFAULTS, MASTER_CHAIN_SPECS, MASTER_CHAIN_STAGES, isDefaultMasterChain } from '@/lib/masterChain.js'
import FxParamControl from './fx/FxParamControl.jsx'
import { IconReset } from './icons.jsx'

// The hidden master bus (lib/masterBus.js) made visible: what's on it, how hard
// its two dynamics stages are working, and a few narrow-range controls
// (lib/masterChain.js). "Off" falls back to the classic compressor + limiter, so
// the output is never left unprotected.
const MASTER_METER_POLL_MS = 100
const MASTER_METER_RANGE_DB = 8

export default function MasterChainCard({ settings, onChange, active = true, variant = 'rack' }) {
  const { enabled } = settings
  const [meter, setMeter] = useState(null)

  useEffect(() => {
    if (!active || !enabled) { setMeter(null); return }
    const bus = getMasterBus()
    const id = setInterval(() => {
      if (document.hidden) return
      const next = bus.status()
      // Only re-render when the shown reading (0.1 dB) actually moves; an idle
      // master otherwise re-rendered this card ten times a second for nothing.
      setMeter(prev => (
        prev
        && prev.limiter === next.limiter
        && Math.round((prev.glueReductionDb ?? 0) * 10) === Math.round((next.glueReductionDb ?? 0) * 10)
        && Math.round((prev.limiterReductionDb ?? 0) * 10) === Math.round((next.limiterReductionDb ?? 0) * 10)
      ) ? prev : next)
    }, MASTER_METER_POLL_MS)
    return () => clearInterval(id)
  }, [enabled, active])

  const isDefault = isDefaultMasterChain(settings)

  return (
    <div className={`fx-track-card master-chain-card master-chain-card--${variant} ${enabled ? '' : 'fx-track-card--muted'}`}>
      <div className="fx-track-card-header">
        <span className="fx-track-name master-chain-name">Mastering</span>
        <span className="master-chain-flow" aria-label="Signal chain">
          {MASTER_CHAIN_STAGES.map((st, i) => (
            <span key={st.id}>{i > 0 && <span className="master-chain-arrow">›</span>}{st.label}</span>
          ))}
        </span>
        <button
          type="button"
          className="master-chain-reset"
          onClick={() => onChange({ ...MASTER_CHAIN_DEFAULTS, enabled })}
          disabled={isDefault}
          title="Reset mastering to defaults"
          aria-label="Reset mastering to defaults"
        ><IconReset /></button>
        <button
          type="button"
          aria-label="Enable mastering"
          className={`master-chain-toggle ${enabled ? 'active' : ''}`}
          onClick={() => onChange({ enabled: !enabled })}
          aria-pressed={enabled}
          title={enabled ? 'Turn mastering off (keeps a safety limiter)' : 'Turn mastering on'}
        >{enabled ? 'On' : 'Off'}</button>
      </div>
      <div className="fx-track-params master-chain-params">
        {MASTER_CHAIN_SPECS.map(spec => (
          <FxParamControl
            key={spec.id}
            variant={variant}
            resetValue={MASTER_CHAIN_DEFAULTS[spec.id]}
            spec={spec}
            value={settings[spec.id]}
            onChange={v => onChange({ [spec.id]: v })}
            disabled={!enabled}
            disabledText={null}
          />
        ))}
      </div>
      <div className="master-chain-meters">
        {enabled ? (
          <>
            <GainReductionMeter label="Glue" db={meter?.glueReductionDb} />
            <GainReductionMeter
              label="Limit"
              title={meter?.limiter === 'true-peak worklet' ? 'True-peak limiter gain reduction' : 'Limiter gain reduction'}
              db={meter?.limiterReductionDb}
            />
          </>
        ) : (
          <span className="master-chain-off-note">Off: safety limiter only</span>
        )}
      </div>
    </div>
  )
}

function GainReductionMeter({ label, db, title = `${label} gain reduction` }) {
  const gr = Math.min(0, db ?? 0)
  const frac = Math.min(1, -gr / MASTER_METER_RANGE_DB)
  return (
    <div className="gr-meter" title={title}>
      <span className="fx-param-label">{label}</span>
      <div className="gr-meter-track">
        <div className="gr-meter-fill" style={{ transform: `scaleX(${frac})` }} />
      </div>
      <span className="fx-param-val">{gr === 0 ? '0.0' : gr.toFixed(1)} dB</span>
    </div>
  )
}
