import * as Tone from 'tone'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SYNTH_DEFAULTS, EFFECT_TYPES, EFFECT_DEFAULTS } from './engine.js'
import './DawView.css'

const SYNTH_TYPES = [
  'Synth', 'FMSynth', 'AMSynth', 'MonoSynth',
  'MembraneSynth', 'MetalSynth', 'NoiseSynth', 'PluckSynth', 'DuoSynth',
]

const NOTE_ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const SCALE_TYPES = [
  ['major',           'Major'],
  ['minor',           'Minor'],
  ['pentatonic',      'Pent.'],
  ['pentatonicMinor', 'Pent. Min'],
  ['dorian',          'Dorian'],
  ['phrygian',        'Phrygian'],
  ['lydian',          'Lydian'],
  ['mixolydian',      'Mixolyd.'],
]

// Find the stop nearest to a vehicle lat/lng, return its rail position (0–100)
function resolvePlayhead(route, lat, lng) {
  if (!route.stops.length || route.totalDist <= 0 || lat == null) return null
  let nearest = route.stops[0]
  let minD    = Infinity
  for (const s of route.stops) {
    const d = (s.lat - lat) ** 2 + (s.lon - lng) ** 2
    if (d < minD) { minD = d; nearest = s }
  }
  return { pct: (nearest.dist / route.totalDist) * 100, stopId: nearest.id }
}

