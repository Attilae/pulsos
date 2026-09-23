// Client-side checks for the sign-in / sign-up form (components/AuthControl.jsx).
// Pure, tested in test/auth-form-validation.test.js.
//
// Without these the form posted whatever was typed and showed Better Auth's raw
// schema error ("[body.email] Invalid email address") to the visitor.

import { looksLikeEmail } from './feedback.js'

// action: 'signin' | 'signup' | 'magic'. Returns a message, or null when valid.
export function validateAuthInput(action, { email, password }) {
  const trimmed = (email ?? '').trim()
  if (!trimmed) return 'Enter your email address.'
  if (!looksLikeEmail(trimmed)) return 'Enter a valid email address, like name@example.com.'
  if (action !== 'magic' && !password) return 'Enter your password.'
  return null
}

// Fallback for anything the server still rejects: drop the "[body.field] "
// prefix Better Auth puts on schema errors so the message reads as a sentence.
export function friendlyAuthError(error) {
  const message = String(error?.message ?? '').replace(/^\[[^\]]*\]\s*/, '').trim()
  return message || 'Something went wrong. Please try again.'
}
