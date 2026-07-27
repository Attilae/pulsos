'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// App-level shared channel for a drum pattern. "Send to Map" / "Add drums"
// establishes the link; after that, both tabs publish their edits here.
// Persisted to localStorage so the latest pattern survives a reload even before
// a song is saved. Shape: { patterns: {padId: number[64]}, offsets: {padId: int},
// muted: {padId: bool}, bpm: number } — or null when nothing has been sent.
const STORAGE_KEY = 'leid.drumClipboard'

const DrumClipboardContext = createContext(null)

export function DrumClipboardProvider({ children }) {
  const [pattern, setPatternState] = useState(null)

  // Restore the last sent pattern on mount (client-only; avoids SSR mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setPatternState(JSON.parse(saved))
    } catch {}
  }, [])

  const setPattern = useCallback((next) => {
    setPatternState(next)
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [])

  const value = useMemo(() => ({ pattern, setPattern }), [pattern, setPattern])

  return (
    <DrumClipboardContext.Provider value={value}>
      {children}
    </DrumClipboardContext.Provider>
  )
}

export function useDrumClipboard() {
  const ctx = useContext(DrumClipboardContext)
  // Allow use outside a provider (e.g. isolated tests) — no-op fallback.
  if (!ctx) return { pattern: null, setPattern: () => {} }
  return ctx
}