export default function DawView({
  mode, started, events, routes,
  volumes, muted, soloRoutes,
  liveSnapshot, snapshotLoading,
  trackSoundModes, trackScales, trackSynthTypes, trackADSRs, trackEffects,
  onVolume, onMute, onSolo,
  onSoundMode, onScale, onSynthType, onADSR, onEffect, onEffectParams,
  onRefetch, onVehicleCrossed,
}) {
  // Global playhead element
  const playheadRef          = useRef(null)
  const tracksRef            = useRef(null)
  const animRef              = useRef(null)
  const railOffsetRef        = useRef(412)
  const lastProgressRef      = useRef(0)
  const lastProgressUpdateRef = useRef(0)
  const [playheadProgress, setPlayheadProgress] = useState(0)

  // Vehicles grouped by routeShortName for crossing detection
  const vehiclesByRoute = useMemo(() => {
    if (!liveSnapshot?.vehicles) return {}
    const map = {}
    for (const v of liveSnapshot.vehicles) {
      if (!map[v.routeShortName]) map[v.routeShortName] = []
      map[v.routeShortName].push(v)
    }
    return map
  }, [liveSnapshot])

  // Measure where the stop-rail column starts inside .daw-tracks
  useEffect(() => {
    if (!routes) return
    const measure = () => {
      const railEl   = tracksRef.current?.querySelector('.stop-rail')
      const tracksEl = tracksRef.current
      if (!railEl || !tracksEl) return
      railOffsetRef.current = railEl.getBoundingClientRect().left
                            - tracksEl.getBoundingClientRect().left
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [routes])

  // rAF loop: moves playhead, detects crossings
  useEffect(() => {
    const ph = playheadRef.current
    if (!ph) return

    if (!started) {
      cancelAnimationFrame(animRef.current)
      ph.style.left = `${railOffsetRef.current}px`
      setPlayheadProgress(0)
      lastProgressRef.current = 0
      return
    }

    const tick = () => {
      const progress = Tone.getTransport().progress

      // 60fps: move the playhead div in pixels (rail-aligned)
      const tracksEl = tracksRef.current
      const railLeft = railOffsetRef.current
      const railWidth = tracksEl ? tracksEl.offsetWidth - railLeft - 12 : 0
      ph.style.left = `${railLeft + progress * railWidth}px`

      // ~15fps: update React state for stop highlighting
      const now = performance.now()
      if (now - lastProgressUpdateRef.current > 66) {
        setPlayheadProgress(progress)
        lastProgressUpdateRef.current = now
      }

      // Live crossing detection every frame
      if (mode === 'live' && routes && liveSnapshot) {
        const prev = lastProgressRef.current
        for (const route of routes) {
          const vehicles = vehiclesByRoute[route.name] ?? []
          for (const v of vehicles) {
            const ph2 = resolvePlayhead(route, v.lat, v.lng)
            if (!ph2) continue
            const vPct   = ph2.pct / 100
            const crossed = progress >= prev
              ? (prev < vPct && vPct <= progress)
              : (prev < vPct || vPct <= progress)   // loop wrap-around
            if (crossed) onVehicleCrossed(route.id, route.type, v.lat)
          }
        }
      }

      lastProgressRef.current = progress
      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [started, mode, routes, liveSnapshot, vehiclesByRoute, onVehicleCrossed])

  const metro = routes?.filter(r => r.type === 'metro') ?? []
  const trams = routes?.filter(r => r.type === 'tram')  ?? []

  return (
    <div className="daw-body">
      <main className="daw-tracks" ref={tracksRef}>
        {/* Global rail-aligned playhead */}
        <div
          ref={playheadRef}
          className={`daw-global-playhead ${started ? 'active' : ''}`}
          style={{ left: `${railOffsetRef.current}px` }}
        />

        {!routes && <div className="daw-loading">Loading line data…</div>}

        {/* Live mode: snapshot bar */}
        {mode === 'live' && routes && (
          <div className="snapshot-bar">
            <span className="snapshot-label">
              {liveSnapshot
                ? `${liveSnapshot.vehicles.length} vehicles loaded`
                : 'No snapshot loaded'}
            </span>
            <button
              className="refetch-btn"
              onClick={onRefetch}
              disabled={snapshotLoading || started}
            >
              {snapshotLoading ? 'Fetching…' : '↺ Refetch'}
            </button>
          </div>
        )}

        {/* ── Metro section ── */}
        {metro.length > 0 && (
          <>
            <div className="daw-section-label">Metro</div>
            {metro.map(route => (
              <LineTrack
                key={route.id}
                route={route}
                mode={mode}
                started={started}
                progress={playheadProgress}
                volume={volumes[route.type] ?? 0}
                muted={muted[route.type] ?? false}
                isSoloed={soloRoutes.has(route.id)}
                vehicles={vehiclesByRoute[route.name] ?? []}
                soundMode={trackSoundModes?.[route.id] ?? 'harmonic'}
                trackScale={trackScales?.[route.id] ?? { root: 'C', scaleType: 'major' }}
                synthType={trackSynthTypes?.[route.id] ?? 'Synth'}
                adsr={trackADSRs?.[route.id] ?? SYNTH_DEFAULTS['Synth']}
                onVolume={v => onVolume(route.type, v)}
                onMute={() => onMute(route.type)}
                onSolo={() => onSolo(route.id)}
                onSoundMode={m => onSoundMode(route.id, route.name, m)}
                onScale={s => onScale(route.id, route.name, s)}
                onSynthType={st => onSynthType(route.id, route.type, st)}
                onADSR={p => onADSR(route.id, p)}
                effectType={trackEffects?.[route.id]?.type ?? 'None'}
                effectParams={trackEffects?.[route.id]?.params ?? {}}
                onEffect={et => onEffect(route.id, route.type, et)}
                onEffectParams={p => onEffectParams(route.id, p)}
              />
            ))}
          </>
        )}

        {/* ── Tram section ── */}
        {trams.length > 0 && (
          <>
            <div className="daw-section-label">Tram</div>
            {trams.map(route => (
              <LineTrack
                key={route.id}
                route={route}
                mode={mode}
                started={started}
                progress={playheadProgress}
                volume={volumes[route.type] ?? 0}
                muted={muted[route.type] ?? false}
                isSoloed={soloRoutes.has(route.id)}
                vehicles={vehiclesByRoute[route.name] ?? []}
                soundMode={trackSoundModes?.[route.id] ?? 'harmonic'}
                trackScale={trackScales?.[route.id] ?? { root: 'C', scaleType: 'major' }}
                synthType={trackSynthTypes?.[route.id] ?? 'Synth'}
                adsr={trackADSRs?.[route.id] ?? SYNTH_DEFAULTS['Synth']}
                onVolume={v => onVolume(route.type, v)}
                onMute={() => onMute(route.type)}
                onSolo={() => onSolo(route.id)}
                onSoundMode={m => onSoundMode(route.id, route.name, m)}
                onScale={s => onScale(route.id, route.name, s)}
                onSynthType={st => onSynthType(route.id, route.type, st)}
                onADSR={p => onADSR(route.id, p)}
                effectType={trackEffects?.[route.id]?.type ?? 'None'}
                effectParams={trackEffects?.[route.id]?.params ?? {}}
                onEffect={et => onEffect(route.id, route.type, et)}
                onEffectParams={p => onEffectParams(route.id, p)}
              />
            ))}
          </>
        )}
      </main>

      <aside className="event-log">
        <h2>Event Log</h2>
        <ul>
          {events.slice(0, 24).map((ev, i) => (
            <li key={i}>
              <span className="ev-line">{ev.routeShortName ?? ev.lineId}</span>
              <span className="ev-stop">{ev.stopName}</span>
              <span className="ev-note">{ev.note}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

// ── Individual line track row ─────────────────────────────────────────────────
function LineTrack({
  route, mode, started, progress, volume, muted, isSoloed,
  vehicles, soundMode, trackScale, synthType, adsr,
  effectType, effectParams,
  onVolume, onMute, onSolo, onSoundMode, onScale, onSynthType, onADSR,
  onEffect, onEffectParams,
}) {
  const [envOpen, setEnvOpen] = useState(false)
  const [fxOpen,  setFxOpen]  = useState(false)

  return (
    <div className={`line-track ${muted ? 'line-track--muted' : ''}`}>
      <div className="line-label" style={{ borderColor: route.color }}>
        <span className="line-badge" style={{ background: route.color, color: route.textColor }}>
          {route.name}
        </span>
        <span className="line-desc">{route.desc}</span>
      </div>

      <div className="line-controls">
        <div className="line-controls-row">
          <button
            className={`mute-btn ${muted ? 'active' : ''}`}
            onClick={onMute}
            title={muted ? 'Unmute' : 'Mute'}
          >M</button>
          <button
            className={`solo-btn ${isSoloed ? 'active' : ''}`}
            onClick={onSolo}
            title="Solo"
          >S</button>
          <input
            type="range" min="-40" max="6" step="1"
            value={volume}
            onChange={e => onVolume(Number(e.target.value))}
            className="volume-slider"
          />
          <span className="volume-val">{volume}dB</span>
        </div>

        <div className="synth-controls-row">
          <select
            className="synth-select"
            value={synthType}
            onChange={e => onSynthType(e.target.value)}
          >
            {SYNTH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            className={`env-toggle-btn ${envOpen ? 'active' : ''}`}
            onClick={() => setEnvOpen(o => !o)}
            title="Envelope / synth parameters"
          >ENV</button>
        </div>

        {envOpen && <EnvPanel synthType={synthType} adsr={adsr} onADSR={onADSR} />}

        <div className="fx-controls-row">
          <select
            className="fx-select"
            value={effectType}
            onChange={e => {
              const t = e.target.value
              onEffect(t)
              setFxOpen(t !== 'None')
            }}
          >
            {EFFECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {effectType !== 'None' && (
            <button
              className={`fx-toggle-btn ${fxOpen ? 'active' : ''}`}
              onClick={() => setFxOpen(o => !o)}
              title="Effect parameters"
            >FX</button>
          )}
        </div>

        {fxOpen && effectType !== 'None' && (
          <FxPanel effectType={effectType} effectParams={effectParams} onEffectParams={onEffectParams} />
        )}

        <div className="sound-mode-row">
          <button
            className={`sound-mode-btn ${soundMode === 'percussive' ? 'active' : ''}`}
            onClick={() => onSoundMode('percussive')}
          >Perc</button>
          <button
            className={`sound-mode-btn ${soundMode === 'harmonic' ? 'active' : ''}`}
            onClick={() => onSoundMode('harmonic')}
          >Harm</button>
          {soundMode === 'harmonic' && (
            <>
              <select
                className="scale-root-select"
                value={trackScale.root}
                onChange={e => onScale({ ...trackScale, root: e.target.value })}
              >
                {NOTE_ROOTS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <select
                className="scale-type-select"
                value={trackScale.scaleType}
                onChange={e => onScale({ ...trackScale, scaleType: e.target.value })}
              >
                {SCALE_TYPES.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <StopRail
        route={route}
        progress={progress}
        mode={mode}
        vehicles={vehicles}
      />
    </div>
  )
}

// ── ADSR / param envelope panel ───────────────────────────────────────────────
function EnvPanel({ synthType, adsr, onADSR }) {
  if (synthType === 'PluckSynth') {
    return (
      <div className="adsr-panel">
        <AdsrSlider label="Noise" min={0} max={1} step={0.01}
          value={adsr?.attackNoise ?? 1}
          onChange={v => onADSR({ attackNoise: v })} />
        <AdsrSlider label="Damp" min={200} max={8000} step={10}
          value={adsr?.dampening ?? 4000}
          onChange={v => onADSR({ dampening: v })} />
        <AdsrSlider label="Res" min={0} max={0.98} step={0.01}
          value={adsr?.resonance ?? 0.7}
          onChange={v => onADSR({ resonance: v })} />
      </div>
    )
  }

  const a = adsr?.attack  ?? SYNTH_DEFAULTS['Synth'].attack
  const d = adsr?.decay   ?? SYNTH_DEFAULTS['Synth'].decay
  const s = adsr?.sustain ?? SYNTH_DEFAULTS['Synth'].sustain
  const r = adsr?.release ?? SYNTH_DEFAULTS['Synth'].release

  return (
    <div className="adsr-panel">
      <AdsrSlider label="A" min={0.001} max={2} step={0.001}
        value={a} onChange={v => onADSR({ attack: v })} />
      <AdsrSlider label="D" min={0.001} max={2} step={0.001}
        value={d} onChange={v => onADSR({ decay: v })} />
      <AdsrSlider label="S" min={0} max={1} step={0.01}
        value={s} onChange={v => onADSR({ sustain: v })} />
      <AdsrSlider label="R" min={0.01} max={4} step={0.01}
        value={r} onChange={v => onADSR({ release: v })} />
    </div>
  )
}

function AdsrSlider({ label, min, max, step, value, onChange }) {
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0
  return (
    <div className="adsr-row">
      <span className="adsr-label">{label}</span>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        className="adsr-slider"
        onChange={e => onChange(Number(e.target.value))}
      />
      <span className="adsr-val">{Number(value).toFixed(decimals)}</span>
    </div>
  )
}

// ── Effect parameter panel ────────────────────────────────────────────────────
function FxPanel({ effectType, effectParams, onEffectParams }) {
  const p = effectParams ?? {}

  if (effectType === 'Chorus') return (
    <div className="adsr-panel">
      <AdsrSlider label="Rate"  min={0.1}  max={20}   step={0.1}  value={p.frequency  ?? EFFECT_DEFAULTS.Chorus.frequency}  onChange={v => onEffectParams({ frequency: v })} />
      <AdsrSlider label="Delay" min={1}    max={20}   step={0.1}  value={p.delayTime  ?? EFFECT_DEFAULTS.Chorus.delayTime}  onChange={v => onEffectParams({ delayTime: v })} />
      <AdsrSlider label="Depth" min={0}    max={1}    step={0.01} value={p.depth      ?? EFFECT_DEFAULTS.Chorus.depth}      onChange={v => onEffectParams({ depth: v })} />
      <AdsrSlider label="Wet"   min={0}    max={1}    step={0.01} value={p.wet        ?? EFFECT_DEFAULTS.Chorus.wet}        onChange={v => onEffectParams({ wet: v })} />
    </div>
  )

  if (effectType === 'PingPongDelay') return (
    <div className="adsr-panel">
      <AdsrSlider label="Time" min={0.01} max={1}    step={0.01} value={p.delayTime ?? EFFECT_DEFAULTS.PingPongDelay.delayTime} onChange={v => onEffectParams({ delayTime: v })} />
      <AdsrSlider label="FB"   min={0}    max={0.95} step={0.01} value={p.feedback  ?? EFFECT_DEFAULTS.PingPongDelay.feedback}  onChange={v => onEffectParams({ feedback: v })} />
      <AdsrSlider label="Wet"  min={0}    max={1}    step={0.01} value={p.wet       ?? EFFECT_DEFAULTS.PingPongDelay.wet}       onChange={v => onEffectParams({ wet: v })} />
    </div>
  )

  if (effectType === 'BitCrusher') return (
    <div className="adsr-panel">
      <AdsrSlider label="Bits" min={1} max={8} step={1}    value={p.bits ?? EFFECT_DEFAULTS.BitCrusher.bits} onChange={v => onEffectParams({ bits: v })} />
      <AdsrSlider label="Wet"  min={0} max={1} step={0.01} value={p.wet  ?? EFFECT_DEFAULTS.BitCrusher.wet}  onChange={v => onEffectParams({ wet: v })} />
    </div>
  )

  if (effectType === 'Phaser') return (
    <div className="adsr-panel">
      <AdsrSlider label="Rate"    min={0.05} max={4}    step={0.05} value={p.frequency      ?? EFFECT_DEFAULTS.Phaser.frequency}      onChange={v => onEffectParams({ frequency: v })} />
      <AdsrSlider label="Oct"     min={1}    max={6}    step={1}    value={p.octaves        ?? EFFECT_DEFAULTS.Phaser.octaves}        onChange={v => onEffectParams({ octaves: v })} />
      <AdsrSlider label="Base"    min={200}  max={4000} step={10}   value={p.baseFrequency  ?? EFFECT_DEFAULTS.Phaser.baseFrequency}  onChange={v => onEffectParams({ baseFrequency: v })} />
      <AdsrSlider label="Wet"     min={0}    max={1}    step={0.01} value={p.wet            ?? EFFECT_DEFAULTS.Phaser.wet}            onChange={v => onEffectParams({ wet: v })} />
    </div>
  )

  return null
}

// ── Stop rail: stops positioned by shape_dist_traveled ────────────────────────
function StopRail({ route, progress = 0, mode = 'mock', vehicles = [] }) {
  if (!route.stops.length) return <div className="stop-rail stop-rail--empty" />

  const total = route.totalDist || route.stops[route.stops.length - 1]?.dist || 1

  // In mock mode: highlight the last stop whose position ≤ playhead progress
  const activeStopId = mode === 'mock'
    ? [...route.stops].reverse().find(s => (s.dist / total) <= progress)?.id
    : null

  // Vehicle markers for live mode
  const vehicleMarkers = mode === 'live'
    ? vehicles.map(v => {
        const ph = resolvePlayhead(route, v.lat, v.lng)
        return ph ? { ...v, pct: ph.pct } : null
      }).filter(Boolean)
    : []

  return (
    <div className="stop-rail">
      <div className="stop-rail-line" style={{ '--line-color': route.color }} />

      {route.stops.map(stop => {
        const pct = total > 0 ? (stop.dist / total) * 100 : 0
        return (
          <div
            key={stop.id}
            className={[
              'stop-dot',
              stop.id === activeStopId ? 'active' : '',
              mode === 'live' ? 'stop-dot--ref' : '',
            ].filter(Boolean).join(' ')}
            style={{ '--pos': `${pct}%`, '--line-color': route.color }}
            title={stop.name}
          >
            <span className="stop-label">{stop.name}</span>
          </div>
        )
      })}

      {vehicleMarkers.map((vm, i) => (
        <div
          key={vm.vehicleId ?? i}
          className="vehicle-marker"
          style={{ '--pos': `${vm.pct}%`, '--line-color': route.color }}
          title={`${vm.routeShortName} · ${vm.vehicleId}`}
        />
      ))}
    </div>
  )
}
