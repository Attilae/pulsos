'use client'

import { track } from '@vercel/analytics'

export function trackProductEvent(name, properties = {}) {
  try {
    track(name, properties)
  } catch {
    // Analytics must never interrupt the instrument or audio engine.
  }
}
