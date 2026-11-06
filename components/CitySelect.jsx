'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCitySelection } from '@/lib/shared/CityContext.jsx'
import { useModal } from '@/lib/shared/useModal.js'
import { trackProductEvent } from '@/lib/productAnalytics.js'

// Manual switches ask how to begin; opening saved songs still switches directly.
export default function CitySelect() {
  const { cityId, setCityId, cities } = useCitySelection()
  const [target, setTarget] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const panelRef = useRef(null)
  const requestRef = useRef(0)
  const close = () => { requestRef.current++; setTarget(null); setLoading(false); setError(null) }
  useModal(!!target, panelRef, { onClose: close })

  const choose = async (usePreset) => {
    if (loading || !target) return
    const request = ++requestRef.current
    setError(null)
    setLoading(true)
    try {
      let preset = null
      if (usePreset) {
        const response = await fetch(`/presets/${target.id}.json`)
        if (!response.ok) throw new Error('Preset unavailable')
        preset = await response.json()
        if (preset.cityId !== target.id || preset.state?.cityId !== target.id || !preset.state?.routeIds?.length) {
          throw new Error('Invalid city preset')
        }
      }
      if (request !== requestRef.current) return
      trackProductEvent('city_selected', { city: target.id, start: usePreset ? 'preset' : 'scratch' })
      setCityId(target.id, preset)
      close()
    } catch {
      if (request !== requestRef.current) return
      setError('The city preset could not be loaded. Try again or start from scratch.')
      setLoading(false)
    }
  }

  return <>
    <label className="city-select" data-tour="city" title="Choose city">
      <span className="city-select-icon" aria-hidden="true">◎</span>
      <select className="city-select-input" value={cityId} aria-label="City" onChange={(e) => {
        if (e.target.value === cityId) return
        setError(null)
        setTarget(cities.find(c => c.id === e.target.value))
      }}>
        {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    {target && createPortal(
      <div className="city-start-backdrop" onClick={e => { if (e.target === e.currentTarget) close() }}>
        <section className="city-start-dialog" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="city-start-title" aria-describedby="city-start-description" aria-busy={loading}>
          <h2 id="city-start-title">Start in {target.name}</h2>
          <p id="city-start-description">Choose how to begin your next session.</p>
          <div className="city-start-options">
            <button type="button" disabled={loading} onClick={() => choose(false)}>
              <strong>Start from scratch</strong>
              <span>Pick your lines and build a new sound.</span>
            </button>
            <button type="button" className="city-start-preset" disabled={loading} onClick={() => choose(true)}>
              <strong>{loading ? 'Loading city preset…' : 'Load city preset'}</strong>
              <span>A ready-to-play mix of local transit lines.</span>
            </button>
          </div>
          {error && <p className="city-start-error" role="alert">{error}</p>}
          <button className="city-start-cancel" type="button" onClick={close}>Keep current city</button>
        </section>
      </div>, document.body,
    )}
  </>
}
