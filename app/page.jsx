'use client'

// The DAW is a fully interactive, browser-only app (Tone.js + Leaflet + Web
// Audio). We load the whole shell client-side with ssr:false so none of that
// code is evaluated on the server.
import dynamic from 'next/dynamic'

const App = dynamic(() => import('@/components/App.jsx'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '100vh', display: 'grid', placeItems: 'center',
      background: '#0d0d0d', color: '#c8f040',
      fontFamily: "'Courier New', monospace", letterSpacing: '0.14em',
    }}>
      TRANSIT DAW — loading…
    </div>
  ),
})

export default function Page() {
  return <App />
}
