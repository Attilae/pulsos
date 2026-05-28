import { useCallback, useEffect, useRef, useState } from 'react'
import './SongMenu.css'

/**
 * Header dropdown for managing songs.
 *
 * Props mirror the return shape of useSongPersistence():
 *   currentSong, dirty, autosaveOn, setAutosaveOn,
 *   songs, save, saveAs, rename, open, newSong, deleteSong
 */
export default function SongMenu({
  currentSong, dirty, autosaveOn, setAutosaveOn,
  songs, save, saveAs, rename, open, newSong, deleteSong,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [picker,   setPicker]   = useState(false)
  const rootRef = useRef(null)

  // Close menus on outside click + Esc
  useEffect(() => {
    function onDocClick(e) {
      if (!rootRef.current?.contains(e.target)) {
        setMenuOpen(false)
        setPicker(false)
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') { setMenuOpen(false); setPicker(false) }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // Keyboard shortcuts: Cmd/Ctrl+S → Save, Cmd/Ctrl+Shift+S → Save As
  const handleSave = useCallback(() => {
    if (currentSong) save()
    else {
      const name = window.prompt('Name this song:', 'Untitled')
      if (name != null) saveAs(name)
    }
  }, [currentSong, save, saveAs])

  const handleSaveAs = useCallback(() => {
    const def = currentSong?.name ? `${currentSong.name} copy` : 'Untitled'
    const name = window.prompt('Save as:', def)
    if (name != null) saveAs(name)
  }, [currentSong, saveAs])

  useEffect(() => {
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 's' && !e.shiftKey) { e.preventDefault(); handleSave() }
      else if (k === 's' && e.shiftKey) { e.preventDefault(); handleSaveAs() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave, handleSaveAs])

  const handleNew = () => {
    if (dirty && currentSong && !confirm('Discard unsaved changes to current song? (Your edits will remain on screen — they just won\'t be attached to a saved song until you Save As.)')) return
    newSong()
    setMenuOpen(false)
  }

  const handleRename = () => {
    if (!currentSong) return
    const name = window.prompt('Rename song:', currentSong.name)
    if (name != null && name.trim()) rename(name)
    setMenuOpen(false)
  }

  const handleOpenSong = (id) => {
    open(id)
    setPicker(false)
    setMenuOpen(false)
  }

  const handleDeleteSong = (id, name) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    deleteSong(id)
  }

  const label = currentSong?.name ?? 'Untitled (unsaved)'

  return (
    <div className="song-menu" ref={rootRef}>
      <button
        className={`song-menu-trigger ${dirty ? 'is-dirty' : ''}`}
        onClick={() => { setMenuOpen(o => !o); setPicker(false) }}
        title="Song menu (Cmd/Ctrl+S to save)"
      >
        <span className="song-menu-label">{label}</span>
        {dirty && <span className="song-menu-dirty" title="Unsaved changes">●</span>}
        <span className="song-menu-caret">▾</span>
      </button>

      {menuOpen && (
        <div className="song-menu-pop">
          <button className="song-menu-item" onClick={handleNew}>
            <span>New</span>
          </button>
          <button className="song-menu-item" onClick={() => { setPicker(p => !p) }}>
            <span>Open…</span>
            <span className="song-menu-count">{songs.length}</span>
          </button>
          <button className="song-menu-item" onClick={() => { handleSave(); setMenuOpen(false) }}>
            <span>Save</span>
            <span className="song-menu-kbd">⌘S</span>
          </button>
          <button className="song-menu-item" onClick={() => { handleSaveAs(); setMenuOpen(false) }}>
            <span>Save As…</span>
            <span className="song-menu-kbd">⇧⌘S</span>
          </button>
          {currentSong && (
            <button className="song-menu-item" onClick={handleRename}>
              <span>Rename…</span>
            </button>
          )}
          <div className="song-menu-sep" />
          <label className="song-menu-item song-menu-toggle">
            <span>Autosave</span>
            <input
              type="checkbox"
              checked={autosaveOn}
              onChange={e => setAutosaveOn(e.target.checked)}
              onClick={e => e.stopPropagation()}
            />
          </label>
          {currentSong && (
            <div className="song-menu-meta">
              Last saved {formatRelative(currentSong.updatedAt)}
            </div>
          )}
          <div className="song-menu-meta song-menu-note">
            Custom IR uploads must be re-loaded after refresh.
          </div>
        </div>
      )}

      {picker && (
        <div className="song-menu-picker">
          <div className="song-menu-picker-title">Open song</div>
          {songs.length === 0 && <div className="song-menu-empty">No saved songs yet.</div>}
          {songs.map(s => (
            <div key={s.id} className={`song-menu-row ${currentSong?.id === s.id ? 'is-current' : ''}`}>
              <button className="song-menu-row-open" onClick={() => handleOpenSong(s.id)}>
                <span className="song-menu-row-name">{s.name}</span>
                <span className="song-menu-row-date">{formatRelative(s.updatedAt)}</span>
              </button>
              <button
                className="song-menu-row-del"
                title="Delete"
                onClick={() => handleDeleteSong(s.id, s.name)}
              >✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatRelative(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
