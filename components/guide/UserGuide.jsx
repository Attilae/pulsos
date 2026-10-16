'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { IconDownload, IconExternal, IconCaretDown, IconCheck, IconReset } from '../icons.jsx'
import { chapters, quickStart, GUIDE_VERSION } from './guideContent.js'
import './UserGuide.css'

const categories = ['All topics', ...new Set(chapters.map(chapter => chapter.category))]
const storageKey = 'leid-guide-first-song-v1'

function RouteExample() {
  const [contour, setContour] = useState('Arch')
  const [selected, setSelected] = useState(2)
  const [offsets, setOffsets] = useState({})
  const pitches = contour === 'Arch' ? [0, 2, 4, 5, 4, 2, 0] : [0, 1, 2, 3, 4, 5, 6]
  const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C', 'D']
  const pitch = index => Math.max(0, Math.min(8, pitches[index] + (offsets[index] || 0)))
  return (
    <section className="guide-example" aria-labelledby="example-title">
      <div className="guide-example-head"><div><h2 id="example-title">A route becomes a melody</h2><p>An illustrative lane, separate from your song. Select a stop and change its pitch.</p></div>
        <label>Contour<select value={contour} onChange={event => setContour(event.target.value)}><option>Arch</option><option>Ascending</option></select></label>
      </div>
      <div className="guide-note-rail" role="group" aria-label="Example route stops">
        {pitches.map((_, index) => <button key={index} type="button" className={selected === index ? 'is-selected' : ''} style={{ '--note-height': `${(8 - pitch(index)) * 7}px` }} onClick={() => setSelected(index)} aria-pressed={selected === index} aria-label={`Stop ${index + 1}, ${names[pitch(index)]}`}><span className="guide-note">{names[pitch(index)]}</span><span className="guide-stop-number">{index + 1}</span></button>)}
      </div>
      <div className="guide-example-editor"><p aria-live="polite">Stop {selected + 1}: <strong>{names[pitch(selected)]}</strong><span>Each step moves to the next note in C major.</span></p><div><button type="button" disabled={pitch(selected) === 0} onClick={() => setOffsets(value => ({ ...value, [selected]: (value[selected] || 0) - 1 }))}>Lower pitch</button><button type="button" disabled={pitch(selected) === 8} onClick={() => setOffsets(value => ({ ...value, [selected]: (value[selected] || 0) + 1 }))}>Raise pitch</button><button type="button" aria-label="Reset example pitches" onClick={() => setOffsets({})}><IconReset /></button></div></div>
      <p className="guide-example-caption">In the app, click a stop dot to edit its scale degree, velocity and chance. This example is visual and does not play audio.</p>
    </section>
  )
}

