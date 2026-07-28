import { useState, useEffect, useRef } from 'react'
import MixerTab         from './tabs/MixerTab.jsx'
import DrumMachineTab   from './tabs/DrumMachineTab.jsx'
// LoopCapturerTab, HeadphoneTab and MotifTab are kept but hidden from the menu (see TABS below).
// import LoopCapturerTab  from './tabs/LoopCapturerTab.jsx'
// import HeadphoneTab     from './tabs/HeadphoneTab.jsx'
// import MotifTab         from './tabs/MotifTab.jsx'
import SongChainerTab   from './tabs/SongChainerTab.jsx'
import CitySelect       from './CitySelect.jsx'
import HeaderMenu       from './HeaderMenu.jsx'
import ThemeToggle      from './ThemeToggle.jsx'
import { CityProvider } from '@/lib/shared/CityContext.jsx'
import { ThemeProvider } from '@/lib/shared/ThemeContext.jsx'
import { DrumClipboardProvider } from '@/lib/shared/DrumClipboardContext.jsx'
import { EntitlementsProvider } from '@/lib/shared/EntitlementsContext.jsx'
import { DialogHost }   from './Dialog.jsx'
import FirstRunNotice, { hasSeenIntro } from './FirstRunNotice.jsx'
import { runProductTour } from '@/lib/tourSteps.js'
import { getTourStatus }  from '@/lib/tourState.js'
import { initAudioSession } from '@/lib/audioSession.js'
import { formFactor } from '@/lib/shared/platform.js'
import { trackProductEvent } from '@/lib/productAnalytics.js'
import { useIsPhone } from '@/lib/shared/useViewport.js'
import './app.css'
// After app.css: the responsive layer overrides it on equal specificity.
import './mobile.css'

const TABS = [
  { id: 'mixer',  label: 'Map',            Comp: MixerTab },
  { id: 'drums',  label: 'Drum Machine',  Comp: DrumMachineTab },
  // Loop Capturer, Headphone and Motif tabs are hidden from the menu but their
  // components/engines are kept intact — re-add the entries below to restore them.
  // { id: 'loops',  label: 'Loop Capturer', Comp: LoopCapturerTab },
  // { id: 'phones', label: 'Headphone',     Comp: HeadphoneTab },
  // { id: 'motif',  label: 'Motif',         Comp: MotifTab },
  { id: 'chain',  label: 'Song',          Comp: SongChainerTab },
]

export default function App() {
  const [tabId, setTabId] = useState('mixer')
  // Keep every tab we've visited mounted so its state + audio engine survive
  // tab switches (inactive panes are hidden with CSS, not unmounted). Lazily
  // seeded so we don't boot all engines/Leaflet up front.
  const [mounted, setMounted] = useState(() => new Set(['mixer']))
  const pendingTourRef = useRef(false)
  // The tour waits for the first-run notice: on a phone both would open at
  // once, and driver.js would anchor its popover behind the sheet.
  const [introDone, setIntroDone] = useState(() => hasSeenIntro())
  const isPhone = useIsPhone()

  function openTab(id) {
    setMounted(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
    setTabId(id)
  }

  function startTour() {
    if (tabId !== 'mixer') { pendingTourRef.current = true; openTab('mixer') }
    else runProductTour({ phone: isPhone })
  }

  useEffect(() => {
    if (pendingTourRef.current && tabId === 'mixer') {
      pendingTourRef.current = false
      const t = setTimeout(() => runProductTour({ phone: isPhone }), 50)
      return () => clearTimeout(t)
    }
  }, [tabId])

  useEffect(() => {
    if (!introDone) return undefined
    if (getTourStatus() == null) {
      const t = setTimeout(() => startTour(), 300)
      return () => clearTimeout(t)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introDone])

  // Install the audio lifecycle listeners (context resume on tab return) before
  // any engine exists, so a page restored from the bfcache is already watched.
  useEffect(() => {
    initAudioSession()
    const kind = formFactor()
    // desktop_app_viewed predates the mobile work — keep the series continuous.
    trackProductEvent(kind === 'desktop' ? 'desktop_app_viewed' : 'mobile_app_viewed', {
      form_factor: kind,
    })
  }, [])

  return (
    <ThemeProvider>
    <EntitlementsProvider>
    <CityProvider>
      <DrumClipboardProvider>
      <div className="app-shell">
        <nav className="tab-bar">
          <h1
            className="app-title"
            data-tour="title"
            title={'Leið (say "layth") — Icelandic for route, and for the way. In Reykjavík, every bus line is a leið. Here, so is every song.'}
          >
            Leið<span className="app-title-say">layth</span>
          </h1>
          <div className="tab-bar-tabs" data-tour="tabs">
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
          {/* On a phone these two don't fit beside the tabs, so the drawer
              hosts them instead — it's already the most touch-ready surface. */}
          {!isPhone && <CitySelect />}
          {!isPhone && <ThemeToggle />}
          <HeaderMenu startTour={startTour} showSessionControls={isPhone} />
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
        <FirstRunNotice onDismiss={() => setIntroDone(true)} />
        <DialogHost />
      </div>
      </DrumClipboardProvider>
    </CityProvider>
    </EntitlementsProvider>
    </ThemeProvider>
  )
}
