import test from 'node:test'
import assert from 'node:assert/strict'
import { pairedOrigins } from '../lib/authOrigins.js'

test('apex URL also trusts its www twin', () => {
  assert.deepEqual(pairedOrigins(['https://layth.space']).sort(), [
    'https://layth.space', 'https://www.layth.space',
  ])
})

test('www URL also trusts its apex', () => {
  assert.deepEqual(pairedOrigins(['https://www.layth.space/']).sort(), [
    'https://layth.space', 'https://www.layth.space',
  ])
})

test('localhost, IPs, blanks and junk are not paired or crash', () => {
  assert.deepEqual(
    pairedOrigins(['http://localhost:3000', 'http://127.0.0.1:3000', '', undefined, 'not a url']),
    ['http://localhost:3000', 'http://127.0.0.1:3000'],
  )
})

test('ports survive pairing and duplicates collapse', () => {
  assert.deepEqual(
    pairedOrigins(['https://layth.space:8443', 'https://www.layth.space:8443']).sort(),
    ['https://layth.space:8443', 'https://www.layth.space:8443'],
  )
})
