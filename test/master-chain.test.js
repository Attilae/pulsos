import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MASTER_CHAIN_DEFAULTS, MASTER_CHAIN_SPECS, MASTER_CHAIN_STAGES,
  normalizeMasterChain, isDefaultMasterChain, masterChainForSnapshot,
} from '../lib/masterChain.js'

test('absent or junk input normalises to the defaults', () => {
  for (const raw of [undefined, null, 'x', 42, [], {}]) {
    assert.deepEqual(normalizeMasterChain(raw), { ...MASTER_CHAIN_DEFAULTS })
  }
})

test('every default sits inside its own range', () => {
  for (const spec of MASTER_CHAIN_SPECS) {
    const v = MASTER_CHAIN_DEFAULTS[spec.id]
    assert.ok(v >= spec.min && v <= spec.max, spec.id)
  }
})

test('values are clamped to range and non-numbers fall back', () => {
  const n = normalizeMasterChain({ airDb: 99, glueThresholdDb: -100, warmth: 'lots', enabled: 'no' })
  assert.equal(n.airDb, 4)
  assert.equal(n.glueThresholdDb, -36)
  assert.equal(n.warmth, MASTER_CHAIN_DEFAULTS.warmth)
  assert.equal(n.enabled, true)
})

test('snapshot form is sparse at the defaults and full otherwise', () => {
  assert.equal(masterChainForSnapshot(undefined), null)
  assert.equal(masterChainForSnapshot({ ...MASTER_CHAIN_DEFAULTS }), null)
  const edited = masterChainForSnapshot({ enabled: false })
  assert.equal(edited.enabled, false)
  assert.equal(edited.airDb, MASTER_CHAIN_DEFAULTS.airDb)
  assert.ok(!isDefaultMasterChain({ driveDb: 2 }))
})

test('every spec belongs to a listed stage', () => {
  const stages = new Set(MASTER_CHAIN_STAGES.map(s => s.id))
  for (const spec of MASTER_CHAIN_SPECS) assert.ok(stages.has(spec.stage), spec.id)
})
