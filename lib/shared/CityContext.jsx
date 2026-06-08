'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { CITIES, DEFAULT_CITY_ID, getCityEntry } from './cities.js'

const STORAGE_KEY = 'leid.cityId'

const CityContext = createContext(null)

export function CityProvider({ children }) {
  const [cityId, setCityIdState] = useState(DEFAULT_CITY_ID)

  // Restore the last selection on mount (client-only; avoids SSR mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && getCityEntry(saved).id === saved) setCityIdState(saved)
    } catch {}
  }, [])

  const setCityId = (id) => {
    setCityIdState(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch {}
  }

  const value = {
    cityId,
    setCityId,
    cityEntry: getCityEntry(cityId),
    cities: CITIES,
  }

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>
}

export function useCitySelection() {
  const ctx = useContext(CityContext)
  if (!ctx) {
    // Allow use outside a provider (e.g. isolated tests) — fall back to default.
    return { cityId: DEFAULT_CITY_ID, setCityId: () => {}, cityEntry: getCityEntry(DEFAULT_CITY_ID), cities: CITIES }
  }
  return ctx
}
