import { useMemo, useState } from 'react'
import { requestComposition, validatePlan } from './ai/composer.js'
import './AIComposerPanel.css'

// Natural-language composer overlay for the Map tab. The user describes the
// sound they want; we ask the model for a structured plan, show a preview, and
// only touch the app's controls when they click Apply.
export default function AIComposerPanel({ className = '', routes, onApply, started }) {
  const [prompt,  setPrompt]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [result,  setResult]  = useState(null) // { plan, dropped }
  const [open,    setOpen]    = useState(true)

  const routeName = useMemo(() => {
    const m = {}
    for (const r of routes ?? []) m[r.id] = r.name ?? r.shortName ?? r.id
    return m
  }, [routes])

  const generate = async () => {
    if (!prompt.trim() || loading) return
    setLoading(true); setError(null); setResult(null)
    try {
      const raw = await requestComposition(prompt.trim(), routes)
      setResult(validatePlan(raw, routes))
    } catch (e) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  const apply = () => {
    if (!result?.plan) return
    onApply(result.plan)
    setResult(null)
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate() }
  }

  return (
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
          </div>

          {error && <div className="ai-composer-error">⚠ {error}</div>}

          {result && (
            <PlanPreview
              result={result}
              routeName={routeName}
              started={started}
              onApply={apply}
              onDiscard={() => setResult(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function PlanPreview({ result, routeName, started, onApply, onDiscard }) {
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

      {started && bpmChanges && (
        <div className="ai-composer-note">Tempo change applies on next Play.</div>
      )}

      {dropped.length > 0 && (
        <div className="ai-composer-note">Ignored {dropped.length} unsupported value{dropped.length > 1 ? 's' : ''}: {dropped.join(', ')}</div>
      )}

      <div className="ai-composer-actions">
        <button className="ai-composer-apply" onClick={onApply}>Apply</button>
        <button className="ai-composer-discard" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  )
}
