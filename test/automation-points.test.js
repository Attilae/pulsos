import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automationKeyValue, automationPoints, autoValueToY, autoYToValue, automationPointAt, nudgeAutoValue, automationPointPatch, automationPlayPosition, activeAutomationPoint } from '../lib/automationPoints.js'
import { hashStopValue } from '../lib/mappings.js'

const route = { totalDist: 100, stops: [{ id: 'a', name: 'A', dist: 0 }, { id: 'b', name: 'B', dist: 50 }, { id: 'c', name: 'C', dist: 99 }] }
test('shared automation points retain authored zero, hash defaults and source grid placement', () => {
  const points = automationPoints(route, 'lane', { a: 0, b: .8 }, '16n')
  assert.equal(points[0].value, 0)
  assert.equal(points[1].value, .8)
  assert.equal(points[2].value, hashStopValue('lane', 'c'))
  assert.equal(points[0].y, 90)
  assert.equal(points[1].x, 50)
  assert.deepEqual(automationPoints(null, 'lane', {}), [])
})
test('padded Y conversion and nudges clamp at both edges', () => {
  for (const value of [0, .01, .5, .99, 1]) assert.ok(Math.abs(autoYToValue(autoValueToY(value) / 100) - value) < 1e-12)
  assert.equal(autoYToValue(-1), 1); assert.equal(autoYToValue(2), 0)
  assert.equal(nudgeAutoValue(.99, .05), 1); assert.equal(nudgeAutoValue(.01, -.05), 0)
  assert.equal(nudgeAutoValue(.3, .01), .31)
})
test('hit columns handle edges, close stops and duplicate grid cells', () => {
  const points = [{ x: 0 }, { x: 10 }, { x: 10 }, { x: 90 }]
  assert.equal(automationPointAt(points, -5), 0)
  assert.equal(automationPointAt(points, 6), 1)
  assert.equal(automationPointAt(points, 100), 3)
  assert.equal(automationPointAt([], 5), -1)
})
test('edits retain unrelated authored stops without mutating the saved curve', () => {
  const points = { a: .3, b: .8 }
  assert.deepEqual(automationPointPatch(points, 'a', 2), { points: { a: 1, b: .8 } })
  assert.equal(points.a, .3)
})
test('playback is rebased to the effective subloop at independent speed, with exclusive end', () => {
  const region = { startCell: 16, endCell: 32 }
  const points = [{ x: 0 }, { x: 25 }, { x: 30 }, { x: 50 }]
  assert.equal(automationPlayPosition(0, 120, 2, region), 25)
  assert.equal(automationPlayPosition(.5, 120, 2, region), 37.5)
  assert.equal(automationPlayPosition(1, 120, 2, region), 25)
  assert.equal(activeAutomationPoint(points, 25, region), 1)
  assert.equal(activeAutomationPoint(points, 49.9, region), 2)
  assert.equal(activeAutomationPoint(points, 24, region), -1)
})

test('desktop and touch keyboard edits share fine arrows, fixed pages and endpoint behavior', () => {
  assert.equal(automationKeyValue(.5, 'ArrowUp'), .55)
  assert.equal(automationKeyValue(.5, 'ArrowDown', true), .49)
  assert.equal(automationKeyValue(.5, 'PageUp', true), .75)
  assert.equal(automationKeyValue(.1, 'PageDown'), 0)
  assert.equal(automationKeyValue(.5, 'Home'), 0)
  assert.equal(automationKeyValue(.5, 'End'), 1)
  assert.equal(automationKeyValue(.5, 'Tab'), null)
})
