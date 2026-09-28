import { test } from 'node:test'
import assert from 'node:assert/strict'
import { floatToPcm16 } from '../lib/wavPcm.js'

test('without dither noise it rounds and scales symmetrically', () => {
  const still = () => 0.5                     // rand() - rand() = 0
  assert.equal(floatToPcm16(0, still), 0)
  assert.equal(floatToPcm16(1, still), 32767)
  assert.equal(floatToPcm16(-1, still), -32767)
  assert.equal(floatToPcm16(0.5, still), 16384)
})

test('out-of-range input and dither never overflow int16', () => {
  const hi = (() => { let t = true; return () => (t = !t) ? 0 : 0.999999 })()
  assert.equal(floatToPcm16(4, hi), 32767)
  assert.equal(floatToPcm16(-4, () => 0), -32767)
  for (let i = 0; i < 1000; i++) {
    const v = floatToPcm16(Math.random() * 2 - 1)
    assert.ok(Number.isInteger(v) && v >= -32768 && v <= 32767)
  }
})

test('dither decorrelates a sub-LSB signal: the average survives quantisation', () => {
  // 0.3 LSB rounds to 0 every time without dither; with TPDF the mean stays ≈ 0.3.
  const x = 0.3 / 32767
  let sum = 0
  const N = 200000
  for (let i = 0; i < N; i++) sum += floatToPcm16(x)
  assert.ok(Math.abs(sum / N - 0.3) < 0.02)
})
