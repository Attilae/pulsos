'use client'
import { normalizeLoopRegion, stepLoopEdge, loopGridSize } from '@/lib/loopRegionEdit.js'
import { snapStopsToGrid, GRID_TOTAL_CELLS, GRID_BARS } from '@/lib/mappings.js'
import { Field, GroupHead } from './fields.jsx'

export default function LoopRegionFields({ route, region, resolution, onChange }) {
  const r = normalizeLoopRegion(region)
  const total = loopGridSize(resolution)
  const stops = snapStopsToGrid(route.stops ?? [], route.totalDist, total, total / GRID_BARS)
  const same = n => n.startCell === r.startCell && n.endCell === r.endCell
  return <section className="lsheet-group lsheet-group--rhythm">
    <GroupHead title="Loop window" description="Select which stops repeat. The selected window starts immediately; it does not delay this lane." />
    <div className="lsheet-loop-strip" role="img" aria-label={`Loop window from ${r.startCell} to ${r.endCell} of ${GRID_TOTAL_CELLS}`}>
      <span className="lsheet-loop-window" style={{ left: `${r.startCell / GRID_TOTAL_CELLS * 100}%`, width: `${(r.endCell - r.startCell) / GRID_TOTAL_CELLS * 100}%` }} />
      {stops.map((stop, i) => <i key={i} className="lsheet-loop-stop" style={{ left: `${stop.cellIdx / total * 100}%` }} />)}
    </div>
    {['start', 'end'].map(edge => {
      const cell = edge === 'start' ? r.startCell : r.endCell
      const label = edge === 'start' ? 'Loop start' : 'Loop end'
      const down = stepLoopEdge(r, edge, -1, resolution)
      const up = stepLoopEdge(r, edge, 1, resolution)
      return <Field key={edge} label={label}>
        <div className="lsheet-stepper">
          <button type="button" disabled={same(down)} aria-label={`${label} down`} onClick={() => onChange(down)}>−</button>
          <span className="mono" aria-live="polite">{edge === 'start' ? Math.round(cell / GRID_TOTAL_CELLS * total) + 1 : Math.round(cell / GRID_TOTAL_CELLS * total)} / {total}</span>
          <button type="button" disabled={same(up)} aria-label={`${label} up`} onClick={() => onChange(up)}>+</button>
        </div>
      </Field>
    })}
    <button type="button" className="lsheet-action" onClick={() => onChange({ startCell: 0, endCell: GRID_TOTAL_CELLS })}>Full loop</button>
  </section>
}
