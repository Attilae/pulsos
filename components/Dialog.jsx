// App-wide modal dialogs that replace the browser's native alert/confirm/prompt.
//
// Promise-based imperative API so call sites read almost like the natives:
//   if (!(await confirmDialog('Delete?'))) return        // confirm  → boolean
//   const name = await promptDialog('Name:', 'Untitled')  // prompt   → string | null
//   await alertDialog('Saved.')                           // alert    → void
//
// Mount <DialogHost /> exactly once near the app root. The host renders into a
// portal on document.body so dialogs float above every overlay (e.g. the
// ProfilePanel, z-index 200) regardless of where the call originated.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Dialog.css'

// ── Imperative API ───────────────────────────────────────────────────────────

let enqueue = null  // set by the mounted DialogHost

function showDialog(opts) {
  return new Promise(resolve => {
    if (!enqueue) {
      // Host not mounted — fall back so we never silently swallow a flow.
      if (opts.kind === 'confirm') return resolve(window.confirm(opts.message))
      if (opts.kind === 'prompt')  return resolve(window.prompt(opts.message, opts.defaultValue ?? ''))
      window.alert(opts.message)
      return resolve(undefined)
    }
    enqueue({ ...opts, resolve })
  })
}

export function confirmDialog(message, opts = {}) {
  return showDialog({ kind: 'confirm', message, ...opts })
}

export function promptDialog(message, defaultValue = '', opts = {}) {
  return showDialog({ kind: 'prompt', message, defaultValue, ...opts })
}

export function alertDialog(message, opts = {}) {
  return showDialog({ kind: 'alert', message, ...opts })
}

// ── Host ─────────────────────────────────────────────────────────────────────

export function DialogHost() {
  const [queue, setQueue] = useState([])
  const current = queue[0] ?? null

  useEffect(() => {
    enqueue = (dialog) => setQueue(q => [...q, dialog])
    return () => { enqueue = null }
  }, [])

  const dismiss = useCallback((dialog, value) => {
    dialog.resolve(value)
    setQueue(q => q.slice(1))
  }, [])

  if (!current) return null
  return <Dialog key={queueKey(current)} dialog={current} onDismiss={dismiss} />
}

let _seq = 0
const _keys = new WeakMap()
function queueKey(dialog) {
  if (!_keys.has(dialog)) _keys.set(dialog, ++_seq)
  return _keys.get(dialog)
}

function Dialog({ dialog, onDismiss }) {
  const {
    kind, title, message, defaultValue = '',
    confirmLabel, cancelLabel, danger, inputType = 'text',
  } = dialog

  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef(null)
  const confirmRef = useRef(null)

  const isPrompt  = kind === 'prompt'
  const isConfirm = kind === 'confirm'
  const isAlert   = kind === 'alert'

  const cancel  = useCallback(() => onDismiss(dialog, isPrompt ? null : false), [dialog, isPrompt, onDismiss])
  const accept  = useCallback(() => onDismiss(dialog, isPrompt ? value : true), [dialog, isPrompt, value, onDismiss])

  // Focus the input (prompt) or the primary button (confirm/alert) on open.
  useEffect(() => {
    const t = setTimeout(() => {
      if (isPrompt && inputRef.current) { inputRef.current.focus(); inputRef.current.select() }
      else confirmRef.current?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [isPrompt])

  // Esc cancels everywhere.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [cancel])

  const onSubmit = (e) => { e.preventDefault(); accept() }

  const defaultConfirm = isPrompt ? 'OK' : isAlert ? 'OK' : 'Confirm'
  const defaultTitle   = isPrompt ? 'Enter a value' : isConfirm ? 'Are you sure?' : 'Notice'

  return createPortal(
    <div className="dlg-overlay" onMouseDown={isAlert || isConfirm || isPrompt ? cancel : undefined}>
      <form className="dlg-panel" onMouseDown={e => e.stopPropagation()} onSubmit={onSubmit}>
        <h2 className="dlg-title">{title ?? defaultTitle}</h2>
        {message && <p className="dlg-message">{message}</p>}

        {isPrompt && (
          <input
            ref={inputRef}
            className="dlg-input"
            type={inputType}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
        )}

        <div className="dlg-actions">
          {!isAlert && (
            <button type="button" className="dlg-btn dlg-btn--ghost" onClick={cancel}>
              {cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="submit"
            className={`dlg-btn ${danger ? 'dlg-btn--danger' : 'dlg-btn--primary'}`}
          >
            {confirmLabel ?? defaultConfirm}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
