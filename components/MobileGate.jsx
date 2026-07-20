'use client'

// Gates the DAW on touch devices: the full app (Tone.js + Leaflet + ~22 MB
// route data) is only rendered — and therefore only downloaded, thanks to
// next/dynamic — on desktop, or after the visitor explicitly opts in.
// Deliberately does NOT import app.css or anything from the DAW bundle.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { isMobileDevice } from '@/lib/shared/isMobileDevice.js'

const BYPASS_KEY = 'leid-mobile-bypass'

const shell = {
  height: '100vh', display: 'grid', placeItems: 'center',
  background: '#0d0d0d', color: '#c8f040',
  fontFamily: "'Courier New', monospace", letterSpacing: '0.14em',
  textAlign: 'center', padding: '0 24px',
}

export default function MobileGate({ children }) {
  // 'checking' until the first client effect runs (hydration-safe: the
  // server and first client render agree on the placeholder).
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let bypassed = false
    try { bypassed = sessionStorage.getItem(BYPASS_KEY) === '1' } catch {}
    setStatus(isMobileDevice() && !bypassed ? 'gated' : 'allowed')
  }, [])

  if (status === 'allowed') return children

  if (status === 'checking') {
    return <div style={shell}>TRANSIT DAW — loading…</div>
  }

  function tryAnyway() {
    try { sessionStorage.setItem(BYPASS_KEY, '1') } catch {}
    setStatus('allowed')
  }

  return (
    <div style={shell}>
      <div>
        <h1 style={{ fontSize: 42, margin: 0, fontWeight: 700 }}>
          Leið
          <span style={{ fontSize: 13, opacity: 0.55, marginLeft: 10, letterSpacing: '0.2em' }}>
            layth
          </span>
        </h1>
        <p style={{ fontSize: 15, textTransform: 'uppercase', margin: '28px 0 10px' }}>
          Mobile app coming soon
        </p>
        <p style={{ fontSize: 12, lineHeight: 1.8, opacity: 0.7, maxWidth: 420, margin: '0 auto' }}>
          Leið is a desktop instrument for now — please open it in a desktop
          browser for the full Map/DAW experience.
        </p>
        <button
          onClick={tryAnyway}
          style={{
            marginTop: 36, background: 'none', border: 'none', cursor: 'pointer',
            color: '#c8f040', opacity: 0.45, fontFamily: 'inherit',
            fontSize: 11, letterSpacing: '0.14em', textDecoration: 'underline',
            textUnderlineOffset: 4,
          }}
        >
          try it anyway →
        </button>
        <nav aria-label="Legal" style={{ marginTop: 30, fontSize: 10, letterSpacing: '0.1em' }}>
          <Link style={{ color: '#777', marginRight: 18 }} href="/privacy">privacy</Link>
          <Link style={{ color: '#777', marginRight: 18 }} href="/terms">terms</Link>
          <Link style={{ color: '#777' }} href="/licenses">licences</Link>
        </nav>
      </div>
    </div>
  )
}
