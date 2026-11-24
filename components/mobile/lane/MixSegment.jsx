'use client'

import { SidechainSourceOptions } from '../../DawView.jsx'
import LaneMixFields from './LaneMixFields.jsx'
import { autoCtl, deviceToggleState } from '@/lib/automationControl.js'
import { DEFAULT_SIDECHAIN } from '@/lib/engine.js'
import { Field, GroupHead, panLabel } from './fields.jsx'

// One segment of the phone lane sheet (see ../LaneSheet.jsx). It receives the
// sheet's props plus the values LaneSheet derives from them, as `ctx`.
export default function MixSegment({ ctx }) {
  const {
    autoTargets, getEqRuntime, engineGen, started, audioExporting, audioProgress, onExportMidi, onExportWav, route, volume, pan, disabled, soloed, sendMatrix, activeFxTracks, sidechain, sidechainSources, filter, onVolume, onPan, onDisable, onSolo, onSendLevel, onSidechain, onFilter,
  } = ctx

  const levelAuto = autoCtl(autoTargets, 'volume')
  const panAuto = autoCtl(autoTargets, 'pan', { divide: 100 })
  const level = levelAuto.display ?? volume
  const stereo = panAuto.display ?? pan

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

      <Field label={`Level · ${level.toFixed(1)} dB${levelAuto.disabled ? " · automated" : ""}`}>
        <input
          type="range" min={-40} max={6} step={1} value={level} disabled={levelAuto.disabled}
          onChange={e => onVolume(route.id, Number(e.target.value))}
          aria-label="Level"
        />
      </Field>

      <Field label={`Pan · ${panLabel(stereo)}${panAuto.disabled ? " · automated" : ""}`}>
        <input
          type="range" min={-1} max={1} step={0.05} value={stereo} disabled={panAuto.disabled}
          onChange={e => onPan(route.id, Number(e.target.value))}
          aria-label="Pan"
        />
        {/* Desktop resets pan with a double-click; that gesture doesn't
            exist on touch, so the reset is a visible control. */}
        <button type="button" className="lsheet-reset" disabled={panAuto.disabled} onClick={() => onPan(route.id, 0)}>
          Centre
        </button>
      </Field>

      <LaneMixFields autoTargets={autoTargets} getEqRuntime={getEqRuntime} engineGen={engineGen} routeId={route.id} filter={filter} onFilter={onFilter}
        activeFxTracks={activeFxTracks} sendMatrix={sendMatrix} onSendLevel={onSendLevel} />

      {(() => {
        const sc = { ...DEFAULT_SIDECHAIN, ...sidechain }
        const scDev = deviceToggleState(autoTargets, 'device.sidechain', sc.enabled)
        const scOn = scDev.on && !!sc.source
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
                  aria-pressed={scOn}
                  disabled={scDev.automated}
                >{scDev.automated ? `Automated · ${scOn ? 'ducking' : 'off'}` : scOn ? 'Ducking' : 'Off'}</button>

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
      <section className="lsheet-group">
        <GroupHead title="Export lane" description="MIDI saves one loop of notes. WAV records this lane’s live output." />
        <div className="lsheet-pair">
          <button type="button" className="lsheet-action" disabled={!route.stops?.length} onClick={() => onExportMidi(route.id)}>Export MIDI</button>
          <button type="button" className="lsheet-action" disabled={!route.stops?.length || !started || audioExporting} onClick={() => onExportWav(route.id)}>Export WAV</button>
        </div>
        <p className="lsheet-hint" role="status">{audioExporting
          ? `Recording WAV: ${Math.round(audioProgress * 100)}%`
          : !started ? 'Press Play to record WAV.' : disabled ? 'Enable this lane to hear it in the WAV recording.' : 'WAV records in real time.'}</p>
      </section>
    </div>
  )
}
