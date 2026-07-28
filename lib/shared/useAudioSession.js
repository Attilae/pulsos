'use client'

// React view of lib/audioSession.js. Kept in shared/ next to the other hooks;
// the audio session itself is framework-free so the engines can use it too.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, getServerSnapshot } from '../audioSession.js'

/**
 * Live audio-session status: { contextState, unlocked, sessionType, keepAlive, peakDb }.
 * Re-renders when the AudioContext suspends or resumes, which is exactly when
 * the transport bar needs to offer "tap to start audio".
 */
export function useAudioStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export default useAudioStatus
