import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_PASSWORD_LENGTH,
  authFieldErrors,
  describeAuthError,
  validateAuthInput,
} from '../lib/authFormValidation.js'

test('missing or blank email is reported for every action', () => {
  for (const action of ['signin', 'signup', 'magic']) {
    assert.equal(validateAuthInput(action, { email: '', password: 'x' }), 'Enter your email address.')
    assert.equal(validateAuthInput(action, { email: '   ', password: 'x' }), 'Enter your email address.')
  }
})

test('malformed email is caught before the request', () => {
  assert.match(validateAuthInput('signin', { email: 'a', password: 'x' }), /valid email/)
  assert.match(validateAuthInput('magic', { email: 'a@b', password: '' }), /valid email/)
})

test('password is required except for a magic link', () => {
  assert.equal(validateAuthInput('signin', { email: 'a@b.co', password: '' }), 'Enter your password.')
  assert.equal(validateAuthInput('signup', { email: 'a@b.co', password: '' }), 'Enter your password.')
  assert.equal(validateAuthInput('magic', { email: 'a@b.co', password: '' }), null)
  assert.equal(validateAuthInput('signin', { email: ' a@b.co ', password: 'pw' }), null)
})

test('both fields are reported at once, each under its own key', () => {
  assert.deepEqual(authFieldErrors('signin', { email: '', password: '' }), {
    email: 'Enter your email address.',
    password: 'Enter your password.',
  })
  assert.deepEqual(authFieldErrors('magic', { email: 'a@b.co', password: '' }), {})
})

test('sign-up checks password length; sign-in leaves it to the server', () => {
  const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1)
  assert.match(authFieldErrors('signup', { email: 'a@b.co', password: short }).password, /at least 8/)
  assert.equal(authFieldErrors('signup', { email: 'a@b.co', password: 'x'.repeat(MIN_PASSWORD_LENGTH) }).password, undefined)
  assert.match(authFieldErrors('signup', { email: 'a@b.co', password: 'x'.repeat(129) }).password, /128/)
  assert.equal(authFieldErrors('signin', { email: 'a@b.co', password: short }).password, undefined)
})

test('field-level server errors are routed to their field', () => {
  assert.equal(describeAuthError({ code: 'PASSWORD_TOO_SHORT', status: 400 }).field, 'password')
  assert.equal(describeAuthError({ code: 'PASSWORD_TOO_LONG', status: 400 }).field, 'password')
  assert.equal(describeAuthError({ code: 'INVALID_EMAIL', status: 400 }).field, 'email')
})

test('wrong credentials, rate limits and outages read as sentences', () => {
  const wrong = describeAuthError({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'Invalid email or password' })
  assert.equal(wrong.field, undefined)
  assert.equal(wrong.title, 'Wrong email or password')
  assert.match(describeAuthError({ status: 429 }).title, /too many/i)
  assert.match(describeAuthError({}).title, /reach/i)
  assert.match(describeAuthError({ status: 502 }).title, /reach/i)
})

test('unknown server errors lose their field prefix', () => {
  assert.equal(describeAuthError({ status: 400, message: '[body.email] Invalid email address' }).message, 'Invalid email address')
  assert.equal(describeAuthError({ status: 400 }).message, 'Something went wrong. Please try again.')
})

test('an unverified password sign-in explains the new confirmation link', () => {
  const { title, message } = describeAuthError({ code: 'EMAIL_NOT_VERIFIED', status: 403, message: 'Email not verified' })
  assert.match(title, /confirm your email/i)
  assert.match(message, /new confirmation link/)
})
