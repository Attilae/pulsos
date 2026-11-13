'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import StartupPreloader from '@/components/StartupPreloader.jsx'

// Paint before the browser-only DAW downloads; stay until its routes render.
const App = dynamic(() => import('@/components/App.jsx'), {
  ssr: false,
  loading: () => null,
})

export default function Page() {
  const [ready, setReady] = useState(false)
  const [welcomeShown, setWelcomeShown] = useState(false)
  const onReady = useCallback(() => setReady(true), [])
  useEffect(() => {
    const timer = setTimeout(() => setWelcomeShown(true), 1800)
    return () => clearTimeout(timer)
  }, [])
  const loading = !ready || !welcomeShown
  return (
    <>
      {loading && <StartupPreloader />}
      <App onReady={onReady} startupReady={!loading} />
    </>
  )
}
