'use client'
import { findTargetSpec } from '@/lib/engine.js'
import AutomationFields from '../../lane/AutomationFields.jsx'
import AutomationCurveEditor from '../AutomationCurveEditor.jsx'
import LoopRegionFields from './LoopRegionFields.jsx'
import { GroupHead } from './fields.jsx'

export default function AutoSegment({ ctx }) {
  const { route, synthType, adsr, filter, granular, activeFxTracks, automationLanes, automationRoutes = [], sourceRegions, sourceResolutions,
    onAddAutomationLane, onUpdateAutomationLane, onRemoveAutomationLane, autoVisuals } = ctx
  return <div className="lsheet-body">
    <GroupHead title="Automation" description="Use a line’s stops to move this lane’s controls. Source lines can still play their own notes." />
    <button type="button" className="lsheet-action" onClick={() => onAddAutomationLane(route.id)}>+ Automation</button>
    {!Object.keys(automationLanes ?? {}).length && <p className="lsheet-hint">Add an automation lane, then choose a source line and a target.</p>}
    {Object.entries(automationLanes ?? {}).map(([id, cfg], index) => {
      const source = automationRoutes.find(r => r.id === cfg.sourceRouteId)
      const region = cfg.loopRegion ?? sourceRegions?.[cfg.sourceRouteId]
      const update = patch => onUpdateAutomationLane(route.id, id, patch)
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
