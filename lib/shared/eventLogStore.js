// Note-event feed shown in the DAW's Event Log panel.
//
// Kept outside React state on purpose: the engine fires an event per note, and
// holding the list in MixerTab state re-rendered MixerTab, DawView and every
// lane under it on each animation frame that had a note. Here only the log
// component subscribes, so a note burst re-renders one short list.
//
// Framework-free (like soundCheck.js); read it through useSyncExternalStore.

let events = []
const listeners = new Set()

function emit() {
  for (const fn of listeners) fn()
}

/** Prepend a batch (newest first) and keep at most `max` entries. */
export function pushEvents(batch, max) {
  if (!batch.length) return
  events = [...batch, ...events].slice(0, max)
  emit()
}

export function clearEvents() {
  if (!events.length) return
  events = []
  emit()
}

export function subscribeEvents(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getEvents() {
  return events
}
