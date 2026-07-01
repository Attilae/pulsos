// Persists whether the user has completed or skipped the onboarding tour,
// so it only auto-starts once. Mirrors the autosave-pref pattern in useSongPersistence.js.
const TOUR_STATUS_KEY = 'transit-daw:tourStatus'

export function getTourStatus() {
  try { return localStorage.getItem(TOUR_STATUS_KEY) } catch { return null }
}

export function setTourStatus(status) {
  try { localStorage.setItem(TOUR_STATUS_KEY, status) } catch {}
}
