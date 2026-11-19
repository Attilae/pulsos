'use client'
import { useEffect, useRef, useState } from 'react'
import { makeDefaultWeq8Spec } from '@/lib/eqMigrate.js'
import { eqResponse, eqHasGain, eqHasQ, eqTypeLabel } from '@/lib/touchEq.js'

function ResponseCurve({ runtime, spec }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!runtime || !canvas) return
    const draw = () => {
      const width = canvas.clientWidth, height = 140
      const ratio = window.devicePixelRatio || 1
      canvas.width = width * ratio; canvas.height = height * ratio
      const ctx = canvas.getContext('2d')
      if (!ctx || !width) return
      ctx.scale(ratio, ratio)
      const styles = getComputedStyle(canvas)
      ctx.strokeStyle = styles.getPropertyValue('--border').trim()
      ctx.lineWidth = 1
      for (const db of [-15, 0, 15]) {
        const y = height / 2 - db / 30 * height
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      }
      const { db } = eqResponse(runtime)
      ctx.strokeStyle = styles.getPropertyValue('--accent').trim()
      ctx.lineWidth = 2; ctx.beginPath()
      db.forEach((value, i) => {
        const x = i / (db.length - 1) * width
        const y = height / 2 - Math.max(-15, Math.min(15, value)) / 30 * height
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y)
      })
      ctx.stroke()
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    // Theme changes should repaint even when dimensions and EQ stay unchanged.
    const theme = new MutationObserver(draw)
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { observer.disconnect(); theme.disconnect() }
  }, [runtime, spec])
  return <figure className="touch-eq-response"><canvas ref={ref} role="img" aria-label="EQ response curve, 10 Hz to Nyquist, minus 15 to plus 15 dB" />
    <figcaption><span>10 Hz</span><span>±15 dB</span><span>{runtime ? `${Math.round(runtime.audioCtx.sampleRate / 2000)} kHz` : 'Nyquist'}</span></figcaption></figure>
}

export default function TouchEqEditor({ getRuntime, routeId, engineGen }) {
  const [runtime, setRuntime] = useState(null)
  const [spec, setSpec] = useState(null)
  useEffect(() => {
    const rt = getRuntime?.(routeId)
    setRuntime(rt ?? null)
    if (!rt) { setSpec(null); return }
    const update = value => setSpec(value.map(band => ({ ...band })))
    update(rt.spec)
    return rt.on('filtersChanged', update)
  }, [getRuntime, routeId, engineGen])
  const defaults = makeDefaultWeq8Spec()
  return <section className="touch-eq" aria-label="Equalizer">
    <h3>Equalizer</h3>
    <ResponseCurve runtime={runtime} spec={spec} />
    {!spec && <p className="lsheet-hint" role="status">EQ is loading.</p>}
    {spec?.map((band, index) => {
      const label = `EQ band ${index + 1}`
      const unused = band.type === 'noop'
      const field = (name, key, min, max, step, setter, available = true, log = false) => {
        const value = band[key]
        const display = key === 'frequency' ? `${Math.round(value)} Hz` : key === 'gain' ? `${value.toFixed(1)} dB` : value.toFixed(2)
        return <div className="touch-eq-field" key={key}>
          <label><span>{name}</span><output>{display}</output>
            <input type="range" aria-label={`${label} ${name}`} min={log ? Math.log10(min) : min} max={log ? Math.log10(max) : max}
              step={log ? .001 : step} value={log ? Math.log10(Math.max(min, value)) : value} disabled={!available || unused}
              aria-valuetext={display} onChange={e => setter(index, Math.max(min, Math.min(max, log ? 10 ** Number(e.target.value) : Number(e.target.value))))} />
          </label>
          <button type="button" className="lsheet-reset" aria-label={`Reset ${label} ${name}`} disabled={!available || unused}
            onClick={() => setter(index, Math.max(min, Math.min(max, defaults[index][key])))}>Reset</button>
        </div>
      }
      return <fieldset className="touch-eq-band" key={index}>
        <legend>Band {index + 1}</legend>
        <div className="touch-eq-head">
          <button type="button" className="lsheet-action" aria-label={`Enable ${label}`} aria-pressed={!unused && !band.bypass}
            onClick={() => { if (unused) { runtime.setFilterType(index, 'peaking12'); runtime.toggleBypass(index, false) } else runtime.toggleBypass(index, !band.bypass) }}>{unused || band.bypass ? 'Off' : 'On'}</button>
          <select aria-label={`${label} type`} value={band.type} onChange={e => runtime.setFilterType(index, e.target.value)}>
            {['noop', ...runtime.supportedFilterTypes].map(type => <option key={type} value={type}>{eqTypeLabel(type)}</option>)}
          </select>
          <button type="button" className="lsheet-reset" aria-label={`Reset ${label} type`} onClick={() => runtime.setFilterType(index, defaults[index].type)}>Reset</button>
        </div>
        {field('Frequency', 'frequency', 10, runtime.audioCtx.sampleRate / 2, 1, runtime.setFilterFrequency.bind(runtime), true, true)}
        {field('Gain', 'gain', -15, 15, .1, runtime.setFilterGain.bind(runtime), eqHasGain(band.type))}
        {field('Q', 'Q', .1, 18, .01, runtime.setFilterQ.bind(runtime), eqHasQ(band.type), true)}
      </fieldset>
    })}
  </section>
}
