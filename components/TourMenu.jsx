// Onboarding tour trigger for the app header — lets the user (re)start the driver.js walkthrough.
import { useState, useRef, useEffect } from 'react'

export default function TourMenu({ startTour }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div className="tour-control" ref={rootRef}>
      <button className="tour-trigger" onClick={() => setOpen(o => !o)}>? ▾</button>
      {open && (
        <div className="tour-pop">
          <button className="tour-item" onClick={() => { startTour(); setOpen(false) }}>
            Take the tour
          </button>
        </div>
      )}
    </div>
  )
}
