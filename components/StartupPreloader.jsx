'use client'

import { useEffect, useState } from 'react'
import { shuffledFactsForCity } from '@/lib/shared/cityFacts.js'
import { DEFAULT_CITY_ID } from '@/lib/shared/cities.js'
import './StartupPreloader.css'

export default function StartupPreloader() {
  const [sentences, setSentences] = useState(['Every line becomes a track. Every stop becomes a note.'])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let cityId = DEFAULT_CITY_ID
    try { cityId = localStorage.getItem('leid.cityId') || cityId } catch {}
    setSentences(shuffledFactsForCity(cityId))
    const timer = setInterval(() => setIndex(value => value + 1), 7000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="startup-preloader">
      <div className="startup-preloader-content">
        <div className="startup-preloader-heading">
          <span className="startup-preloader-brand">Leið</span>
          <span className="startup-preloader-signal" aria-hidden="true">
            {[0, 1, 2, 3, 4].map(bar => <i key={bar} style={{ animationDelay: `${bar * 120}ms` }} />)}
          </span>
        </div>
        <h1 className="startup-preloader-title" role="status">Getting the city ready to play.</h1>
        <p key={index} className="startup-preloader-sentence">{sentences[index % sentences.length]}</p>
        <div className="startup-preloader-rail" aria-hidden="true"><span /></div>
        <p className="startup-preloader-mobile">we welcome you here but we prefer the desktop version</p>
      </div>
    </div>
  )
}
