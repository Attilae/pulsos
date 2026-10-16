// The song open in the Map/DAW tab, and whether it has unsaved edits.
//
// The Song tab plays each chain item from its *saved* snapshot, so when the Map
// tab holds unsaved edits to one of those presets the user hears a version that
// isn't what they last heard. This is how the Song tab finds out, without
// threading MixerTab state up through App.jsx.
//
// Framework-free (like eventLogStore.js); read it through useSyncExternalStore.

const EMPTY = { id: null, dirty: false }

let current = EMPTY
const listeners = new Set()

/** Called by useSongPersistence whenever the open song or its dirty flag changes. */
export function setOpenSong(id, dirty) {
  const next = id ? { id, dirty: !!dirty } : EMPTY
  if (next.id === current.id && next.dirty === current.dirty) return
  current = next
  for (const fn of listeners) fn()
}

export function subscribeOpenSong(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getOpenSong() {
  return current
}
