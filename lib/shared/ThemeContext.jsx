'use client'

import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'leid-theme'

const ThemeContext = createContext(null)

function readInitialTheme() {
  // Mirror the no-FOUC init script in app/layout.jsx: honour the stored
  // preference, else the OS setting, defaulting to dark.
  //
  // Storage comes before the <html data-theme> attribute: under React
  // StrictMode (dev) mount effects run twice, and by the second run the reflect
  // effect below has already written the initial 'dark' state onto <html>, so
  // reading the attribute first reset a saved light theme to dark on every load.
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
  }
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  } catch {}
  return 'dark'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('dark')

  // Sync from what the layout script already applied (client-only).
  useEffect(() => { setThemeState(readInitialTheme()) }, [])

  // Reflect every change onto <html> + persist it.
  useEffect(() => {
    try { document.documentElement.setAttribute('data-theme', theme) } catch {}
  }, [theme])

  const setTheme = (t) => {
    setThemeState(t)
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
  }
  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light')

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) return { theme: 'dark', setTheme: () => {}, toggleTheme: () => {} }
  return ctx
}
