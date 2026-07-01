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
  const pendingTourRef = useRef(false)
  const Active = TABS.find(t => t.id === tabId)?.Comp ?? MixerTab

  function startTour() {
    if (tabId !== 'mixer') { pendingTourRef.current = true; setTabId('mixer') }
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
                onClick={() => setTabId(t.id)}
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
          <Active />
        </main>
        <DialogHost />
      </div>
    </CityProvider>
  )
}
