import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLoopRegion, editLoopEdge, loopCellAtPointer, loopKeyCell, loopGridSize, stepLoopEdge } from '../lib/loopRegionEdit.js'

test('normalization keeps a nonempty canonical window and an explicit full reset', () => {
  assert.deepEqual(normalizeLoopRegion(), { startCell: 0, endCell: 64 })
  assert.deepEqual(normalizeLoopRegion({ startCell: -4, endCell: 99 }), { startCell: 0, endCell: 64 })
  assert.deepEqual(normalizeLoopRegion({ startCell: 64, endCell: -1 }), { startCell: 63, endCell: 64 })
  assert.deepEqual(normalizeLoopRegion({ startCell: NaN, endCell: Infinity }), { startCell: 0, endCell: 64 })
})
test('edges cannot cross or leave the loop', () => {
  const region = { startCell: 12, endCell: 32 }
  assert.deepEqual(editLoopEdge(region, 'start', 50), { startCell: 31, endCell: 32 })
  assert.deepEqual(editLoopEdge(region, 'end', -10), { startCell: 12, endCell: 13 })
  assert.deepEqual(editLoopEdge(region, 'start', -1), { startCell: 0, endCell: 32 })
  assert.deepEqual(editLoopEdge(region, 'end', 99), { startCell: 12, endCell: 64 })
  assert.deepEqual(editLoopEdge(region, 'start', 12), region)
  assert.deepEqual(editLoopEdge(region, 'start', NaN), region)
})
test('pointer positions retain desktop sixteenth snapping and reject zero-width rails', () => {
  assert.equal(loopCellAtPointer(150, 100, 100), 32)
  assert.equal(loopCellAtPointer(149, 100, 100), 31)
  assert.equal(loopCellAtPointer(0, 100, 100), 0)
  assert.equal(loopCellAtPointer(300, 100, 100), 64)
  assert.equal(loopCellAtPointer(100, 100, 0), null)
})
test('desktop keyboard increments and limits are preserved', () => {
  const r = { startCell: 12, endCell: 32 }
  assert.equal(loopKeyCell(r, 'start', 'ArrowRight'), 13)
  assert.equal(loopKeyCell(r, 'start', 'ArrowUp', true), 16)
  assert.equal(loopKeyCell(r, 'end', 'ArrowDown'), 31)
  assert.equal(loopKeyCell(r, 'end', 'ArrowLeft', true), 28)
  assert.equal(loopKeyCell(r, 'start', 'PageUp'), 28)
  assert.equal(loopKeyCell(r, 'end', 'PageDown'), 16)
  assert.equal(loopKeyCell(r, 'start', 'Home'), 0)
  assert.equal(loopKeyCell(r, 'end', 'Home'), 13)
  assert.equal(loopKeyCell(r, 'start', 'End'), 31)
  assert.equal(loopKeyCell(r, 'end', 'End'), 64)
  assert.equal(loopKeyCell(r, 'end', 'Tab'), null)
})
test('phone steps map each note grid to integer canonical positions', () => {
  for (const [rate, size, first] of [['4n',16,4],['8n',32,2],['8t',48,1],['16n',64,1],['16t',96,1],['32n',128,1]]) {
    assert.equal(loopGridSize(rate), size)
    assert.deepEqual(stepLoopEdge(null, 'start', 1, rate), { startCell:first, endCell:64 })
    let r = normalizeLoopRegion()
    let count = 0
    while (true) {
      const n = stepLoopEdge(r, 'start', 1, rate)
      assert.ok(Number.isInteger(n.startCell) && n.startCell < n.endCell)
      if (n.startCell === r.startCell) break
      assert.ok(n.startCell > r.startCell)
      r = n
      assert.ok(++count <= 64)
    }
    assert.deepEqual(stepLoopEdge(r,'start',1,rate),r)
    assert.deepEqual(stepLoopEdge(null,'end',1,rate),{startCell:0,endCell:64})
  }
})
test('phone stepping starts at the next grid boundary and never crosses a narrow window', () => {
  assert.deepEqual(stepLoopEdge({startCell:3,endCell:12},'start',1,'4n'),{startCell:4,endCell:12})
  assert.deepEqual(stepLoopEdge({startCell:3,endCell:4},'start',1,'4n'),{startCell:3,endCell:4})
  assert.deepEqual(stepLoopEdge({startCell:3,endCell:4},'end',-1,'4n'),{startCell:3,endCell:4})
  assert.deepEqual(stepLoopEdge({startCell:0,endCell:12},'end',-1,'4n'),{startCell:0,endCell:8})
})
