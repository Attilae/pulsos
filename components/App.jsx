import { useState, useEffect, useRef } from 'react'
import MixerTab         from './tabs/MixerTab.jsx'
import DrumMachineTab   from './tabs/DrumMachineTab.jsx'
import LoopCapturerTab  from './tabs/LoopCapturerTab.jsx'
import HeadphoneTab     from './tabs/HeadphoneTab.jsx'
import MotifTab         from './tabs/MotifTab.jsx'
import SongChainerTab   from './tabs/SongChainerTab.jsx'
import AuthControl      from './AuthControl.jsx'
import CitySelect       from './CitySelect.jsx'
import TourMenu         from './TourMenu.jsx'
import { CityProvider } from '@/lib/shared/CityContext.jsx'
import { DrumClipboardProvider } from '@/lib/shared/DrumClipboardContext.jsx'
import { DialogHost }   from './Dialog.jsx'
import { runProductTour } from '@/lib/tourSteps.js'
import { getTourStatus }  from '@/lib/tourState.js'
import './app.css'

const TABS = [
  { id: 'mixer',  label: 'Map',            Comp: MixerTab },
  { id: 'drums',  label: 'Drum Machine',  Comp: DrumMachineTab },
  { id: 'loops',  label: 'Loop Capturer', Comp: LoopCapturerTab },
  { id: 'phones', label: 'Headphone',     Comp: HeadphoneTab },
  { id: 'motif',  label: 'Motif',         Comp: MotifTab },
  { id: 'chain',  label: 'Song',          Comp: SongChainerTab },
]

export default function App() {
  const [tabId, setTabId] = useState('mixer')
  // Keep every tab we've visited mounted so its state + audio engine survive
  // tab switches (inactive panes are hidden with CSS, not unmounted). Lazily
  // seeded so we don't boot all engines/Leaflet up front.
  const [mounted, setMounted] = useState(() => new Set(['mixer']))
  const pendingTourRef = useRef(false)

  function openTab(id) {
    setMounted(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
    setTabId(id)
  }

  function startTour() {
    if (tabId !== 'mixer') { pendingTourRef.current = true; openTab('mixer') }
    else runProductTour()
  }

  useEffect(() => {
    if (pendingTourRef.current && tabId === 'mixer') {
      pendingTourRef.current = false
      const t = setTimeout(() => runProductTour(), 50)
      return () => clearTimeout(t)
    }
  }, [tabId])

  useEffect(() => {
    if (getTourStatus() == null) {
      const t = setTimeout(() => startTour(), 300)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <CityProvider>
      <DrumClipboardProvider>
      <div className="app-shell">
        <nav className="tab-bar">
          <h1
            className="app-title"
            title={'Leið (say "layth") — Icelandic for route, and for the way. In Reykjavík, every bus line is a leið. Here, so is every song.'}
          >
            Leið<span className="app-title-say">layth</span>
          </h1>
          <div className="tab-bar-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`tab-btn ${tabId === t.id ? 'active' : ''}`}
                onClick={() => openTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <CitySelect />
          <AuthControl />
          <TourMenu startTour={startTour} />
        </nav>
        <main className="tab-body">
          {TABS.filter(t => mounted.has(t.id)).map(t => (
            <div
              key={t.id}
              className="tab-pane"
              style={{ display: tabId === t.id ? undefined : 'none' }}
            >
              <t.Comp active={tabId === t.id} />
            </div>
          ))}
        </main>
        <DialogHost />
      </div>
      </DrumClipboardProvider>
    </CityProvider>
  )
}