export default function UserGuide() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All topics')
  const [completed, setCompleted] = useState([])
  const [expanded, setExpanded] = useState(false)
  const [openTopics, setOpenTopics] = useState(new Set())
  const [active, setActive] = useState('first-song')
  const normalized = query.trim().toLocaleLowerCase()
  const filtered = useMemo(() => chapters.map(chapter => {
    const chapterMatch = `${chapter.title} ${chapter.summary} ${chapter.category}`.toLocaleLowerCase().includes(normalized)
    return { ...chapter, topics: chapter.topics.filter(topic => !normalized || chapterMatch || `${topic.title} ${topic.body.join(' ')}`.toLocaleLowerCase().includes(normalized)) }
  }).filter(chapter => chapter.topics.length && (category === 'All topics' || chapter.category === category)), [normalized, category])
  const count = filtered.reduce((total, chapter) => total + chapter.topics.length, 0)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
      if (Array.isArray(stored)) setCompleted(stored.filter(index => Number.isInteger(index) && index >= 0 && index < quickStart.length))
    } catch { /* A blocked or stale local store must not prevent reading. */ }
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id)
    }, { rootMargin: '-10% 0px -65% 0px' })
    document.querySelectorAll('[data-guide-section]').forEach(section => observer.observe(section))
    return () => observer.disconnect()
  }, [filtered])

  function toggleStep(index) {
    const next = completed.includes(index) ? completed.filter(item => item !== index) : [...completed, index]
    setCompleted(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Optional progress storage. */ }
  }

  function toggleTopic(id) {
    setOpenTopics(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="user-guide">
      <a className="guide-skip" href="#guide-main">Skip to guide</a>
      <header className="guide-header"><Link href="/" className="guide-brand" aria-label="Leið home">Leið<span>User guide</span></Link><div className="guide-header-actions"><Link href="/" target="_blank" rel="noopener">Open the app <IconExternal /></Link><a href="/guides/leid-user-guide.pdf" download><IconDownload /> Download PDF</a></div></header>
      <div className="guide-layout">
        <aside className="guide-sidebar" aria-label="Guide navigation">
          <label htmlFor="guide-search">Find a control or task</label><input id="guide-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try “solo” or “save”…" />
          <nav aria-label="Chapters"><a href="#first-song" aria-current={active === 'first-song' ? 'location' : undefined}>Your first song</a>{filtered.map(chapter => <a key={chapter.id} href={`#${chapter.id}`} aria-current={active === chapter.id ? 'location' : undefined}>{chapter.title}</a>)}</nav>
          <p className="guide-sidebar-note">Made for the current Leið app.<br />{GUIDE_VERSION}<br />PDF includes the complete guide.</p>
        </aside>
        <main id="guide-main" className="guide-main">
          <div className="guide-intro"><h1>Your guide to Leið</h1><p>Every line is a lane. Every stop is a note. Start with one route, find a sound you like, and build from there.</p><div className="guide-intro-links"><a href="#first-song">Make your first song</a><a href="#reference">Explore the reference</a></div><p className="guide-availability">Playback currently uses simulated transit data in all seven cities. Live mode is unavailable.</p></div>
          <section id="first-song" data-guide-section className="guide-quickstart"><div className="guide-section-heading"><div><h2>Your first song</h2><p>A short path from a quiet city to your first mix.</p></div><span className="guide-progress" aria-live="polite">{completed.length} / {quickStart.length} complete</span></div><ol>{quickStart.map((step, index) => <li key={step.title} className={completed.includes(index) ? 'is-complete' : ''}><label><input type="checkbox" checked={completed.includes(index)} onChange={() => toggleStep(index)} /><span className="guide-step-marker" aria-hidden="true">{completed.includes(index) ? <IconCheck /> : index + 1}</span><span><strong>{step.title}</strong><span className="guide-step-body">{step.text}</span></span></label></li>)}</ol><p className="guide-local-note">Your checklist is saved on this device. It does not change your song.</p></section>
          <RouteExample />
          <section id="reference" className="guide-reference" aria-labelledby="reference-title"><div className="guide-section-heading"><div><h2 id="reference-title">The complete reference</h2><p>Look up a control, or explore one part of the instrument.</p></div><button type="button" aria-pressed={expanded} onClick={() => { setExpanded(value => !value); setOpenTopics(new Set()) }}>{expanded ? 'Collapse all' : 'Expand all'}</button></div><div className="guide-filters" role="group" aria-label="Filter guide topics">{categories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="guide-results" aria-live="polite">{count} {count === 1 ? 'explanation' : 'explanations'}{normalized ? ` matching “${query.trim()}”` : ' across the instrument'}{(normalized || category !== 'All topics') && <button type="button" onClick={() => { setQuery(''); setCategory('All topics') }}>Clear filters</button>}</div>
            {filtered.length === 0 ? <div className="guide-empty"><h3>No topics found</h3><p>Try a broader word such as “notes”, “drums” or “export”, or clear the filters to see the full reference.</p><button type="button" onClick={() => { setQuery(''); setCategory('All topics') }}>Show all topics</button></div> : filtered.map(chapter => <section key={chapter.id} id={chapter.id} data-guide-section className="guide-chapter"><h3>{chapter.title}</h3><p className="guide-chapter-summary">{chapter.summary}</p>{chapter.topics.map((topic, index) => {
              const id = `${chapter.id}-${index}`
              return <details key={id} open={expanded || !!normalized || openTopics.has(id)}><summary onClick={event => { event.preventDefault(); if (expanded) { setExpanded(false); setOpenTopics(new Set(filtered.flatMap(item => item.topics.map((_, i) => `${item.id}-${i}`)).filter(item => item !== id))) } else toggleTopic(id) }}>{topic.title}<IconCaretDown /></summary><div className="guide-topic-body">{topic.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div></details>
            })}</section>)}
          </section>
          <footer className="guide-footer"><h2>Ready to hear your city?</h2><p>Start with one lane. Save the sounds worth returning to.</p><Link href="/" target="_blank" rel="noopener">Open Leið <IconExternal /></Link><button type="button" onClick={() => window.print()}>Print this guide</button><a href="#guide-main">Back to top</a></footer>
        </main>
      </div>
      <article className="guide-print"><header><h1>Leið</h1><h2>User guide</h2><p>Play the city. Make it your own.</p><p>{GUIDE_VERSION}</p><p>A beginner walkthrough and complete feature reference.</p></header><section><h2>Contents</h2><ol><li>Your first song</li>{chapters.map(chapter => <li key={chapter.id}><a href={`#print-${chapter.id}`}>{chapter.title}</a></li>)}</ol><p>All seven cities currently use simulated playback. Live mode is unavailable. Optional features depend on the deployment and account access.</p></section><section><h2>Your first song</h2><ol>{quickStart.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol></section>{chapters.map(chapter => <section key={chapter.id} id={`print-${chapter.id}`}><h2>{chapter.title}</h2><p>{chapter.summary}</p>{chapter.topics.map(topic => <div key={topic.title}><h3>{topic.title}</h3>{topic.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>)}</section>)}</article>
    </div>
  )
}
