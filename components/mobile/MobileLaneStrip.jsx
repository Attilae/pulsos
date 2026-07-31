// One transit line, as a phone-sized row.
//
// Desktop packs a lane header with a 200px label, a 120px fader, a 72px pan
// slider, export buttons and a device-rack toggle — ~730px that refuses to
// shrink. Here the same lane is two rows: identity on top, the three controls
// people actually reach for during a mix below, and everything else behind a
// sheet.
//
// Deliberately has no playhead. Desktop runs one requestAnimationFrame loop
// per lane (plus one per automation rail); on a 20-lane phone session that is
// 20+ loops and 20 re-renders a frame. The transport bar carries a single
// shared playhead instead.
'use client'

import { memo } from 'react'
import { normalizeLaneTag } from '@/lib/laneTags.js'

function MobileLaneStrip({
  route,
  disabled,
  soloed,
  anySoloed,
  volume = 0,
  locked = false,
  tag,
  onDisable,
  onSolo,
  onVolume,
  onOpen,
}) {
  const laneTag = normalizeLaneTag(tag)
  // Silent because something *else* is soloed. Worth showing separately from
  // "disabled": the lane looks enabled but makes no sound, which is otherwise
  // the single most confusing state in the mixer.
  const gatedBySolo = anySoloed && !soloed && !disabled
  const label = route.name ?? route.id

  return (
    <li
      className={[
        'mlane',
        disabled ? 'mlane--off' : '',
        gatedBySolo ? 'mlane--gated' : '',
        locked ? 'mlane--locked' : '',
        laneTag.color ? 'mlane--tagged' : '',
      ].filter(Boolean).join(' ')}
      style={laneTag.color ? { '--lane-tag-color': laneTag.color } : undefined}
    >
      <button type="button" className="mlane-id" onClick={() => onOpen(route.id)}>
        <span className="mlane-color" style={{ background: route.color }} aria-hidden="true" />
        {/* Same badge/description split as the desktop lane header, so a line
            is recognisable across both views. */}
        <span className="mlane-badge" style={{ background: route.color, color: route.textColor }}>
          {route.name}
        </span>
        {laneTag.text && (
          <span className={`mlane-tag${laneTag.color ? ' is-colored' : ''}`}>{laneTag.text}</span>
        )}
        <span className="mlane-name">{route.desc}</span>
        {gatedBySolo && <span className="mlane-flag">soloed elsewhere</span>}
        {locked && <span className="mlane-flag mlane-flag--pro">PRO</span>}
      </button>

      <div className="mlane-controls">
        <button
          type="button"
          className={`mlane-btn ${disabled ? '' : 'is-on'}`}
          onClick={() => onDisable(route.id)}
          aria-pressed={!disabled}
          aria-label={disabled ? `Enable ${label}` : `Disable ${label}`}
        >⏻</button>

        <button
          type="button"
          className={`mlane-btn ${soloed ? 'is-solo' : ''}`}
          // Long-press-free additive solo: on desktop it's Cmd/Ctrl-click, here
          // the lane sheet carries an explicit "add to solo" control instead.
          onClick={() => onSolo(route.id, false)}
          aria-pressed={soloed}
          aria-label={`Solo ${label}`}
        >S</button>

        <input
          type="range"
          className="mlane-vol"
          min={-40} max={6} step={1}
          value={volume}
          onChange={e => onVolume(route.id, Number(e.target.value))}
          aria-label={`Volume, ${label}`}
        />
        <span className="mlane-db mono">{volume > 0 ? `+${volume}` : volume}</span>

        <button
          type="button"
          className="mlane-btn mlane-more"
          onClick={() => onOpen(route.id)}
          aria-label={`${label} settings`}
        >⋯</button>
      </div>
    </li>
  )
}

export default memo(MobileLaneStrip)
