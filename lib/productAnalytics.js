'use client'

import { track } from '@vercel/analytics'
import posthog from 'posthog-js'

const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
)

// Keep this focused on high-value product actions; Vercel continues to receive
// its broader operational and view-only signals through the same helper.
const posthogEventNames = new Set([
  'account_created',
  'ai_plan_applied',
  'ai_plan_generated',
  'city_selected',
  'city_preset_loaded',
  'drum_pattern_sent',
  'feedback_submitted',
  'magic_link_requested',
  'mcp_skill_download',
  'midi_exported',
  'playback_started',
  'reference_track_bpm_matched',
  'reference_track_loaded',
  'reference_track_upload_blocked',
  'sign_in_succeeded',
  'wav_exported',
])

export function trackProductEvent(name, properties = {}) {
  try {
    track(name, properties)
  } catch {
    // Each destination must remain independent and never interrupt playback.
  }
  try {
    if (isPostHogConfigured && posthogEventNames.has(name)) posthog.capture(name, properties)
  } catch {
    // Analytics must never interrupt the instrument or audio engine.
  }
}

export function captureProductException(error) {
  try {
    if (isPostHogConfigured) posthog.captureException(error)
  } catch {
    // Reporting an error must not break recovery.
  }
}
