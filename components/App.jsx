import { useState } from 'react'
import MixerTab         from './tabs/MixerTab.jsx'
import DrumMachineTab   from './tabs/DrumMachineTab.jsx'
import LoopCapturerTab  from './tabs/LoopCapturerTab.jsx'
import HeadphoneTab     from './tabs/HeadphoneTab.jsx'
import MotifTab         from './tabs/MotifTab.jsx'
import AuthControl      from './AuthControl.jsx'
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
    <div className="app-shell">
      <nav className="tab-bar">
        <h1 className="app-title">Transit DAW</h1>
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
        <AuthControl />
      </nav>
      <main className="tab-body">
        <Active />
      </main>
      <DialogHost />
    </div>
  )
}
