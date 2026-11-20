import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerModalCompanion, getModalCompanion } from '../lib/shared/modalCompanion.js'

test('tour focus companions belong to one panel and release without disturbing other overlays', () => {
  const a = {}, b = {}, rootA = { isConnected: true }, rootB = { isConnected: true }, replacement = { isConnected: true }
  const clearA = registerModalCompanion(a, rootA, () => {})
  const clearB = registerModalCompanion(b, rootB, () => {})
  const clearReplacement = registerModalCompanion(a, replacement, () => {})
  try {
    assert.equal(getModalCompanion(a).root, replacement)
    assert.equal(getModalCompanion(b).root, rootB)
    replacement.isConnected = false
    assert.equal(getModalCompanion(a).root, rootA)
    clearA()
    assert.equal(getModalCompanion(a), undefined)
    assert.equal(getModalCompanion(b).root, rootB)
    assert.equal(getModalCompanion({}), undefined)
  } finally { clearA(); clearB(); clearReplacement() }
  assert.equal(getModalCompanion(b), undefined)
})
