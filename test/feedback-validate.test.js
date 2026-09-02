// Pure-logic coverage for lib/feedback.js. The feedback route is open to
// signed-out visitors, so every one of these cases is something an attacker
// can actually send.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeFeedback,
  normalizeContext,
  formatFeedbackEmail,
  formatFeedbackAutoReply,
  feedbackKindLabel,
  MESSAGE_MIN,
  MESSAGE_MAX,
  CONTEXT_VALUE_MAX,
} from '../lib/feedback.js'

const valid = {
  kind: 'bug',
  email: 'Someone@Example.com',
  message: 'The tram lane goes silent after switching cities.',
}

test('accepts a well-formed report and normalizes the email', () => {
  const res = normalizeFeedback(valid)
  assert.equal(res.ok, true)
  assert.equal(res.value.kind, 'bug')
  assert.equal(res.value.email, 'someone@example.com')
  assert.equal(res.value.message, valid.message)
  assert.equal(res.value.context, null)
})

test('falls back to "other" for an unknown or missing kind', () => {
  assert.equal(normalizeFeedback({ ...valid, kind: 'exploit' }).value.kind, 'other')
  assert.equal(normalizeFeedback({ ...valid, kind: undefined }).value.kind, 'other')
  assert.equal(normalizeFeedback({ ...valid, kind: '  IDEA ' }).value.kind, 'idea')
})

test('rejects a non-object payload', () => {
  for (const bad of [null, undefined, 'string', 42]) {
    assert.equal(normalizeFeedback(bad).ok, false)
  }
})

test('requires a plausible email', () => {
  assert.equal(normalizeFeedback({ ...valid, email: '' }).ok, false)
  assert.equal(normalizeFeedback({ ...valid, email: 'nope' }).ok, false)
  assert.equal(normalizeFeedback({ ...valid, email: 'a b@c.com' }).ok, false)
  assert.equal(normalizeFeedback({ ...valid, email: `${'a'.repeat(250)}@b.com` }).ok, false)
  assert.equal(normalizeFeedback({ ...valid, email: 'a+tag@sub.example.co.uk' }).ok, true)
})

test('enforces the message minimum after trimming', () => {
  assert.equal(normalizeFeedback({ ...valid, message: 'short' }).ok, false)
  const padded = { ...valid, message: `   ${'x'.repeat(MESSAGE_MIN - 1)}   ` }
  assert.equal(normalizeFeedback(padded).ok, false)
  const exact = normalizeFeedback({ ...valid, message: 'y'.repeat(MESSAGE_MIN) })
  assert.equal(exact.ok, true)
  assert.equal(exact.value.message.length, MESSAGE_MIN)
})

test('truncates an over-long message rather than rejecting it', () => {
  const res = normalizeFeedback({ ...valid, message: 'z'.repeat(MESSAGE_MAX + 500) })
  assert.equal(res.ok, true)
  assert.equal(res.value.message.length, MESSAGE_MAX)
})

test('a rejected input carries a usable error string', () => {
  const res = normalizeFeedback({ ...valid, message: 'no' })
  assert.equal(res.ok, false)
  assert.equal(typeof res.error, 'string')
  assert.ok(res.error.length > 0)
  assert.equal(res.value, undefined)
})

test('context keeps only whitelisted keys', () => {
  const ctx = normalizeContext({
    href: 'https://leid.app/feedback',
    userAgent: 'Mozilla/5.0',
    cityId: 'berlin',
    viewport: '390×844',
    plan: 'free',
    cookie: 'session=secret',
    __proto__: 'polluted',
  })
  assert.deepEqual(Object.keys(ctx).sort(), ['cityId', 'href', 'plan', 'userAgent', 'viewport'])
  assert.equal(ctx.cookie, undefined)
})

test('context truncates long values and drops empty ones', () => {
  const ctx = normalizeContext({ userAgent: 'u'.repeat(CONTEXT_VALUE_MAX + 100), href: '   ' })
  assert.equal(ctx.userAgent.length, CONTEXT_VALUE_MAX + 1) // + the ellipsis
  assert.ok(ctx.userAgent.endsWith('…'))
  assert.equal(ctx.href, undefined)
})

test('context is null when nothing survives or the input is not an object', () => {
  assert.equal(normalizeContext(null), null)
  assert.equal(normalizeContext(['href']), null)
  assert.equal(normalizeContext({ nope: 'x' }), null)
  assert.equal(normalizeContext({ href: '' }), null)
})

test('operator email carries the message, sender and diagnostics', () => {
  const value = normalizeFeedback({ ...valid, context: { cityId: 'berlin' } }).value
  const mail = formatFeedbackEmail(value, { serviceName: 'Leið', userId: 'user_1' })
  assert.ok(mail.subject.includes('Leið'))
  assert.ok(mail.subject.includes('Bug report'))
  assert.ok(mail.text.includes(value.message))
  assert.ok(mail.text.includes('someone@example.com'))
  assert.ok(mail.text.includes('user_1'))
  assert.ok(mail.text.includes('cityId: berlin'))
})

test('operator email says so when the sender was signed out', () => {
  const mail = formatFeedbackEmail(normalizeFeedback(valid).value, {})
  assert.ok(mail.text.includes('signed out'))
})

test('auto-reply quotes the message back', () => {
  const value = normalizeFeedback(valid).value
  const reply = formatFeedbackAutoReply(value, { serviceName: 'Leið' })
  assert.ok(reply.subject.includes('bug report'))
  assert.ok(reply.text.includes(value.message))
})

test('kind labels cover every kind and fall back safely', () => {
  assert.equal(feedbackKindLabel('bug'), 'Bug report')
  assert.equal(feedbackKindLabel('idea'), 'Feature idea')
  assert.equal(feedbackKindLabel('other'), 'Feedback')
  assert.equal(feedbackKindLabel('nonsense'), 'Feedback')
})
