import { useCallback, useEffect, useRef, useState } from 'react'
import { confirmDialog, promptDialog } from './Dialog.jsx'
import './SongMenu.css'

/**
 * Header dropdown for managing songs.
 *
 * Props mirror the return shape of useSongPersistence():
 *   currentSong, dirty, saving, saveError, autosaveOn, setAutosaveOn,
 *   songs, save, saveAs, rename, open, newSong, deleteSong
 */
export default function SongMenu({
  currentSong, dirty, saving, saveError, autosaveOn, setAutosaveOn,
  songs, save, saveAs, rename, open, newSong, deleteSong,
  share, unshare, shareUrl, signedIn,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [picker,   setPicker]   = useState(false)
  const [shareMsg, setShareMsg] = useState('')
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
  // Failures surface through the save indicator's saveError state, so swallow
  // the rejection here rather than letting it escape unhandled.
  const handleSave = useCallback(async () => {
    if (currentSong) save()?.catch(() => {})
    else {
      const name = await promptDialog('Name this song:', 'Untitled', { title: 'Save song', confirmLabel: 'Save' })
      if (name != null) saveAs(name)?.catch(() => {})
    }
  }, [currentSong, save, saveAs])

  const handleSaveAs = useCallback(async () => {
    const def = currentSong?.name ? `${currentSong.name} copy` : 'Untitled'
    const name = await promptDialog('Save as:', def, { title: 'Save as', confirmLabel: 'Save' })
    if (name != null) saveAs(name)?.catch(() => {})
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

  const handleNew = async () => {
    // The previous session is auto-saved on New — only warn signed-out users,
    // whose unsaved work can't be persisted.
    if (!signedIn && dirty && !(await confirmDialog(
      'You\'re signed out, so this session won\'t be saved. Start a new empty session anyway?',
      { title: 'Start new session?', confirmLabel: 'New session' },
    ))) return
    await newSong()
    setMenuOpen(false)
  }

  const handleRename = async () => {
    if (!currentSong) return
    const name = await promptDialog('Rename song:', currentSong.name, { title: 'Rename song', confirmLabel: 'Rename' })
    if (name != null && name.trim()) rename(name)?.catch(() => {})
    setMenuOpen(false)
  }

  const handleOpenSong = (id) => {
    open(id)
    setPicker(false)
    setMenuOpen(false)
  }

  const handleDeleteSong = async (id, name) => {
    if (!(await confirmDialog(`Delete "${name}"? This cannot be undone.`, {
      title: 'Delete song', confirmLabel: 'Delete', danger: true,
    }))) return
    deleteSong(id)
  }

  const copyLink = async (url) => {
    if (!url) return
    try { await navigator.clipboard.writeText(url); setShareMsg('Link copied to clipboard') }
    catch { setShareMsg(url) }
  }

  const handleShare = async () => {
    setShareMsg('Creating link…')
    const url = await share?.()
    if (url) copyLink(url)
    else setShareMsg('Save the song first to share it.')
  }

  const handleCopyShare = () => copyLink(shareUrl?.(currentSong?.shareId))

  const handleUnshare = async () => {
    await unshare?.()
    setShareMsg('Sharing disabled')
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
        <span className="song-menu-caret">▾</span>
      </button>

      <SaveIndicator
        currentSong={currentSong}
        dirty={dirty}
        saving={saving}
        saveError={saveError}
        autosaveOn={autosaveOn}
        signedIn={signedIn}
      />

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
          {currentSong && (
            currentSong.shareId ? (
              <>
                <button className="song-menu-item" onClick={() => { handleCopyShare() }}>
                  <span>Copy share link</span>
                  <span className="song-menu-count">shared</span>
                </button>
                <button className="song-menu-item" onClick={handleUnshare}>
                  <span>Stop sharing</span>
                </button>
              </>
            ) : (
              <button className="song-menu-item" onClick={handleShare}>
                <span>Share…</span>
              </button>
            )
          )}
          {shareMsg && <div className="song-menu-meta">{shareMsg}</div>}
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

/**
 * Header status pill: answers "is my work saved?" at a glance.
 * Precedence runs most- to least-urgent — a failure outranks an in-flight
 * write, which outranks a pending change.
 */
function SaveIndicator({ currentSong, dirty, saving, saveError, autosaveOn, signedIn }) {
  // "Saved 2m ago" has nothing to re-render it while the song sits idle, so
  // tick it ourselves — only while there is a settled timestamp to age.
  const idleSaved = !!currentSong && !dirty && !saving && !saveError
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!idleSaved) return
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [idleSaved])

  let tone = null, dot = null, text = null, title = null

  if (saveError) {
    tone = 'error'; dot = '▲'; text = 'Save failed'
    title = saveError.message || 'Could not save. Your changes are still here — try again.'
  } else if (saving) {
    tone = 'saving'; dot = '◌'; text = 'Saving…'
  } else if (dirty && !signedIn) {
    tone = 'dirty'; dot = '●'; text = 'Unsaved · sign in to save'
    title = 'Signed-out sessions can\'t be saved. Sign in to keep this work.'
  } else if (dirty && !currentSong) {
    tone = 'dirty'; dot = '●'; text = 'Unsaved'
    title = 'This session isn\'t attached to a song yet — Save As to keep it.'
  } else if (dirty && !autosaveOn) {
    tone = 'dirty'; dot = '●'; text = 'Unsaved'
    title = 'Autosave is off — press ⌘S to save.'
  } else if (dirty) {
    tone = 'dirty'; dot = '●'; text = 'Unsaved'
  } else if (currentSong) {
    text = `Saved ${formatRelative(currentSong.updatedAt)}`
  } else {
    return null
  }

  return (
    <span
      className={`song-save-indicator song-save-indicator--${tone ?? 'saved'}`}
      role="status"
      aria-live="polite"
      title={title ?? undefined}
    >
      {dot && <span className="song-save-dot" aria-hidden="true">{dot}</span>}
      {text}
    </span>
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
