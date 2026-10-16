import { Component, useState, useEffect, useRef } from 'react'
import dynamic          from 'next/dynamic'
import MixerTab         from './tabs/MixerTab.jsx'
// LoopCapturerTab, HeadphoneTab and MotifTab are kept but hidden from the menu (see TABS below).
// import LoopCapturerTab  from './tabs/LoopCapturerTab.jsx'
// import HeadphoneTab     from './tabs/HeadphoneTab.jsx'
// import MotifTab         from './tabs/MotifTab.jsx'
// The other tabs only mount on their first visit (see `mounted` below), so
// their code loads then too instead of with the Map/DAW startup.
const TabLoading = () => <div className="tab-loading" role="status">Loading…</div>
// A chunk fetch can fail transiently (network blip, or the edge firewall
// answering a script request with a 429 challenge), and next/dynamic caches the
// rejection for good. Webpack drops a failed chunk from its registry, so calling
// import() again refetches it; retry a few times before giving up.
async function importWithRetry(load, attempts = 3) {
  for (let i = 0; ; i++) {
    try { return await load() } catch (err) {
      if (i + 1 >= attempts) throw err
      await new Promise(r => setTimeout(r, 500 * 2 ** i))
    }
  }
}
const DrumMachineTab = dynamic(() => importWithRetry(() => import('./tabs/DrumMachineTab.jsx')), { ssr: false, loading: TabLoading })
const SongChainerTab = dynamic(() => importWithRetry(() => import('./tabs/SongChainerTab.jsx')), { ssr: false, loading: TabLoading })

// Contains a tab that fails to load or render, so one broken tab can't take
// down the whole app (and the Map tab's song with it). A failed lazy import
// stays failed in next/dynamic, so recovery is a reload.
class TabErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('[tab] failed to load', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="tab-loading" role="alert">
        <p>This tab couldn&rsquo;t load. Check your connection and reload the page.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
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

  // Tablist keyboard: arrows move between tabs (and select them, since
  // switching is instant), Home/End jump to the ends.
  function onTabKey(e) {
    const i = TABS.findIndex(t => t.id === tabId)
    let next = null
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length]
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length]
    else if (e.key === 'Home') next = TABS[0]
    else if (e.key === 'End') next = TABS[TABS.length - 1]
    if (!next) return
    e.preventDefault()
    openTab(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
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
        <header className="tab-bar">
          <h1
            className="app-title"
            data-tour="title"
            title={'Leið (say "layth"): Icelandic for route, and for the way. In Reykjavík, every bus line is a leið. Here, so is every song.'}
          >
            Leið<span className="app-title-say">layth</span>
          </h1>
          <div className="tab-bar-tabs" data-tour="tabs" role="tablist" aria-label="Views" onKeyDown={onTabKey}>
            {TABS.map(t => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                aria-selected={tabId === t.id}
                aria-controls={mounted.has(t.id) ? `tabpanel-${t.id}` : undefined}
                tabIndex={tabId === t.id ? 0 : -1}
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
        </header>
        <main className="tab-body">
          {TABS.filter(t => mounted.has(t.id)).map(t => (
            <div
              key={t.id}
              id={`tabpanel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`tab-${t.id}`}
              className="tab-pane"
              style={{ display: tabId === t.id ? undefined : 'none' }}
            >
              <TabErrorBoundary>
                <t.Comp active={tabId === t.id} />
              </TabErrorBoundary>
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
