import { Children, useLayoutEffect, useRef, useState } from 'react'

// Masonry columns for the device rack, with a layout that stays put.
//
// This used to be CSS multi-column (`columns: 248px`), which rebalances on every
// height change: switching a card's mode (Filter Classic ⇄ Analog, Texture
// Classic ⇄ Mk II) resized one card and reflowed every card after it into a
// different column, under the pointer. Here the cards are split into columns
// once — in reading order, balanced by measured height, as multicol did — and a
// card that later grows or shrinks only lengthens its own column. The split is
// redone only when the column count, the set of cards, or `layoutKey` (a change
// big enough to be worth a reflow, like the lane's instrument) changes.

const MIN_COLUMN_PX = 248
const GAP_PX = 8

function columnCount(width) {
  return Math.max(1, Math.floor((width + GAP_PX) / (MIN_COLUMN_PX + GAP_PX)))
}

// Contiguous split of `heights` into `k` groups minimising the tallest group.
// Returns the start index of each group. Card counts are ~12, so plain DP.
function partition(heights, k) {
  const n = heights.length
  const prefix = [0]
  for (const h of heights) prefix.push(prefix.at(-1) + h + GAP_PX)
  const sum = (a, b) => prefix[b] - prefix[a]
  // best[j][i]: minimal tallest column placing the first i cards in j columns.
  const best = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity))
  const cut = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0))
  best[0][0] = 0
  for (let j = 1; j <= k; j++) {
    for (let i = 0; i <= n; i++) {
      for (let p = 0; p <= i; p++) {
        const v = Math.max(best[j - 1][p], sum(p, i))
        if (v < best[j][i]) { best[j][i] = v; cut[j][i] = p }
      }
    }
  }
  const starts = []
  for (let j = k, i = n; j >= 1; j--) { starts.unshift(cut[j][i]); i = cut[j][i] }
  return starts
}

function evenStarts(n, k) {
  return Array.from({ length: k }, (_, j) => Math.round((j * n) / k))
}

export default function DeviceRack({ className = '', layoutKey = '', children }) {
  const items = Children.toArray(children)
  const keys = items.map(c => c.key)
  const rootRef = useRef(null)
  const cellRefs = useRef(new Map())
  const [cols, setCols] = useState(1)
  const [layout, setLayout] = useState(null) // { sig, starts }
  const sig = `${cols}|${layoutKey}|${keys.join(',')}`

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    setCols(columnCount(el.clientWidth))
    const ro = new ResizeObserver(() => setCols(columnCount(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const measure = () => {
    const heights = keys.map(k => cellRefs.current.get(k)?.offsetHeight ?? 0)
    const starts = partition(heights, cols)
    setLayout(prev => (prev?.sig === sig && prev.starts.join() === starts.join() ? prev : { sig, starts }))
  }

  // Runs before paint, so the provisional even split below is never seen.
  useLayoutEffect(() => {
    if (layout?.sig === sig) return
    measure()
  })

  const starts = layout?.sig === sig ? layout.starts : evenStarts(items.length, cols)
  const columns = starts.map((s, j) => items.slice(s, starts[j + 1] ?? items.length))

  return (
    <div ref={rootRef} className={`device-rack ${className}`.trim()}>
      {columns.map((col, j) => (
        <div key={j} className="device-rack-col">
          {col.map(item => (
            <div
              key={item.key}
              className="device-rack-cell"
              ref={el => { if (el) cellRefs.current.set(item.key, el); else cellRefs.current.delete(item.key) }}
            >{item}</div>
          ))}
        </div>
      ))}
    </div>
  )
}
