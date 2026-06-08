import { useState } from 'react'
import MixerTab         from './tabs/MixerTab.jsx'
import DrumMachineTab   from './tabs/DrumMachineTab.jsx'
import LoopCapturerTab  from './tabs/LoopCapturerTab.jsx'
import HeadphoneTab     from './tabs/HeadphoneTab.jsx'
import MotifTab         from './tabs/MotifTab.jsx'
import AuthControl      from './AuthControl.jsx'
import CitySelect       from './CitySelect.jsx'
import { CityProvider } from '@/lib/shared/CityContext.jsx'
import { DialogHost }   from './Dialog.jsx'
import './app.css'

const TABS = [
  { id: 'mixer',  label: 'Map',            Comp: MixerTab },
  { id: 'drums',  label: 'Drum Machine',  Comp: DrumMachineTab },
  { id: 'loops',  label: 'Loop Capturer', Comp: LoopCapturerTab },
  { id: 'phones', label: 'Headphone',     Comp: HeadphoneTab },
  { id: 'motif',  label: 'Motif',         Comp: MotifTab },
]

export default function App() {
  const [tabId, setTabId] = useState('mixer')
  const Active = TABS.find(t => t.id === tabId)?.Comp ?? MixerTab

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
        </nav>
        <main className="tab-body">
          <Active />
        </main>
        <DialogHost />
      </div>
    </CityProvider>
  )
}
