import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPOSITION_LIMITS, RECORD_ID_MAX, RECORD_NAME_MAX, SONG_LIMITS,
  checkJsonBounds, validateCompositionBody, validateRecordId, validateSongBody,
} from '../lib/storageLimits.js'
import { rateWindow, HOUR_MS } from '../lib/rateWindow.js'

test('an ordinary song snapshot passes and reports its size', () => {
  const state = {
    schemaVersion: 4, cityId: 'budapest', bpm: 120, routeIds: ['M1', 'M2'],
    trackPitchOffsets: { M1: { s1: 2 } }, drumPattern: { kick: Array(64).fill(0) },
  }
  const r = validateSongBody({ name: 'Song', schemaVersion: 4, state })
  assert.equal(r.ok, true)
  assert.equal(r.bytes, Buffer.byteLength(JSON.stringify(state)))
})

test('oversized, deep, wide or long-string songs are rejected', () => {
  const big = { blob: 'x'.repeat(SONG_LIMITS.maxStringLength) }
  const many = { a: Array.from({ length: 30 }, () => big) }
  assert.equal(validateSongBody({ state: many }).ok, false)

  let deep = {}
  const root = deep
  for (let i = 0; i < SONG_LIMITS.maxDepth + 1; i++) { deep.n = {}; deep = deep.n }
  assert.equal(validateSongBody({ state: root }).ok, false)

  assert.equal(validateSongBody({ state: { a: Array(SONG_LIMITS.maxArrayLength + 1).fill(0) } }).ok, false)
  assert.equal(validateSongBody({ state: { s: 'x'.repeat(SONG_LIMITS.maxStringLength + 1) } }).ok, false)
  assert.equal(validateSongBody({ state: [] }).ok, false)
  assert.equal(validateSongBody({ name: 'n'.repeat(RECORD_NAME_MAX + 1), state: {} }).ok, false)
})

test('upserts without state are bounded as an empty object', () => {
  assert.equal(validateSongBody({ name: 'x' }).ok, true)
})

test('compositions are bounded tighter than songs', () => {
  const item = { presetId: 'song_a', presetName: 'A', bars: 8, transition: 'cut' }
  assert.equal(validateCompositionBody({ name: 'C', items: [item], bpm: 120, cityId: 'berlin' }).ok, true)
  assert.equal(validateCompositionBody({ items: Array(COMPOSITION_LIMITS.maxArrayLength + 1).fill(item) }).ok, false)
  assert.equal(validateCompositionBody({ items: {} }).ok, false)
  assert.equal(validateCompositionBody({ items: [], bpm: 'fast' }).ok, false)
})

test('record ids are bounded', () => {
  assert.equal(validateRecordId('song_abc'), true)
  assert.equal(validateRecordId(''), false)
  assert.equal(validateRecordId('x'.repeat(RECORD_ID_MAX + 1)), false)
  assert.equal(validateRecordId(42), false)
})

test('checkJsonBounds rejects non-serializable values', () => {
  const cyclic = {}
  cyclic.self = cyclic
  assert.equal(checkJsonBounds(cyclic, SONG_LIMITS).ok, false)
})

test('rate windows bucket by time and lifetime budgets never expire', () => {
  const a = rateWindow('k', HOUR_MS, new Date('2026-10-21T10:05:00Z'))
  const b = rateWindow('k', HOUR_MS, new Date('2026-10-21T10:55:00Z'))
  const c = rateWindow('k', HOUR_MS, new Date('2026-10-21T11:00:00Z'))
  assert.equal(a.id, b.id)
  assert.notEqual(a.id, c.id)
  assert.equal(a.expiresAt.toISOString(), '2026-10-21T11:00:00.000Z')
  const life = rateWindow('k', null)
  assert.equal(life.id, 'k:lifetime')
  assert.ok(life.expiresAt.getUTCFullYear() > 9000)
})
