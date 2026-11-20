'use client'
import { useSyncExternalStore } from 'react'
import { subscribeEvents, getEvents } from '@/lib/shared/eventLogStore.js'

const noSubscribe = () => () => {}

// The log alone subscribes to note batches; hidden views release the listener.
export default function EventLog({ visible = true, variant = 'rack' }) {
  const events = useSyncExternalStore(visible ? subscribeEvents : noSubscribe, getEvents, getEvents)
  return <aside className={`event-log event-log--${variant}`} aria-label="Note activity">
    {variant === 'rack' && <h2>Event Log</h2>}
    {!events.length && <p className="event-log-empty">No notes yet. Enable a lane and press Play to see its stops and notes.</p>}
    <ul aria-label="Recent notes">
      {events.slice(0, 24).map(ev => <li key={ev.seq}>
        <span className="ev-line">{ev.routeShortName ?? ev.lineId}</span>
        <span className="ev-stop">{ev.stopName}</span>
        <span className="ev-note">{ev.note}</span>
      </li>)}
    </ul>
  </aside>
}
