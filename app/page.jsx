'use client'

// The DAW is a fully interactive, browser-only app (Tone.js + Leaflet + Web
// Audio). We load the whole shell client-side with ssr:false so none of that
// code is evaluated on the server.
//
// This used to be wrapped in a MobileGate that refused to render on touch
// devices. Phones now load the real app; components/FirstRunNotice.jsx sets
// expectations once instead of blocking.
import dynamic from 'next/dynamic'

const App = dynamic(() => import('@/components/App.jsx'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '100dvh', display: 'grid', placeItems: 'center',
      background: 'var(--bg)', color: 'var(--accent)',
      fontFamily: 'var(--font-mono)', letterSpacing: '0.14em',
    }}>
      LEIÐ — loading…
    </div>
  ),
})

export default function Page() {
  return <App />
}
