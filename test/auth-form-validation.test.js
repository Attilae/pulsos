import test from 'node:test'
import assert from 'node:assert/strict'
import { friendlyAuthError, validateAuthInput } from '../lib/authFormValidation.js'

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

test('server schema errors lose their field prefix', () => {
  assert.equal(friendlyAuthError({ message: '[body.email] Invalid email address' }), 'Invalid email address')
  assert.equal(friendlyAuthError({ message: 'Invalid email or password' }), 'Invalid email or password')
  assert.equal(friendlyAuthError({}), 'Something went wrong. Please try again.')
})
