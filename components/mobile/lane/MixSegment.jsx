'use client'

import { SidechainSourceOptions } from '../../DawView.jsx'
import { LaneFilterFields } from '../../LaneFilterEditor.jsx'
import { DEFAULT_SIDECHAIN } from '@/lib/engine.js'
import { FX_BUSES } from '@/lib/fxTrack.js'
import { Field, panLabel } from './fields.jsx'

// One segment of the phone lane sheet (see ../LaneSheet.jsx). It receives the
// sheet's props plus the values LaneSheet derives from them, as `ctx`.
export default function MixSegment({ ctx }) {
  const {
    route, volume, pan, disabled, soloed, sendMatrix, activeFxTracks, sidechain, sidechainSources, filter, onVolume, onPan, onDisable, onSolo, onSendLevel, onSidechain, onFilter,
  } = ctx

  return (
    <div className="lsheet-body">
      <div className="lsheet-toggles">
        <button
          type="button"
          className={`lsheet-toggle ${disabled ? '' : 'is-on'}`}
          onClick={() => onDisable(route.id)}
        >{disabled ? 'Disabled' : 'Enabled'}</button>
        <button
          type="button"
          className={`lsheet-toggle ${soloed ? 'is-solo' : ''}`}
          onClick={() => onSolo(route.id, false)}
        >Solo</button>
        {/* Desktop uses Cmd/Ctrl-click for additive solo, which has no touch
            equivalent — so it gets its own button here. */}
        <button
          type="button"
          className="lsheet-toggle"
          onClick={() => onSolo(route.id, true)}
        >Add to solo</button>
      </div>

      <Field label={`Level · ${volume > 0 ? `+${volume}` : volume} dB`}>
        <input
          type="range" min={-40} max={6} step={1} value={volume}
          onChange={e => onVolume(route.id, Number(e.target.value))}
          aria-label="Level"
        />
      </Field>

      <Field label={`Pan · ${panLabel(pan)}`}>
        <input
          type="range" min={-1} max={1} step={0.05} value={pan}
          onChange={e => onPan(route.id, Number(e.target.value))}
          aria-label="Pan"
        />
        {/* Desktop resets pan with a double-click; that gesture doesn't
            exist on touch, so the reset is a visible control. */}
        <button type="button" className="lsheet-reset" onClick={() => onPan(route.id, 0)}>
          Centre
        </button>
      </Field>

      {onFilter && <LaneFilterFields filter={filter} onFilter={p => onFilter(route.id, p)} Field={Field} />}

      {activeFxTracks.length > 0 && (
        <Field label="Sends">
          {activeFxTracks.map(bus => {
            const label = FX_BUSES.find(b => b.id === bus)?.label ?? bus
            return (
              <div className="lsheet-send" key={bus}>
                <span className="lsheet-send-name">{label}</span>
                <input
                  type="range" min={0} max={1} step={0.01}
                  value={sendMatrix?.[`${route.id}:${bus}`] ?? 0}
                  onChange={e => onSendLevel(route.id, bus, Number(e.target.value))}
                  aria-label={`${label} send`}
                />
              </div>
            )
          })}
        </Field>
      )}

      {(() => {
        const sc = { ...DEFAULT_SIDECHAIN, ...sidechain }
        const scOn = !!sc.enabled && !!sc.source
        const ms = v => `${Math.round(v * 1000)} ms`
        return (
          <Field
            label="Sidechain"
            hint="Dips this lane every time the trigger fires. Pick a drum pad to make it pump."
          >
            <select
              value={sc.source}
              onChange={e => {
                const source = e.target.value
                onSidechain(route.id, source ? { source } : { source: '', enabled: false })
              }}
              aria-label="Sidechain trigger"
            >
              <SidechainSourceOptions sources={sidechainSources} excludeId={route.id} />
            </select>

            {sc.source && (
              <>
                <button
                  type="button"
                  className={`lsheet-toggle lsheet-toggle--inline ${scOn ? 'is-on' : ''}`}
                  onClick={() => onSidechain(route.id, { enabled: !sc.enabled })}
                >{scOn ? 'Ducking' : 'Off'}</button>

                <div className="lsheet-send lsheet-send--wide">
                  <span className="lsheet-send-name">Amount · {Math.round(sc.amountDb)} dB</span>
                  <input
                    type="range" min={-40} max={0} step={1} value={sc.amountDb}
                    onChange={e => onSidechain(route.id, { amountDb: Number(e.target.value) })}
                    aria-label="Sidechain amount"
                  />
                </div>
                <div className="lsheet-send lsheet-send--wide">
                  <span className="lsheet-send-name">Attack · {ms(sc.attack)}</span>
                  <input
                    type="range" min={0} max={0.2} step={0.001} value={sc.attack}
                    onChange={e => onSidechain(route.id, { attack: Number(e.target.value) })}
                    aria-label="Sidechain attack"
                  />
                </div>
                <div className="lsheet-send lsheet-send--wide">
                  <span className="lsheet-send-name">Release · {ms(sc.release)}</span>
                  <input
                    type="range" min={0.02} max={1.5} step={0.01} value={sc.release}
                    onChange={e => onSidechain(route.id, { release: Number(e.target.value) })}
                    aria-label="Sidechain release"
                  />
                </div>
              </>
            )}
          </Field>
        )
      })()}
    </div>
  )
}
