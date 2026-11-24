'use client'
import { findTargetSpec, supportsGranular } from '@/lib/engine.js'
import AutomationFields from '../../lane/AutomationFields.jsx'
import AutomationCurveEditor from '../AutomationCurveEditor.jsx'
import LoopRegionFields from './LoopRegionFields.jsx'
import { GroupHead } from './fields.jsx'
import ToggleAutomationRail from '../../lane/ToggleAutomationRail.jsx'
import { isToggleTarget, toggleTargetActive, deviceManualOn } from '@/lib/toggleAutomation.js'

export default function AutoSegment({ ctx }) {
  const { route, synthType, adsr, filter, granular, activeFxTracks, automationLanes, automationRoutes = [], sourceRegions, sourceResolutions,
    onAddAutomationLane, onUpdateAutomationLane, onRemoveAutomationLane, autoVisuals,
    arp, sidechain, loopRegion, speed, gridResolution, started } = ctx
  return <div className="lsheet-body">
    <GroupHead title="Automation" description="Use a line’s stops to move this lane’s controls, or draw when Arp, Texture or Sidechain switch on and off." />
    <button type="button" className="lsheet-action" onClick={() => onAddAutomationLane(route.id)}>+ Automation</button>
    {!Object.keys(automationLanes ?? {}).length && <p className="lsheet-hint">Add an automation lane, then choose a source line and a target.</p>}
    {Object.entries(automationLanes ?? {}).map(([id, cfg], index) => {
      const source = automationRoutes.find(r => r.id === cfg.sourceRouteId)
      const region = cfg.loopRegion ?? sourceRegions?.[cfg.sourceRouteId]
      const update = patch => onUpdateAutomationLane(route.id, id, patch)
      if (isToggleTarget(cfg.paramTarget)) {
        const spec = findTargetSpec(cfg.paramTarget, synthType)
        return <section key={id} className="lsheet-group mauto-lane" role="group" aria-label={`Automation ${index + 1}`}>
          <h3>Automation {index + 1}</h3>
          <AutomationFields variant="sheet" instRoute={route} allRoutes={automationRoutes} synthType={synthType} adsr={adsr} filter={filter}
            granular={granular} sidechain={sidechain} activeFxTracks={activeFxTracks} sourceRouteId="" paramTarget={cfg.paramTarget}
            speed={1} glide={0} onUpdate={update} onRemove={() => onRemoveAutomationLane(route.id, id)} />
          <ToggleAutomationRail variant="sheet" steps={cfg.steps} loopRegion={loopRegion} speed={speed ?? 1} gridResolution={gridResolution}
            manualOn={deviceManualOn(cfg.paramTarget, { arp, granular, sidechain })}
            deviceLabel={spec?.label?.replace(' on/off', '') ?? 'Device'} color={route.color} started={started}
            inactive={!toggleTargetActive(cfg.paramTarget, { textureSupported: supportsGranular(synthType), sidechainSource: sidechain?.source }).active}
            onUpdate={update} />
          <p className="lsheet-hint">Follows this lane’s own loop window. Tap the upper half for on, the lower half for off.</p>
        </section>
      }
      return <section key={id} className="lsheet-group mauto-lane" role="group" aria-label={`Automation ${index + 1}`}>
        <h3>Automation {index + 1}</h3>
        <AutomationFields variant="sheet" instRoute={route} allRoutes={automationRoutes} synthType={synthType} adsr={adsr} filter={filter}
          granular={granular} activeFxTracks={activeFxTracks} sourceRouteId={cfg.sourceRouteId ?? ''} paramTarget={cfg.paramTarget}
          speed={cfg.speed ?? 1} glide={cfg.glide ?? 0} onUpdate={update} onRemove={() => onRemoveAutomationLane(route.id, id)} />
        <AutomationCurveEditor route={source} laneId={id} points={cfg.points} resolution={sourceResolutions?.[cfg.sourceRouteId]} region={region}
          spec={findTargetSpec(cfg.paramTarget, synthType)} onUpdate={update} visuals={autoVisuals} />
        {source && <><LoopRegionFields route={source} region={region} resolution={sourceResolutions?.[source.id]} onChange={next => update({ loopRegion: next })} />
          <button type="button" className="lsheet-action" onClick={() => update({ loopRegion: null })}>Reset to source</button>
          <p className="lsheet-hint">{cfg.loopRegion == null ? 'Following the source line’s loop window.' : 'Using this automation lane’s own loop window.'}</p></>}
      </section>
    })}
  </div>
}
