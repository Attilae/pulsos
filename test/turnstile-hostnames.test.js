// Pure-logic coverage for the Turnstile hostname allowlist. `allowedHostnames`
// reads env at call time, so each case sets the vars it cares about and clears
// the rest — no network, no Cloudflare account.

import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedHostnames } from '../lib/turnstile.js'

const VARS = ['TURNSTILE_HOSTNAMES', 'NEXT_PUBLIC_APP_URL', 'BETTER_AUTH_URL']

function withEnv(vars, fn) {
  const saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]))
  for (const k of VARS) delete process.env[k]
  Object.assign(process.env, vars)
  try { return fn() } finally {
    for (const k of VARS) delete process.env[k]
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v
  }
}

test('derives the app hostname and always allows loopback', () => {
  const names = withEnv({ NEXT_PUBLIC_APP_URL: 'https://layth.space' }, allowedHostnames)
  assert.ok(names.has('layth.space'))
  assert.ok(names.has('localhost'))
  assert.ok(names.has('127.0.0.1'))
})

// The production failure: the app URL was the apex, the visitor was on www,
// and a genuine token was rejected.
test('accepts www when only the apex is configured', () => {
  const names = withEnv({ NEXT_PUBLIC_APP_URL: 'https://layth.space' }, allowedHostnames)
  assert.ok(names.has('www.layth.space'))
})

test('accepts the apex when only www is configured', () => {
  const names = withEnv({ NEXT_PUBLIC_APP_URL: 'https://www.layth.space' }, allowedHostnames)
  assert.ok(names.has('layth.space'))
  assert.ok(names.has('www.layth.space'))
})

test('pairs www for an explicit TURNSTILE_HOSTNAMES list too', () => {
  const names = withEnv({ TURNSTILE_HOSTNAMES: 'layth.space, example.test' }, allowedHostnames)
  assert.ok(names.has('www.layth.space'))
  assert.ok(names.has('www.example.test'))
})

test('an explicit list replaces the derived set rather than extending it', () => {
  const names = withEnv(
    { TURNSTILE_HOSTNAMES: 'layth.space', NEXT_PUBLIC_APP_URL: 'https://other.test' },
    allowedHostnames,
  )
  assert.ok(!names.has('other.test'))
  assert.ok(!names.has('localhost'))
})

test('does not invent a www variant for bare IPs or single labels', () => {
  const names = withEnv({ NEXT_PUBLIC_APP_URL: 'http://localhost:3002' }, allowedHostnames)
  assert.ok(!names.has('www.127.0.0.1'))
  assert.ok(!names.has('www.localhost'))
})

test('ignores a malformed app URL instead of throwing', () => {
  const names = withEnv({ NEXT_PUBLIC_APP_URL: 'not a url' }, allowedHostnames)
  assert.ok(names.has('localhost'))
  assert.equal(names.size, 2)
})

test('both app URLs contribute', () => {
  const names = withEnv(
    { NEXT_PUBLIC_APP_URL: 'https://a.test', BETTER_AUTH_URL: 'https://b.test' },
    allowedHostnames,
  )
  assert.ok(names.has('a.test'))
  assert.ok(names.has('b.test'))
})
