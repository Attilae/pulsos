'use client'

// The Resonator DSP's load state ('idle' | 'loading' | 'ready' | 'error'), for
// the lane editors. Module-level in lib/resonatorLoader.js, so any component can
// read it without threading props through the DAW tree.
import { useSyncExternalStore } from 'react'
import { getResonatorStatus, subscribeResonatorStatus } from '../resonatorLoader.js'

export function useResonatorStatus() {
  return useSyncExternalStore(subscribeResonatorStatus, getResonatorStatus, () => 'idle')
}
