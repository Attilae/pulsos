import test from 'node:test'
import assert from 'node:assert/strict'
import { linePickerProps } from '../lib/linePickerProps.js'

test('add picker preserves the catalogue and complete selected set, then closes after adding', () => {
  const allRoutes = [{ id: 'new' }]
  const selectedIds = new Set(['base', 'automation-source', 'copy'])
  const calls = []
  const p = linePickerProps({ prompt: { mode: 'add', type: 'tram' }, allRoutes, selectedIds,
    onAddLine: route => calls.push(['add', route]), onClose: () => calls.push(['close']) })
  assert.equal(p.allRoutes, allRoutes)
  assert.equal(p.selectedIds, selectedIds)
  assert.equal(p.currentType, 'tram')
  assert.equal(p.currentRouteId, null)
  assert.equal(p.onRemove, undefined)
  p.onPick(allRoutes[0])
  assert.deepEqual(calls, [['add', allRoutes[0]], ['close']])
})
test('change and remove dispatch the original lane id through the same handlers in both layouts', () => {
  const calls = []
  const picked = { id: 'replacement' }
  const p = linePickerProps({ prompt: { mode: 'change', type: 'bus', routeId: 'original' },
    onChangeLine: (...args) => calls.push(['change', ...args]),
    onRemoveLine: id => calls.push(['remove', id]), onClose: () => calls.push(['close']) })
  assert.equal(p.currentRouteId, 'original')
  assert.equal(p.currentType, 'bus')
  p.onPick(picked)
  p.onRemove()
  assert.deepEqual(calls, [['change', 'original', picked], ['close'], ['remove', 'original'], ['close']])
})
test('general add has no type filter; closing does not edit the song', () => {
  let closed = 0
  const p = linePickerProps({ prompt: { mode: 'add' }, onClose: () => closed++ })
  assert.deepEqual(p.allRoutes, [])
  assert.equal(p.currentType, null)
  p.onClose()
  assert.equal(closed, 1)
})
