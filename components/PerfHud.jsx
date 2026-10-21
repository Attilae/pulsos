'use client'

// On-screen performance readout, shown with `?perf=1` (remembered per browser,
// `?perf=0` or Close hides it). Built for testing on someone else's laptop: the
// numbers are the ones lib/perfMonitor.js sends from the field, Copy report puts
// the full JSON on the clipboard, and the output-buffer picker reloads with
// `?latency=` so a slow machine can be A/B tested without DevTools.

import { useEffect, useState } from 'react'
import { getPerfReport, subscribePerf, resetPerf, hidePerfHud } from '@/lib/perfMonitor.js'
import { PERF_BUDGETS, LATENCY_HINTS } from '@/lib/perfStats.js'
import { IconClose, IconCopy, IconReset } from './icons.jsx'
import './PerfHud.css'

const VERDICT_LABEL = {
  ok: 'OK',
  'audio-dropouts': 'Audio dropouts',
  'late-notes': 'Late notes',
  'janky-ui': 'Slow UI',
  'software-gpu': 'No GPU',
}

const fmt = (v, unit = '') => (v == null ? 'n/a' : `${v}${unit}`)

function Row({ label, value, bad, title }) {
  return (
    <div className={`perf-hud-row ${bad ? 'perf-hud-row--bad' : ''}`} title={title}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function currentLatencyChoice() {
  try { return localStorage.getItem('leid-audio-latency') ?? 'default' } catch { return 'default' }
}

export default function PerfHud({ onClose }) {
  const [report, setReport] = useState(() => getPerfReport())
  const [copied, setCopied] = useState(false)

  useEffect(() => subscribePerf(() => setReport(getPerfReport())), [])

  const copy = async () => {
    const text = JSON.stringify(getPerfReport(), null, 2)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // No clipboard permission: hand it over as a file instead.
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      a.download = 'leid-perf-report.json'
      a.click()
      URL.revokeObjectURL(a.href)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const setLatency = (value) => {
    const url = new URL(window.location.href)
    url.searchParams.set('latency', value)
    window.location.assign(url.toString())
  }

  const close = () => { hidePerfHud(); onClose?.() }

  const { audio = {}, ui = {}, device = {}, workload = {}, verdict, issues = [] } = report
  return (
    <aside className="perf-hud" aria-label="Performance monitor">
      <div className="perf-hud-head">
        <span className="perf-hud-title">Performance</span>
        <span className={`perf-hud-verdict ${verdict === 'ok' ? '' : 'perf-hud-verdict--bad'}`}>
          {VERDICT_LABEL[verdict] ?? verdict}
        </span>
        <button type="button" className="perf-hud-icon" onClick={close} aria-label="Close performance monitor">
          <IconClose />
        </button>
      </div>
      <dl>
        <Row
          label="Dropouts"
          value={`${fmt(audio.dropoutMs, ' ms')} total, ${fmt(audio.dropoutMsPerMin)}/min, last 10 s ${fmt(audio.dropoutMsLast10s, ' ms')}`}
          bad={issues.includes('audio-dropouts')}
          title={`Audio the render thread failed to deliver. Budget ${PERF_BUDGETS.dropoutMsPerMin} ms/min.`}
        />
        <Row
          label="Late notes"
          value={`${audio.lateTicks ?? 0} gaps, worst +${audio.lateMaxMs ?? 0} ms`}
          bad={issues.includes('late-notes')}
          title="Main-thread stalls longer than the scheduler's lookahead: notes in the gap start late."
        />
        <Row
          label="Play stall"
          value={fmt(audio.startStallMs, ' ms')}
          bad={(audio.startStallMs ?? 0) > (audio.lookAheadMs ?? 100)}
          title="Longest main-thread stall in the first 2 s after the transport starts. Above the lookahead, the first notes start late."
        />
        <Row
          label="Frames"
          value={`${fmt(ui.fps, ' fps')}, p95 ${fmt(ui.p95, ' ms')}, long ${fmt(ui.longFramesPerMin)}/min`}
          bad={issues.includes('janky-ui')}
        />
        <Row
          label="Device"
          value={`${device.os ?? '?'} ${device.browser ?? '?'}, ${fmt(device.cores)} cores, ${fmt(device.memoryGb, ' GB')}`}
        />
        <Row
          label="GPU"
          value={`${device.gpuClass ?? '?'}${device.charging === false ? ', on battery' : ''}`}
          bad={issues.includes('software-gpu')}
          title={device.gpu}
        />
        <Row
          label="Audio"
          value={`${audio.sampleRate ? audio.sampleRate / 1000 : '?'} kHz, ${audio.latencyHint ?? '?'}, buffer ${fmt(audio.baseLatencyMs, ' ms')}`}
        />
        <Row
          label="Playing"
          value={`${Math.round((report.playMs ?? 0) / 1000)} s, ${fmt(workload.activeLanes)} lanes, ${workload.view ?? '?'}`}
        />
      </dl>
      <div className="perf-hud-actions">
        <label className="perf-hud-latency">
          Buffer
          <select value={currentLatencyChoice()} onChange={e => setLatency(e.target.value)}>
            <option value="default">default</option>
            {LATENCY_HINTS.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <button type="button" onClick={resetPerf} title="Reset the counters"><IconReset /> Reset</button>
        <button type="button" onClick={copy}><IconCopy /> {copied ? 'Copied' : 'Copy report'}</button>
      </div>
    </aside>
  )
}
