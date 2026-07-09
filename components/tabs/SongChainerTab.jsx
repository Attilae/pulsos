import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TransitEngine } from '@/lib/engine.js'
import { setCityBounds } from '@/lib/mappings.js'
import { useRoutes, useCity } from '@/lib/shared/useRoutes.js'
import { useCitySelection } from '@/lib/shared/CityContext.jsx'
import { useSession } from '@/lib/auth-client.js'
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
  const signedIn = !!session?.user

  const engineRef = useRef(null)
  const playerRef = useRef(null)
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
    const song = await loadSong(presetId)
    cache.set(presetId, song)
    return song
  }, [])

  // ── Engine + player lifecycle ────────────────────────────────────────────
  useEffect(() => {
    const engine = new TransitEngine(() => {})
    engine.init()
    engineRef.current = engine

    const player = new SongChainPlayer(engine, null, loadSnapshot)
    player.onAdvance = (idx) => {
      setCurrentIndex(idx)
      if (idx === -1) { setPlaying(false); setProgress(0) }
    }
    player.onProgress = setProgress
    playerRef.current = player

    return () => { player.stop(); engine.dispose(); engineRef.current = null; playerRef.current = null }
  }, [loadSnapshot])

  // ── Push city bounds + routes into the engine/player ─────────────────────
  useEffect(() => {
    if (city?.bounds) setCityBounds(city.bounds)
    playerRef.current?.setRoutes(routes ?? [])
  }, [routes, city])

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
  useEffect(() => {
    if (!signedIn) { setPresets([]); setComps([]); return }
    listSongs().then(setPresets).catch(() => {})
    listCompositions().then(setComps).catch(() => {})
  }, [signedIn])

  const refreshComps = useCallback(() => {
    listCompositions().then(setComps).catch(() => {})
  }, [])

  // ── Chain editing ────────────────────────────────────────────────────────
  const addPreset = useCallback((p) => {
    setItems(prev => [...prev, {
      presetId: p.id, presetName: p.name,
      bars: DEFAULT_BARS, transition: 'cut', crossfadeBars: 1,
    }])
  }, [])

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
    if (!items.length) return
    p.setRoutes(routes ?? [])
    p.setChain(items, bpm)
    p.setLoop(loop)
    setPlaying(true)
    await p.play()
  }, [playing, items, bpm, loop, routes])

  // Keep a live player in sync while it's running (bpm/loop tweaks apply next section).
  useEffect(() => { playerRef.current?.setChain(items, bpm) }, [items, bpm])
  useEffect(() => { playerRef.current?.setLoop(loop) }, [loop])

  // ── Composition persistence ──────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!signedIn) return
    const id = currentCompId ?? newCompositionId()
    const saved = await saveComposition({ id, name, cityId, bpm, items })
    if (saved) {
      setCurrentCompId(saved.id)
      setLoadedCityId(saved.cityId ?? cityId)
      refreshComps()
    }
  }, [signedIn, currentCompId, name, cityId, bpm, items, refreshComps])

  const handleSaveAs = useCallback(async () => {
    if (!signedIn) return
    const id = newCompositionId()
    const saved = await saveComposition({ id, name: `${name} copy`, cityId, bpm, items })
    if (saved) {
      setCurrentCompId(saved.id)
      setName(saved.name)
      setLoadedCityId(saved.cityId ?? cityId)
      refreshComps()
    }
  }, [signedIn, name, cityId, bpm, items, refreshComps])

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
            <span className="chain-meta">{items.length} parts · {totalBars} bars</span>
          </div>

          {!items.length && (
            <div className="chain-empty">Add presets from the left to build your song.</div>
          )}

          <ol className="chain-items">
            {items.map((it, idx) => (
              <li
                key={`${it.presetId}-${idx}`}
                className={`chain-item ${currentIndex === idx ? 'playing' : ''}`}
              >
                <span className="chain-item-idx">{idx + 1}</span>
                <span className="chain-item-name">{it.presetName}</span>

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
