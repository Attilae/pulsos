// Line picker modal for the Map/DAW tab. Lets the user deliberately choose which
// transit lines are lanes — instead of only re-rolling the random startup pick.
//
// Two modes, both driven by a `linePicker` payload assembled in DawView:
//   - 'add'    → pick a line to add as a new lane. Lines already in the mix are
//                shown disabled ("added"). `currentType` pre-selects a section.
//   - 'change' → swap the line backing an existing lane (`currentRouteId`),
//                keeping the lane's sound. Also offers "Remove this lane".
//
// The candidate list is the full lines.<city>.json route list (`allRoutes`);
// each route is { id, name, type, color, textColor, desc, stops:[…] }.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import './LinePicker.css'

const SECTIONS = [
  { type: 'metro',   label: 'Metro' },
  { type: 'tram',    label: 'Tram' },
  { type: 'trolley', label: 'Trolley' },
  { type: 'bus',     label: 'Bus' },
]

export default function LinePicker({
  mode = 'add',
  allRoutes = [],
  selectedIds,
  currentType = null,
  currentRouteId = null,
  onPick,
  onRemove,
  onClose,
}) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds ?? [])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState(currentType ?? 'all')

  // Esc closes.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Only routes with stops are playable (same guard the startup picker uses).
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = {}
    for (const { type } of SECTIONS) out[type] = []
    for (const r of allRoutes) {
      if (!r?.stops?.length || !out[r.type]) continue
      if (typeFilter !== 'all' && r.type !== typeFilter) continue
      if (q && !(`${r.name ?? ''} ${r.desc ?? ''}`.toLowerCase().includes(q))) continue
      out[r.type].push(r)
    }
    return out
  }, [allRoutes, query, typeFilter])

  const totalShown = SECTIONS.reduce((n, s) => n + grouped[s.type].length, 0)

  const pick = useCallback((route) => {
    if (mode === 'add' && selected.has(route.id)) return
    onPick?.(route)
  }, [mode, selected, onPick])

  const title = mode === 'change' ? 'Change line' : 'Add line'

  return createPortal(
    <div className="dlg-overlay" onMouseDown={onClose}>
      <div className="line-picker" onMouseDown={e => e.stopPropagation()}>
        <div className="line-picker-head">
          <h2 className="dlg-title">{title}</h2>
          <button className="line-picker-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="line-picker-controls">
          <input
            className="line-picker-search"
            type="text"
            placeholder="Search lines…"
            value={query}
            autoFocus
            onChange={e => setQuery(e.target.value)}
          />
          <div className="line-picker-types">
            <button
              className={`lp-type-chip ${typeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTypeFilter('all')}
            >All</button>
            {SECTIONS.map(({ type, label }) => (
              <button
                key={type}
                className={`lp-type-chip ${typeFilter === type ? 'active' : ''}`}
                onClick={() => setTypeFilter(type)}
              >{label}</button>
            ))}
          </div>
        </div>

        <div className="line-picker-list">
          {totalShown === 0 && <div className="line-picker-empty">No lines match.</div>}
          {SECTIONS.map(({ type, label }) => grouped[type].length > 0 && (
            <div key={type} className="line-picker-group">
              <div className="line-picker-group-label">{label}</div>
              {grouped[type].map(route => {
                const already = mode === 'add' && selected.has(route.id)
                const current = route.id === currentRouteId
                return (
                  <button
                    key={route.id}
                    className={`line-picker-row ${already ? 'is-added' : ''} ${current ? 'is-current' : ''}`}
                    onClick={() => pick(route)}
                    disabled={already}
                    title={already ? 'Already in the mix' : route.desc || route.name}
                  >
                    <span className="lp-badge" style={{ background: route.color, color: route.textColor }}>
                      {route.name}
                    </span>
                    <span className="lp-desc">{route.desc || ''}</span>
                    {already && <span className="lp-tag">added</span>}
                    {current && <span className="lp-tag lp-tag--current">current</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {mode === 'change' && onRemove && (
          <div className="line-picker-foot">
            <button className="line-picker-remove" onClick={onRemove}>Remove this lane</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
