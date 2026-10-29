// Client-side checks and error copy for the sign-in / sign-up form
// (components/AuthControl.jsx). Pure, tested in test/auth-form-validation.test.js.
//
// Without these the form posted whatever was typed and showed Better Auth's raw
// schema error ("[body.email] Invalid email address") to the visitor.

import { looksLikeEmail } from './feedback.js'

// Better Auth's defaults (emailAndPassword.minPasswordLength/maxPasswordLength);
// lib/auth.js doesn't override them. Checked here so sign-up fails on the field
// rather than after a round trip.
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

// action: 'signin' | 'signup' | 'magic'. Returns { email?, password? }, one
// message per field that needs fixing; an empty object means the input is valid.
export function authFieldErrors(action, { email, password }) {
  const errors = {}
  const trimmed = (email ?? '').trim()
  if (!trimmed) errors.email = 'Enter your email address.'
  else if (!looksLikeEmail(trimmed)) errors.email = 'Enter a valid email address, like name@example.com.'
  if (action === 'magic') return errors
  if (!password) errors.password = 'Enter your password.'
  else if (action === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  } else if (action === 'signup' && password.length > MAX_PASSWORD_LENGTH) {
    errors.password = `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`
  }
  return errors
}

// The first field message, or null when valid.
export function validateAuthInput(action, input) {
  const errors = authFieldErrors(action, input)
  return errors.email ?? errors.password ?? null
}

// Turns a Better Auth client error into what the form shows. Errors about one
// field come back as { field, message } and render under that input; the rest
// are { title, message } for the notice above the buttons.
// EMAIL_NOT_VERIFIED is handled by the form itself (it switches to the
// check-your-inbox state), but still gets copy here for any other caller.
export function describeAuthError(error) {
  const code = error?.code
  const status = error?.status
  if (code === 'EMAIL_NOT_VERIFIED') {
    return { title: 'Confirm your email first', message: 'We just sent you a new confirmation link. Open it, then sign in.' }
  }
  if (code === 'INVALID_EMAIL_OR_PASSWORD') {
    return { title: 'Wrong email or password', message: 'Check both and try again, or email yourself a magic link instead.' }
  }
  if (code === 'PASSWORD_TOO_SHORT') return { field: 'password', message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  if (code === 'PASSWORD_TOO_LONG') return { field: 'password', message: `Use ${MAX_PASSWORD_LENGTH} characters or fewer.` }
  if (code === 'INVALID_EMAIL') return { field: 'email', message: 'Enter a valid email address, like name@example.com.' }
  if (status === 429) {
    return { title: 'Too many attempts', message: 'Wait a minute, then try again.' }
  }
  // The fetch never got an answer (offline, blocked), or the server fell over.
  if (!status || status >= 500) {
    return { title: 'Couldn’t reach Leið', message: 'Check your connection and try again.' }
  }
  const message = String(error?.message ?? '').replace(/^\[[^\]]*\]\s*/, '').trim()
  return { title: 'That didn’t work', message: message || 'Something went wrong. Please try again.' }
}
