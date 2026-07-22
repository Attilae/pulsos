import { useEffect, useMemo, useState } from 'react'
import { requestComposition, validatePlan } from '@/lib/ai/composer.js'
import { useEntitlements } from '@/lib/shared/EntitlementsContext.jsx'
import { factsForCity } from '@/lib/shared/cityFacts.js'
import './AIComposerPanel.css'

// Natural-language composer overlay for the Map tab. The user describes the
// sound they want; we ask the model for a structured plan, show a preview, and
// only touch the app's controls when they click Apply.
export default function AIComposerPanel({ className = '', routes, onApply, cityId, cityName }) {
  const { openUpgrade, refresh, usage, limits } = useEntitlements()
  const [prompt,  setPrompt]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [result,  setResult]  = useState(null) // { plan, dropped }
  const [open,    setOpen]    = useState(true)
  const [applied, setApplied] = useState(null)
  const [applying, setApplying] = useState(false)
  const [factIndex, setFactIndex] = useState(0)

  const facts = useMemo(() => factsForCity(cityId), [cityId])

  useEffect(() => {
    if (!loading || facts.length < 2) return undefined
    const timer = setInterval(() => setFactIndex(index => (index + 1) % facts.length), 7000)
    return () => clearInterval(timer)
  }, [loading, facts])

  const routeName = useMemo(() => {
    const m = {}
    for (const r of routes ?? []) m[r.id] = r.name ?? r.shortName ?? r.id
    return m
  }, [routes])

  const generate = async () => {
    if (!prompt.trim() || loading) return
    setFactIndex(Math.floor(Math.random() * facts.length))
    setLoading(true); setError(null); setResult(null); setApplied(null); setApplying(false)
    try {
      const maxTracks = Math.min(routes?.length ?? 1, limits.activeLanes ?? 8)
      const raw = await requestComposition(prompt.trim(), routes, { cityId, cityName, maxTracks })
      setResult(validatePlan(raw, routes, { activeLaneLimit: maxTracks }))
      await refresh()
    } catch (e) {
      if (e?.code === 'ai_limit_reached') {
        await refresh()
        openUpgrade('ai_limit')
      }
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  const apply = async () => {
    if (!result?.plan || applying) return
    setApplying(true)
    setError(null)
    try {
      const outcome = await onApply(result.plan)
      const count = outcome?.appliedCount ?? result.plan.tracks?.length ?? 0
      setApplied(`Applied ${count} track${count === 1 ? '' : 's'} — playing`)
    } catch (e) {
      setError(e?.message ?? String(e))
    } finally {
      setApplying(false)
    }
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate() }
  }

  return (
    <>
      {loading ? (
        <div className="ai-planning-overlay">
          <div className="ai-planning-grid" aria-hidden="true" />
          <div className="ai-planning-card">
            <div className="ai-planning-signal" aria-hidden="true">
              <span /><span /><span /><span /><span />
            </div>
            <div className="ai-planning-kicker">Leið · {cityName}</div>
            <h2 role="status" aria-live="polite">Arranging your transit loop…</h2>
            <p className="ai-planning-fact" aria-hidden="true">{facts[factIndex]}</p>
            <div className="ai-planning-progress" aria-hidden="true"><span /></div>
          </div>
        </div>
      ) : null}

      <div className={`ai-composer ${className}`}>
      <button className="ai-composer-head" onClick={() => setOpen(o => !o)}>
        <span className="ai-composer-title">✦ AI Composer</span>
        <span className="ai-composer-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="ai-composer-body">
          <textarea
            className="ai-composer-input"
            placeholder="Describe what you want to hear — e.g. “slow dubby ambient at 80 bpm in A dorian; metro on warm FM Rhodes drenched in cave reverb, trams as quiet metallic ticks panned wide.”"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            rows={4}
            disabled={loading}
          />

          <div className="ai-composer-actions">
            <button
              className="ai-composer-generate"
              onClick={generate}
              disabled={loading || !prompt.trim()}
            >
              {loading ? 'Composing…' : 'Generate'}
            </button>
            <span className="ai-composer-hint">⌘/Ctrl + ↵</span>
            {usage.ai.remaining != null ? <span className="ai-composer-hint">{usage.ai.remaining} free</span> : null}
          </div>

          {error && <div className="ai-composer-error">⚠ {error}</div>}
          {applied && <div className="ai-composer-success">✓ {applied}</div>}

          {result && (
            <PlanPreview
              result={result}
              routeName={routeName}
              applied={!!applied}
              applying={applying}
              onApply={apply}
              onDiscard={() => { setResult(null); setApplied(null) }}
            />
          )}
        </div>
      )}
      </div>
    </>
  )
}

function PlanPreview({ result, routeName, applied, applying, onApply, onDiscard }) {
  const { plan, dropped } = result
  const bpmChanges = plan.bpm != null

  return (
    <div className="ai-composer-preview">
      {plan.summary && <p className="ai-preview-summary">{plan.summary}</p>}

      <div className="ai-preview-tags">
        {bpmChanges && <span className="ai-tag">{plan.bpm} BPM</span>}
        {plan.harmony && <span className="ai-tag">{plan.harmony.root} {plan.harmony.scaleType}</span>}
        {plan.masterVolume != null && <span className="ai-tag">master {plan.masterVolume} dB</span>}
      </div>

      {plan.tracks?.length > 0 && (
        <div className="ai-preview-section">
          <div className="ai-preview-label">Tracks</div>
          <ul className="ai-preview-list">
            {plan.tracks.map(t => (
              <li key={t.routeId}>
                <span className="ai-preview-route">{routeName[t.routeId] ?? t.routeId}</span>
                <span className="ai-preview-detail">
                  {[
                    t.synthType,
                    t.samplerPreset,
                    t.scale && `${t.scale.root} ${t.scale.scaleType}`,
                    t.octave ? `${t.octave > 0 ? '+' : ''}${t.octave}oct` : null,
                    t.volume != null && `${t.volume}dB`,
                    t.drone?.enabled && 'drone',
                    t.speed != null && `${t.speed}×`,
                    t.gridResolution,
                    t.loopRegion && `cells ${t.loopRegion.startCell}–${t.loopRegion.endCell}`,
                    t.pitchVariety && `${t.pitchVariety.contour} ${Math.round(t.pitchVariety.variety * 100)}%`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.fx?.length > 0 && (
        <div className="ai-preview-section">
          <div className="ai-preview-label">Effects</div>
          <ul className="ai-preview-list">
            {plan.fx.map(f => (
              <li key={f.busId}>
                <span className="ai-preview-route">{f.busId}</span>
                <span className="ai-preview-detail">
                  {[
                    f.wet != null && `wet ${Math.round(f.wet * 100)}%`,
                    ...Object.entries(f.params ?? {}).map(([k, v]) => `${k} ${v}`),
                    f.sends?.length && `→ ${f.sends.length} send${f.sends.length > 1 ? 's' : ''}`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dropped.length > 0 && (
        <div className="ai-composer-note">Ignored {dropped.length} unsupported value{dropped.length > 1 ? 's' : ''}: {dropped.join(', ')}</div>
      )}

      <div className="ai-composer-actions">
        <button className="ai-composer-apply" onClick={onApply} disabled={applied || applying}>{applied ? 'Applied' : applying ? 'Applying…' : 'Apply & Play'}</button>
        <button className="ai-composer-discard" onClick={onDiscard} disabled={applying}>Discard</button>
      </div>
    </div>
  )
}
