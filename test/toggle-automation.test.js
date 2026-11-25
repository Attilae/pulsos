import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TOGGLE_TARGETS, isToggleTarget, toggleDeviceOf, normalizeToggleSteps, toggleWindow,
  toggleStateAtCell, toggleStateAtPhase, toggleSegments, toggleTransitions,
  snapToggleCell, toggleSnapSize, setToggleStep, deleteToggleStep, moveToggleStep,
  toggleTargetActive, toggleLanesByDevice,
} from '../lib/toggleAutomation.js'

const FULL = { startCell: 0, endCell: 64 }

test('targets are recognised by id and map to a device', () => {
  assert.equal(TOGGLE_TARGETS.length, 3)
  assert.ok(isToggleTarget('device.arp'))
  assert.ok(!isToggleTarget('volume'))
  assert.ok(!isToggleTarget('grain.mix'))
  assert.equal(toggleDeviceOf('device.sidechain'), 'sidechain')
  assert.equal(toggleDeviceOf('volume'), null)
})

test('normalisation rounds, bounds, dedupes (last wins) and sorts', () => {
  const steps = normalizeToggleSteps([
    { cell: 32.4, on: 1 }, { cell: 8, on: true }, { cell: -1, on: true }, { cell: 64, on: true },
    { cell: 8, on: false }, null, { cell: 'x' }, { cell: 16 },
  ])
  assert.deepEqual(steps, [{ cell: 8, on: false }, { cell: 16, on: false }, { cell: 32, on: true }])
  assert.deepEqual(normalizeToggleSteps(null), [])
  assert.deepEqual(normalizeToggleSteps({}), [])
})

test('state holds from each step and wraps round the loop', () => {
  const steps = [{ cell: 16, on: true }, { cell: 48, on: false }]
  assert.equal(toggleStateAtCell(steps, 0, FULL), false)   // wraps from cell 48 (off)
  assert.equal(toggleStateAtCell(steps, 16, FULL), true)
  assert.equal(toggleStateAtCell(steps, 15.99999, FULL), true)   // within epsilon of the step
  assert.equal(toggleStateAtCell(steps, 47.5, FULL), true)
  assert.equal(toggleStateAtCell(steps, 63, FULL), false)
  assert.equal(toggleStateAtCell([{ cell: 10, on: true }], 0, FULL), true)   // single step = constant
})

test('no step inside the loop window falls back to the manual setting', () => {
  const steps = [{ cell: 40, on: true }]
  assert.equal(toggleStateAtCell([], 5, FULL, true), true)
  assert.equal(toggleStateAtCell(steps, 5, { startCell: 0, endCell: 32 }, false), false)
  assert.equal(toggleStateAtCell(steps, 5, { startCell: 0, endCell: 32 }, true), true)
  // A window that only sees part of the steps wraps within itself.
  const two = [{ cell: 4, on: true }, { cell: 40, on: false }]
  assert.equal(toggleStateAtCell(two, 2, { startCell: 0, endCell: 32 }), true)
})

test('phase lookup maps onto the window', () => {
  const steps = [{ cell: 20, on: true }, { cell: 24, on: false }]
  const win = { startCell: 16, endCell: 32 }
  assert.equal(toggleStateAtPhase(steps, 0, win), false)
  assert.equal(toggleStateAtPhase(steps, 0.25, win), true)    // cell 20
  assert.equal(toggleStateAtPhase(steps, 0.5, win), false)    // cell 24
  assert.equal(toggleStateAtPhase(steps, 1.25, win), true)    // phase wraps
})

test('segments cover the window and merge equal neighbours', () => {
  const steps = [{ cell: 0, on: true }, { cell: 8, on: true }, { cell: 16, on: false }, { cell: 32, on: true }]
  assert.deepEqual(toggleSegments(steps, FULL), [
    { startCell: 0, endCell: 16, on: true },
    { startCell: 16, endCell: 32, on: false },
    { startCell: 32, endCell: 64, on: true },
  ])
  assert.deepEqual(toggleSegments([], FULL, true), [{ startCell: 0, endCell: 64, on: true }])
  assert.deepEqual(toggleTransitions(steps, FULL), [
    { phase: 0, on: true }, { phase: 0.25, on: false }, { phase: 0.5, on: true },
  ])
})

test('the window is clamped like the engine clamps loop regions', () => {
  assert.deepEqual(toggleWindow(null), FULL)
  assert.deepEqual(toggleWindow({ startCell: 70, endCell: 2 }), { startCell: 63, endCell: 64 })
})

test('snapping follows the lane grid resolution', () => {
  assert.equal(toggleSnapSize('16n'), 1)
  assert.equal(toggleSnapSize('8n'), 2)
  assert.equal(toggleSnapSize('4n'), 4)
  assert.equal(toggleSnapSize('32n'), 1)
  assert.equal(toggleSnapSize('8t'), 1)
  assert.equal(snapToggleCell(5.4, '4n'), 4)
  assert.equal(snapToggleCell(6.1, '4n'), 8)
  assert.equal(snapToggleCell(63.9, '4n'), 63)
  assert.equal(snapToggleCell(-3, '16n'), 0)
})

test('edits return new arrays: add/replace, delete, move clamped by neighbours', () => {
  const base = [{ cell: 8, on: true }, { cell: 24, on: false }]
  const added = setToggleStep(base, 16, true)
  assert.notEqual(added, base)
  assert.deepEqual(added.map(s => s.cell), [8, 16, 24])
  assert.deepEqual(setToggleStep(base, 8, false)[0], { cell: 8, on: false })
  assert.deepEqual(deleteToggleStep(base, 8), [{ cell: 24, on: false }])
  assert.deepEqual(moveToggleStep(base, 8, 40), [{ cell: 23, on: true }, { cell: 24, on: false }])
  assert.deepEqual(moveToggleStep(base, 24, 2, true), [{ cell: 8, on: true }, { cell: 9, on: true }])
  assert.deepEqual(moveToggleStep(base, 24, 100), [{ cell: 8, on: true }, { cell: 63, on: false }])
  assert.deepEqual(moveToggleStep(base, 99, 3), base)
})

test('availability: texture needs a host, sidechain needs a source', () => {
  assert.equal(toggleTargetActive('device.arp').active, true)
  assert.equal(toggleTargetActive('device.texture', { textureSupported: false }).active, false)
  assert.equal(toggleTargetActive('device.texture', { textureSupported: true }).active, true)
  assert.equal(toggleTargetActive('device.sidechain', { sidechainSource: '' }).active, false)
  assert.equal(toggleTargetActive('device.sidechain', { sidechainSource: '__drums__' }).active, true)
})

test('lanes merge into one step list per device', () => {
  const lanes = {
    a: { paramTarget: 'volume', points: {} },
    b: { paramTarget: 'device.arp', steps: [{ cell: 4, on: true }] },
    c: { paramTarget: 'device.sidechain', steps: 'bad' },
  }
  assert.deepEqual(toggleLanesByDevice(lanes), { arp: [{ cell: 4, on: true }], sidechain: [] })
})
