import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REFERENCE_CLOUD_MAX_BYTES, REFERENCE_CONTENT_TYPES, formatLoopSize, isOwnLoopPathname,
  loopContentType, loopExtension, loopLimitMessage, loopPathname, loopSlotsLeft, validateLoopMeta,
} from '../lib/referenceLoops.js'
import { FREE_LIMITS, PRO_LIMITS, SUPERADMIN_LIMITS } from '../lib/billing/plans.js'

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

test('plans store 3 loops on Free, 10 on Pro, unlimited for superadmin', () => {
  assert.equal(FREE_LIMITS.referenceLoops, 3)
  assert.equal(PRO_LIMITS.referenceLoops, 10)
  assert.equal(SUPERADMIN_LIMITS.referenceLoops, null)
})

test('extensions map to audio content types only', () => {
  assert.equal(loopExtension('Bass Loop.WAV'), 'wav')
  assert.equal(loopContentType('a.aif'), 'audio/aiff')
  assert.equal(loopContentType('a.mp3'), 'audio/mpeg')
  assert.equal(loopExtension('page.html'), '')
  assert.equal(loopContentType('noext'), null)
  assert.ok(REFERENCE_CONTENT_TYPES.every(t => t.startsWith('audio/')))
})

test('pathname is scoped to the user and the loop id', () => {
  assert.equal(loopPathname('user1', ID, 'loop.wav'), `loops/user1/${ID}.wav`)
  assert.equal(loopPathname('user1', 'short', 'loop.wav'), null)
  assert.equal(loopPathname('user1', ID, 'loop.exe'), null)
  assert.equal(loopPathname('', ID, 'loop.wav'), null)
})

test('isOwnLoopPathname accepts the user\'s upload with or without a suffix', () => {
  assert.ok(isOwnLoopPathname(`loops/user1/${ID}.wav`, 'user1', ID))
  assert.ok(isOwnLoopPathname(`loops/user1/${ID}-Ab12Cd34.wav`, 'user1', ID))
  assert.ok(!isOwnLoopPathname(`loops/user2/${ID}.wav`, 'user1', ID))
  assert.ok(!isOwnLoopPathname(`loops/user1/${ID}.html`, 'user1', ID))
  assert.ok(!isOwnLoopPathname(`loops/user1/${ID}/../x.wav`, 'user1', ID))
  assert.ok(!isOwnLoopPathname(`loops/user1/${ID}9999.wav`, 'user1', ID))
  assert.ok(!isOwnLoopPathname(null, 'user1', ID))
})

test('validateLoopMeta bounds id, name, size and duration', () => {
  const ok = validateLoopMeta({ id: ID, name: ' loop.wav ', bytes: 1000.4, durationSec: 8 })
  assert.deepEqual(ok, { ok: true, value: { id: ID, name: 'loop.wav', bytes: 1000, durationSec: 8 } })
  assert.equal(validateLoopMeta(null).ok, false)
  assert.equal(validateLoopMeta({ id: '../x', name: 'a.wav', bytes: 1 }).ok, false)
  assert.equal(validateLoopMeta({ id: ID, name: 'a.txt', bytes: 1 }).ok, false)
  assert.equal(validateLoopMeta({ id: ID, name: 'a.wav', bytes: 0 }).ok, false)
  const big = validateLoopMeta({ id: ID, name: 'a.wav', bytes: REFERENCE_CLOUD_MAX_BYTES + 1 })
  assert.equal(big.ok, false)
  assert.equal(big.code, 'too_large')
  assert.equal(validateLoopMeta({ id: ID, name: 'a.wav', bytes: 5, durationSec: 'x' }).value.durationSec, 0)
})

test('slots and limit copy', () => {
  assert.equal(loopSlotsLeft(2, 3), 1)
  assert.equal(loopSlotsLeft(5, 3), 0)
  assert.equal(loopSlotsLeft(100, null), Infinity)
  assert.match(loopLimitMessage(3, 'free'), /3 loops.*Pro/)
  assert.doesNotMatch(loopLimitMessage(10, 'pro'), /upgrade/i)
  assert.equal(formatLoopSize(3 * 1024 * 1024), '3.0 MB')
  assert.equal(formatLoopSize(2048), '2 KB')
})
