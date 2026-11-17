import test from 'node:test'
import assert from 'node:assert/strict'
import { autoCtl } from '../lib/automationControl.js'

test('armed controls lock before playback, without inventing a live value', () => {
  assert.deepEqual(autoCtl({}, 'glide'), { disabled: false, display: null })
  assert.deepEqual(autoCtl({ glide: { value: null } }, 'glide'), { disabled: true, display: null })
})
test('envelope aliases lock the same control and glide converts milliseconds to seconds', () => {
  assert.deepEqual(autoCtl({ 'adsr.attack': { spec: { min: 0, max: 2 }, value: 0.25 } }, ['synth.attack', 'adsr.attack']), { disabled: true, display: 0.5 })
  assert.deepEqual(autoCtl({ glide: { spec: { min: 0, max: 1000 }, value: 0.5 } }, 'glide', { divide: 1000 }), { disabled: true, display: 0.5 })
})
test('exponential targets use the same conversion as the desktop rack', () => {
  const result = autoCtl({ 'filter.frequency': { spec: { min: 20, max: 20000, curve: 'exp' }, value: 0.5 } }, 'filter.frequency')
  assert.equal(result.disabled, true)
  assert.ok(Math.abs(result.display - Math.sqrt(20 * 20000)) < 1e-9)
})
