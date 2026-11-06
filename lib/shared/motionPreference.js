'use client'

// Reduce-motion preference for the map: the OS setting (prefers-reduced-motion)
// or a per-device opt-in ("Reduce motion" on the map). Effective reduction is
// either one; the opt-in can only add reduction, never undo the system's.
//
// Framework-free store + a useSyncExternalStore hook, so a change in system
// settings or in another tab applies live (no reload, no one-frame flash).

import { useSyncExternalStore } from 'react'
import { effectiveReducedMotion } from '../mapMotion.js'

const KEY = 'leid-reduce-motion'
const QUERY = '(prefers-reduced-motion: reduce)'
const listeners = new Set()
const emit = () => { for (const fn of listeners) fn() }

function readOs() {
  try { return !!window.matchMedia?.(QUERY).matches } catch { return false }
}
function readUser() {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

let mql = null
const onStorage = e => { if (e.key === KEY) emit() }
function subscribe(fn) {
  listeners.add(fn)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    try { mql = window.matchMedia?.(QUERY) ?? null } catch { mql = null }
    mql?.addEventListener?.('change', emit)
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(fn)
    if (!listeners.size && typeof window !== 'undefined') {
      mql?.removeEventListener?.('change', emit)
      window.removeEventListener('storage', onStorage)
      mql = null
    }
  }
}

// A string snapshot so useSyncExternalStore compares by value.
const snapshot = () => `${readOs() ? 1 : 0}${readUser() ? 1 : 0}`
const serverSnapshot = () => '00'

export function setUserReducedMotion(on) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {}
  emit()
}

/** → { reduced, osReduced, userReduced, setUserReduced } */
export function useMotionPreference() {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const osReduced = s[0] === '1'
  const userReduced = s[1] === '1'
  return { reduced: effectiveReducedMotion(osReduced, userReduced), osReduced, userReduced, setUserReduced: setUserReducedMotion }
}
