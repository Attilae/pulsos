'use client'

// Lets anything in the app open the sound-check panel, which is owned by
// MixerTab because it needs the live mix context (master fader, audible lane
// count) to say anything useful.
//
// Same module-level-registration shape as components/Dialog.jsx's imperative
// API — one mounted owner, everyone else just calls the opener.

let opener = null

/** MixerTab registers here on mount. Returns an unregister function. */
export function registerSoundCheck(fn) {
  opener = fn
  return () => { if (opener === fn) opener = null }
}

/** @param {'manual'|'auto'} trigger — where the request came from, for analytics. */
export function openSoundCheck(trigger = 'manual') {
  opener?.(trigger)
}

/** False before the Map tab has mounted; callers can hide their entry point. */
export function hasSoundCheck() { return opener != null }
