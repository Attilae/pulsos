'use client'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { automationPoints, automationPointAt, automationPointPatch, autoYToValue, nudgeAutoValue, automationKeyValue } from '@/lib/automationPoints.js'
import { denormalizeExp, denormalizeToRange } from '@/lib/mappings.js'
import { normalizeLoopRegion } from '@/lib/loopRegionEdit.js'

export default function AutomationCurveEditor({ route, laneId, points, resolution, region, spec, onUpdate, visuals }) {
  const stops = useMemo(() => automationPoints(route, laneId, points, resolution), [route, laneId, points, resolution])
  const [selectedId, setSelectedId] = useState(null)
  const selected = stops.find(p => p.id === selectedId) ?? stops[0]
  const root = useRef(null), needle = useRef(null), drag = useRef(null)
  const { startCell, endCell } = normalizeLoopRegion(region)
  useLayoutEffect(() => {
    const view = { needle: needle.current, dots: [...(root.current?.querySelectorAll('[data-stop-id]') ?? [])], last: -2 }
    visuals.current.set(laneId, view)
    return () => { if (visuals.current.get(laneId) === view) visuals.current.delete(laneId) }
  })
  const format = value => spec ? `${(spec.curve === 'exp' ? denormalizeExp(value, spec.min, spec.max) : denormalizeToRange(value, spec.min, spec.max)).toFixed(2)} ${spec.unit ?? ''}` : `${Math.round(value * 100)}%`
  const edit = (id, value) => onUpdate(automationPointPatch(points, id, value))
  const valueAt = event => { const r = root.current.getBoundingClientRect(); return autoYToValue((event.clientY - r.top) / r.height) }
  const endDrag = event => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  if (!route) return <p className="lsheet-hint">Choose a source line to edit its curve.</p>
  if (!selected) return <p className="lsheet-hint">This source has no stops.</p>
  return <div className="mauto-editor">
    <p className="lsheet-hint">Tap a stop’s column, then drag up or down. Use the stop picker and small steps for precise edits.</p>
    <div ref={root} className="mauto-curve" role="slider" tabIndex={0} aria-label="Selected automation point" aria-orientation="vertical"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(selected.value * 100)} aria-valuetext={`${selected.name}: ${format(selected.value)}`}
      onPointerDown={e => {
        if (e.button !== 0) return
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId)
        const r = root.current.getBoundingClientRect()
        const p = stops[automationPointAt(stops, (e.clientX - r.left) / r.width * 100)]
        drag.current = p.id; setSelectedId(p.id); edit(p.id, valueAt(e))
      }}
      onPointerMove={e => { if (drag.current) edit(drag.current, valueAt(e)) }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={e => {
        const next = automationKeyValue(selected.value, e.key, e.shiftKey)
        if (next == null) return
        e.preventDefault(); edit(selected.id, next)
      }}>
      <div className="mauto-window" style={{ left: `${startCell / 64 * 100}%`, width: `${(endCell - startCell) / 64 * 100}%` }} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={stops.map(p => `${p.x},${p.y}`).join(' ')} />
        {stops.map(p => <circle key={p.id} data-stop-id={p.id} data-selected={p.id === selected.id ? '' : undefined} cx={p.x} cy={p.y} r="1.5" />)}
      </svg>
      <div className="mauto-needle-track"><i ref={needle} hidden /></div>
    </div>
    <label className="lsheet-field"><span className="lsheet-label">Selected stop</span><select aria-label="Automation stop" value={selected.id} onChange={e => setSelectedId(e.target.value)}>
      {stops.map((p, i) => <option key={p.id} value={p.id}>{i + 1}. {p.name}</option>)}
    </select></label>
    <output className="mauto-value" aria-live="polite">{Math.round(selected.value * 100)}% · {format(selected.value)}</output>
    <div className="mauto-nudges">{[-.05, -.01, .01, .05].map(delta => <button type="button" className="lsheet-action" key={delta}
      aria-label={`${delta < 0 ? 'Decrease' : 'Increase'} point ${Math.abs(delta * 100)} percent`} onClick={() => edit(selected.id, nudgeAutoValue(selected.value, delta))}>{delta > 0 ? '+' : '−'}{Math.abs(delta * 100)}%</button>)}</div>
    <div className="lsheet-pair">
      <button type="button" className="lsheet-action" onClick={() => { const next = { ...points }; delete next[selected.id]; onUpdate({ points: next }) }}>Reset point</button>
      <button type="button" className="lsheet-action" onClick={() => onUpdate({ points: {} })}>Reset curve</button>
    </div>
  </div>
}
