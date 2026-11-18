import { IconReset } from './icons.jsx'

export default function SnapshotBar({ snapshot, loading, started, onRefetch, variant = 'desktop' }) {
  return (
    <div className={`snapshot-bar snapshot-bar--${variant}`}>
      <span className="snapshot-label" role="status">
        {snapshot ? `${snapshot.vehicles?.length ?? 0} vehicles loaded` : 'No snapshot loaded'}
      </span>
      <button type="button" className="refetch-btn" onClick={onRefetch} disabled={loading || started}>
        {loading ? 'Fetching…' : <><IconReset /> Refetch</>}
      </button>
    </div>
  )
}
