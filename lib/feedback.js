// Pure validation + formatting for the feedback / bug-report form. Kept free of
// db, next and tone imports so `app/api/feedback/route.js` stays thin and this
// stays testable under `node --test` (test/feedback-validate.test.js), the same
// split as lib/ai/planApply.js and lib/billing/plans.js.
//
// Everything here re-derives its limits from the payload rather than trusting
// the client: the form is open to signed-out visitors, so the request body is
// entirely attacker-controlled.

export const FEEDBACK_KINDS = ['bug', 'idea', 'other']

// Stamped into the Turnstile token by the widget and re-checked at siteverify.
// Shared from here so the two sides cannot drift.
export const TURNSTILE_ACTION = 'feedback'

export const MESSAGE_MIN = 10
export const MESSAGE_MAX = 5000
export const EMAIL_MAX = 254

// Diagnostics the form attaches. Anything not listed is dropped rather than
// stored, so a crafted payload can't turn the context column into a dumping
// ground.
export const CONTEXT_KEYS = ['href', 'userAgent', 'cityId', 'viewport', 'plan']
export const CONTEXT_VALUE_MAX = 500

const KIND_LABELS = {
  bug: 'Bug report',
  idea: 'Feature idea',
  other: 'Feedback',
}

function str(value) {
  return typeof value === 'string' ? value : ''
}

function truncate(value, max) {
  const s = str(value).trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// Deliberately permissive: one @, something either side, no whitespace. Real
// deliverability is decided by the auto-reply actually arriving, not by a regex
// that rejects valid addresses.
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function normalizeContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out = {}
  for (const key of CONTEXT_KEYS) {
    const value = truncate(input[key], CONTEXT_VALUE_MAX)
    if (value) out[key] = value
  }
  return Object.keys(out).length ? out : null
}

// Returns { ok: true, value } or { ok: false, error }. `error` is a lowercase
// human-readable string, matching the convention in app/api/*.
export function normalizeFeedback(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid payload' }

  const rawKind = str(input.kind).trim().toLowerCase()
  const kind = FEEDBACK_KINDS.includes(rawKind) ? rawKind : 'other'

  const email = str(input.email).trim().toLowerCase()
  if (!email) return { ok: false, error: 'email is required' }
  if (email.length > EMAIL_MAX || !looksLikeEmail(email)) {
    return { ok: false, error: 'that email address does not look right' }
  }

  const message = str(input.message).trim()
  if (message.length < MESSAGE_MIN) {
    return { ok: false, error: `please write at least ${MESSAGE_MIN} characters` }
  }

  return {
    ok: true,
    value: {
      kind,
      email,
      message: message.slice(0, MESSAGE_MAX),
      context: normalizeContext(input.context),
    },
  }
}

export function feedbackKindLabel(kind) {
  return KIND_LABELS[kind] || KIND_LABELS.other
}

// The operator mail. Plain text on purpose — it is read in an inbox, and the
// diagnostics are easier to skim as a block than as a styled table.
export function formatFeedbackEmail(value, { serviceName = 'Leið', userId = null } = {}) {
  const lines = [
    `${feedbackKindLabel(value.kind)} from ${value.email}`,
    '',
    value.message,
    '',
    '—',
    `Account: ${userId ? userId : 'signed out'}`,
  ]
  if (value.context) {
    for (const key of CONTEXT_KEYS) {
      if (value.context[key]) lines.push(`${key}: ${value.context[key]}`)
    }
  }
  return {
    subject: `[${serviceName}] ${feedbackKindLabel(value.kind)}`,
    text: lines.join('\n'),
  }
}

// The submitter's confirmation. Quotes their message back so the mail is a
// usable record even if they never hear anything else.
export function formatFeedbackAutoReply(value, { serviceName = 'Leið' } = {}) {
  return {
    subject: `We got your ${value.kind === 'bug' ? 'bug report' : 'message'} — ${serviceName}`,
    text: [
      'Thanks — this landed with us and a human will read it.',
      '',
      'What you sent:',
      '',
      value.message,
      '',
      '—',
      `${serviceName}`,
    ].join('\n'),
  }
}
