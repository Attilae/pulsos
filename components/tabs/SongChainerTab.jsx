import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TransitEngine } from '@/lib/engine.js'
import { setCityBounds } from '@/lib/mappings.js'
import { useRoutes, useCity } from '@/lib/shared/useRoutes.js'
import { useCitySelection } from '@/lib/shared/CityContext.jsx'
import { useSession } from '@/lib/auth-client.js'
import { useEntitlements } from '@/lib/shared/EntitlementsContext.jsx'
import { listSongs, loadSong } from '@/lib/persistence.js'
import {
  listCompositions, loadComposition, saveComposition, deleteComposition, newCompositionId,
} from '@/lib/compositions.js'
import { SongChainPlayer } from '@/lib/songChainPlayer.js'
import { confirmDialog } from '../Dialog.jsx'
import './SongChainerTab.css'

const DEFAULT_BARS = 8

export default function SongChainerTab({ active = true }) {
  const routes = useRoutes()
  const city   = useCity()
  const { cityId } = useCitySelection()
  const { data: session } = useSession()
  const { limits, isPro, openUpgrade } = useEntitlements()
  const signedIn = !!session?.user
  const itemLimit = limits.compositionItems

  const enginesRef = useRef(null)
  const playerRef  = useRef(null)
  const snapCacheRef = useRef(new Map())   // presetId → loaded song snapshot

  const [presets, setPresets] = useState([])     // user's saved presets (picker)
  const [comps,   setComps]   = useState([])     // user's saved compositions

  const [items, setItems] = useState([])         // the chain
  const [name,  setName]  = useState('Untitled song')
  const [bpm,   setBpm]   = useState(120)
  const [loop,  setLoop]  = useState(false)
  const [currentCompId, setCurrentCompId] = useState(null)
  const [loadedCityId,  setLoadedCityId]  = useState(null)

  const [playing, setPlaying] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [progress, setProgress] = useState(0)

  // ── Stable snapshot loader (cached) ──────────────────────────────────────
  const loadSnapshot = useCallback(async (presetId) => {
    const cache = snapCacheRef.current
    if (cache.has(presetId)) return cache.get(presetId)
    // Cache the in-flight promise, not the resolved song: the chain preloader and
    // the section-boundary loader routinely ask for the same preset at once.
    const pending = loadSong(presetId).catch((err) => { cache.delete(presetId); throw err })
    cache.set(presetId, pending)
    return pending
  }, [])

  // ── Engine + player lifecycle ────────────────────────────────────────────
  // Two engines, not one: SongChainPlayer builds each section on the idle engine
  // ahead of its boundary and hands off between them, which is what makes an item
  // swap gapless (a single engine has to tear its graph down before it can build
  // the next section, and that teardown+rebuild is the audible ~120ms hole).
  useEffect(() => {
    const engines = [new TransitEngine(() => {}), new TransitEngine(() => {})]
    for (const e of engines) e.init()
    enginesRef.current = engines

    const player = new SongChainPlayer(engines, null, loadSnapshot)
    player.onAdvance = (idx) => {
      setCurrentIndex(idx)
      if (idx === -1) { setPlaying(false); setProgress(0) }
    }
    player.onProgress = setProgress
    playerRef.current = player

    return () => {
      player.stop()
      for (const e of engines) e.dispose()
      enginesRef.current = null
      playerRef.current = null
    }
  }, [loadSnapshot])

  // ── Push city bounds + routes into the engine/player ─────────────────────
  useEffect(() => {
    if (city?.bounds) setCityBounds(city.bounds)
    playerRef.current?.setRoutes(routes ?? [])
  }, [routes, city])

  useEffect(() => {
    playerRef.current?.setActiveLaneLimit(limits.activeLanes)
  }, [limits.activeLanes])

  // ── Stop playback when the city changes ──────────────────────────────────
  useEffect(() => {
    playerRef.current?.stop()
    setPlaying(false); setCurrentIndex(-1); setProgress(0)
  }, [cityId])

  // ── Stop playback when this tab is hidden (component stays mounted) ───────
  useEffect(() => {
    if (active || !playing) return
    playerRef.current?.stop()
    setPlaying(false); setCurrentIndex(-1); setProgress(0)
  }, [active, playing])

  // ── Load the user's presets + compositions when signed in ────────────────
  // Refetched on every switch *into* this tab, not just on mount: the tab stays
  // mounted once visited (App.jsx toggles display:none), so a song saved in the
  // Map/DAW tab afterwards would otherwise never appear in the picker.
  useEffect(() => {
    if (!signedIn) { setPresets([]); setComps([]); return }
    if (!active) return
    listSongs().then(setPresets).catch(() => {})
    listCompositions().then(setComps).catch(() => {})
    // The list isn't the only stale thing — snapCacheRef holds the snapshot each
    // chain item plays, so an edited preset would keep playing its old contents.
    // Safe to drop while stopped (nothing is mid-handoff); preloadChain re-warms
    // the JSON, and the sample cache is process-wide so nothing is refetched.
    if (!playing) {
      snapCacheRef.current.clear()
      playerRef.current?.preloadChain()
    }
    // `playing` is read as a guard here, not a trigger — deliberately not a dep.
  }, [signedIn, active])

  const refreshComps = useCallback(() => {
    listCompositions().then(setComps).catch(() => {})
  }, [])

  // ── Chain editing ────────────────────────────────────────────────────────
  const addPreset = useCallback((p) => {
    setItems(prev => {
      if (itemLimit != null && prev.length >= itemLimit) {
        openUpgrade('composition_limit')
        return prev
      }
      return [...prev, {
        presetId: p.id, presetName: p.name,
        bars: DEFAULT_BARS, transition: 'cut', crossfadeBars: 1,
      }]
    })
  }, [itemLimit, openUpgrade])

  const updateItem = useCallback((idx, patch) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }, [])

  const removeItem = useCallback((idx) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const moveItem = useCallback((idx, dir) => {
    setItems(prev => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }, [])

  // ── Transport ────────────────────────────────────────────────────────────
  const handlePlayStop = useCallback(async () => {
    const p = playerRef.current
    if (!p) return
    if (playing) {
      p.stop(); setPlaying(false); setCurrentIndex(-1); setProgress(0)
      return
    }
    const playableItems = itemLimit == null ? items : items.slice(0, itemLimit)
    if (!playableItems.length) return
    p.setRoutes(routes ?? [])
    p.setChain(playableItems, bpm)
    p.setLoop(loop)
    setPlaying(true)
    await p.play()
  }, [playing, items, itemLimit, bpm, loop, routes])

  // Keep a live player in sync while it's running (bpm/loop tweaks apply next section).
  // Editing the chain is also the idle moment to warm it: preloadChain fetches each
  // item's snapshot and, more importantly, its samples, so the first section starts
  // audible instead of dropping notes while its Samplers download.
  useEffect(() => {
    playerRef.current?.setChain(itemLimit == null ? items : items.slice(0, itemLimit), bpm)
    playerRef.current?.preloadChain()
  }, [items, itemLimit, bpm])
  useEffect(() => { playerRef.current?.setLoop(loop) }, [loop])

  // ── Composition persistence ──────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!signedIn) return
    if (itemLimit != null && items.length > itemLimit) { openUpgrade('composition_limit'); return }
    const id = currentCompId ?? newCompositionId()
    const saved = await saveComposition({ id, name, cityId, bpm, items })
    if (saved) {
      setCurrentCompId(saved.id)
      setLoadedCityId(saved.cityId ?? cityId)
      refreshComps()
    }
  }, [signedIn, currentCompId, name, cityId, bpm, items, itemLimit, openUpgrade, refreshComps])

  const handleSaveAs = useCallback(async () => {
    if (!signedIn) return
    if (itemLimit != null && items.length > itemLimit) { openUpgrade('composition_limit'); return }
    const id = newCompositionId()
    const saved = await saveComposition({ id, name: `${name} copy`, cityId, bpm, items })
    if (saved) {
      setCurrentCompId(saved.id)
      setName(saved.name)
      setLoadedCityId(saved.cityId ?? cityId)
      refreshComps()
    }
  }, [signedIn, name, cityId, bpm, items, itemLimit, openUpgrade, refreshComps])

  const handleNew = useCallback(() => {
    playerRef.current?.stop()
    setPlaying(false); setCurrentIndex(-1); setProgress(0)
    setItems([]); setName('Untitled song'); setBpm(120)
    setCurrentCompId(null); setLoadedCityId(null)
  }, [])

  const handleOpen = useCallback(async (id) => {
    if (!id) return
    const comp = await loadComposition(id)
    if (!comp) return
    playerRef.current?.stop()
    setPlaying(false); setCurrentIndex(-1); setProgress(0)
    setItems(Array.isArray(comp.items) ? comp.items : [])
    setName(comp.name ?? 'Untitled song')
    setBpm(comp.bpm ?? 120)
    setCurrentCompId(comp.id)
    setLoadedCityId(comp.cityId ?? null)
  }, [])

  const handleDelete = useCallback(async (id) => {
    if (!id) return
    const ok = await confirmDialog('Delete this composition?')
    if (!ok) return
    await deleteComposition(id)
    if (id === currentCompId) handleNew()
    refreshComps()
  }, [currentCompId, handleNew, refreshComps])

  // ── Derived ──────────────────────────────────────────────────────────────
  const sortedPresets = useMemo(
    () => [...presets].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [presets],
  )

  const totalBars = useMemo(() => items.reduce((n, it) => n + (it.bars || 0), 0), [items])
  const cityMismatch = loadedCityId && loadedCityId !== cityId

  if (!routes) return <div className="tab-placeholder">Loading routes…</div>

  return (
    <div className="song-chainer-tab">
      <header className="chain-header">
        <h2 className="chain-title">Song</h2>
        <input
          className="chain-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Song name"
        />

        <div className="chain-field">
          <label>BPM</label>
          <input
            type="number" min="40" max="240"
            value={bpm}
            onChange={e => setBpm(Math.max(40, Math.min(240, +e.target.value || 120)))}
          />
        </div>

        <label className="chain-toggle">
          <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
          Loop
        </label>

        <button
          className={`chain-btn chain-btn--primary ${playing ? 'on' : ''}`}
          onClick={handlePlayStop}
          disabled={!items.length}
        >
          {playing ? '⏹ Stop' : '▶ Play'}
        </button>

        <div className="chain-menu">
          <button className="chain-btn" onClick={handleNew}>New</button>
          <button className="chain-btn" onClick={handleSave} disabled={!signedIn || !items.length}>Save</button>
          <button className="chain-btn" onClick={handleSaveAs} disabled={!signedIn || !currentCompId}>Save As</button>
          <select
            className="chain-open"
            value={currentCompId ?? ''}
            onChange={e => handleOpen(e.target.value)}
            disabled={!signedIn || !comps.length}
          >
            <option value="">Open…</option>
            {comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {currentCompId && (
            <button className="chain-btn chain-btn--danger" onClick={() => handleDelete(currentCompId)}>
              Delete
            </button>
          )}
        </div>
      </header>

      {!signedIn && (
        <div className="chain-notice">Sign in to load your presets and save songs.</div>
      )}
      {cityMismatch && (
        <div className="chain-notice chain-notice--warn">
          This song was made for a different city — its presets reference routes that
          aren't loaded now, so it may play silently. Switch back to the original city.
        </div>
      )}

      <div className="chain-body">
        {/* ── Preset picker ───────────────────────────────────────────────── */}
        <aside className="chain-picker">
          <h3 className="chain-subhead">Your presets</h3>
          {!sortedPresets.length && (
            <div className="chain-empty">{signedIn ? 'No saved presets yet.' : 'Sign in to see presets.'}</div>
          )}
          <ul className="chain-preset-list">
            {sortedPresets.map(p => (
              <li key={p.id}>
                <button className="chain-preset" onClick={() => addPreset(p)} title="Add to chain">
                  <span className="chain-preset-name">{p.name}</span>
                  <span className="chain-preset-add">+</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── Chain editor ────────────────────────────────────────────────── */}
        <section className="chain-list">
          <div className="chain-list-head">
            <h3 className="chain-subhead">Chain</h3>
            <span className="chain-meta">
              {items.length} parts · {totalBars} bars{!isPro && ` · ${itemLimit} free`}
            </span>
          </div>

          {!items.length && (
            <div className="chain-empty">Add presets from the left to build your song.</div>
          )}

          <ol className="chain-items">
            {items.map((it, idx) => (
              <li
                key={`${it.presetId}-${idx}`}
                className={`chain-item ${currentIndex === idx ? 'playing' : ''} ${itemLimit != null && idx >= itemLimit ? 'chain-item--locked' : ''}`}
              >
                <span className="chain-item-idx">{idx + 1}</span>
                <span className="chain-item-name">{it.presetName}</span>
                {itemLimit != null && idx >= itemLimit ? <button className="chain-pro-lock" onClick={() => openUpgrade('composition_limit')}>PRO</button> : null}

                <label className="chain-item-field">
                  bars
                  <input
                    type="number" min="1" max="64"
                    value={it.bars}
                    onChange={e => updateItem(idx, { bars: Math.max(1, Math.min(64, +e.target.value || 1)) })}
                  />
                </label>

                <label className="chain-item-field">
                  transition
                  <select
                    value={it.transition}
                    onChange={e => updateItem(idx, { transition: e.target.value })}
                  >
                    <option value="cut">cut</option>
                    <option value="crossfade">crossfade</option>
                  </select>
                </label>

                {it.transition === 'crossfade' && (
                  <label className="chain-item-field">
                    xfade bars
                    <input
                      type="number" min="1" max="16"
                      value={it.crossfadeBars ?? 1}
                      onChange={e => updateItem(idx, { crossfadeBars: Math.max(1, Math.min(16, +e.target.value || 1)) })}
                    />
                  </label>
                )}

                {currentIndex === idx && (
                  <span className="chain-item-progress" style={{ width: `${Math.round(progress * 100)}%` }} />
                )}

                <div className="chain-item-actions">
                  <button className="chain-icon" onClick={() => moveItem(idx, -1)} disabled={idx === 0} title="Move up">↑</button>
                  <button className="chain-icon" onClick={() => moveItem(idx, +1)} disabled={idx === items.length - 1} title="Move down">↓</button>
                  <button className="chain-icon chain-icon--danger" onClick={() => removeItem(idx)} title="Remove">✕</button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="chain-footer">
        Each part plays its preset for the set number of bars, then advances. Songs
        are tied to the city they were built in.
      </footer>
    </div>
  )
}
