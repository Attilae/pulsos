'use client'

// The Analog filter DSP's load state ('idle' | 'loading' | 'ready' | 'error'), for
// the filter panels. Module-level in lib/ladderLoader.js, so any component can
// read it without threading props through the DAW tree.
import { useSyncExternalStore } from 'react'
import { getLadderStatus, subscribeLadderStatus } from '../ladderLoader.js'

export function useLadderStatus() {
  return useSyncExternalStore(subscribeLadderStatus, getLadderStatus, () => 'idle')
}
