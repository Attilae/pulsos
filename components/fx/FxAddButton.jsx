'use client'
import { FX_BUSES } from '@/lib/fxSpecs.js'

export default function FxAddButton({ activeFxTracks, onAdd }) {
  const available = FX_BUSES.filter(b => !activeFxTracks.includes(b.id))
  if (available.length === 0) return null

  return (
    <div className="fx-add-area">
      <select
        aria-label="Add FX bus"
        className="fx-add-select"
        value=""
        onChange={e => { if (e.target.value) onAdd(e.target.value) }}
      >
        <option value="">+ Add FX…</option>
        {available.map(bus => (
          <option key={bus.id} value={bus.id}>{bus.label}</option>
        ))}
      </select>
    </div>
  )
}
