'use client'
import { LaneFilterFields } from '../../LaneFilterEditor.jsx'
import { FX_BUSES } from '@/lib/fxTrack.js'
import TouchEqEditor from '../../lane/TouchEqEditor.jsx'
import { autoCtl } from '@/lib/automationControl.js'
import { Field } from './fields.jsx'

// Shared by the instrument lane Mix segment and the drum lane's Mix sheet.
export default function LaneMixFields({ routeId, filter, onFilter, activeFxTracks = [], sendMatrix, onSendLevel, getEqRuntime, engineGen, autoTargets }) {
  return <>
      {onFilter && <LaneFilterFields autoTargets={autoTargets} filter={filter} onFilter={p => onFilter(routeId, p)} Field={Field} />}

      <TouchEqEditor getRuntime={getEqRuntime} routeId={routeId} engineGen={engineGen} />

      {activeFxTracks.length > 0 && (
        <Field label="Sends">
          {activeFxTracks.map(bus => {
            const auto = autoCtl(autoTargets, `send.${bus}`)
            const label = FX_BUSES.find(b => b.id === bus)?.label ?? bus
            return (
              <div className="lsheet-send" key={bus}>
                <span className="lsheet-send-name">{label}{auto.disabled ? " · automated" : ""}</span>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={auto.display ?? sendMatrix?.[`${routeId}:${bus}`] ?? 0}
                  disabled={auto.disabled}
                  aria-valuetext={auto.disabled ? `Automated: ${Math.round((auto.display ?? sendMatrix?.[`${routeId}:${bus}`] ?? 0) * 100)}%` : undefined}
                  onChange={e => onSendLevel(routeId, bus, Number(e.target.value))}
                  aria-label={`${label} send`}
                />
              </div>
            )
          })}
        </Field>
      )}

  </>
}
