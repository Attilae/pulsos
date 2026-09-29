import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHAPER_SPAN, saturationCurve, clipperCurve } from '../lib/masterCurves.js'

// Curve index i covers input x = ((i/(len-1))*2 - 1) * SHAPER_SPAN.
function at(curve, x) {
  const i = Math.round(((x / SHAPER_SPAN + 1) / 2) * (curve.length - 1))
  return curve[i]
}

test('saturation is unity at low levels and only softens peaks', () => {
  const c = saturationCurve({ drive: 2, mix: 0.25 })
  assert.ok(Math.abs(at(c, 0.05) - 0.05) < 0.002)
  assert.ok(at(c, 1) < 1 && at(c, 1) > 0.85)
  assert.ok(Math.abs(at(c, 0)) < 1e-3)
})

test('saturation is symmetric (no DC offset) and monotonic', () => {
  const c = saturationCurve({ drive: 2, mix: 0.25 })
  for (let i = 0; i < c.length; i++) assert.ok(Math.abs(c[i] + c[c.length - 1 - i]) < 1e-6)
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1])
})

test('mix 0 is a straight line', () => {
  const c = saturationCurve({ drive: 3, mix: 0 })
  assert.ok(Math.abs(at(c, 0.7) - 0.7) < 0.002)
})

test('clipper is linear below the knee and never exceeds the ceiling', () => {
  const opts = { knee: 0.85, ceiling: 0.97 }
  const c = clipperCurve(opts)
  assert.ok(Math.abs(at(c, 0.5) - 0.5) < 0.002)
  assert.ok(Math.abs(at(c, -0.8) + 0.8) < 0.002)
  for (const v of c) assert.ok(Math.abs(v) <= opts.ceiling + 1e-6)
  assert.ok(at(c, SHAPER_SPAN) > 0.96)
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1])
})
