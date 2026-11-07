import { Square } from 'lucide-react'
export function ProgressStop({ progress, label, onStop }: { progress?: number; label: string; onStop: () => void }) {
  const value = progress === undefined ? undefined : Math.round(Math.max(0, Math.min(1, progress)) * 100)
  return <span className="progress-stop-wrap"><button type="button" className={`progress-stop${value === undefined ? ' indeterminate' : ''}`} aria-label={`Stop ${label}`} title={value === undefined ? label : `${label} · ${value}%`} onClick={onStop}>
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="progress-track" cx="18" cy="18" r="15" /><circle className="progress-value" cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${value === undefined ? 28 : value} 100`} /></svg><Square aria-hidden="true" />
  </button><span className="sr-only" role="status">{label}{value === undefined ? '' : ` ${value}%`}</span></span>
}
