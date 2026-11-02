import { pct } from './utils'

export default function ProgressBar({ label, count, total, color = 'bg-accent' }: { label: string; count: number; total: number; color?: string }) {
  const p = pct(count, total)
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-muted mb-1">
        <span>{label}</span><span className="font-medium">{count} · {p}%</span>
      </div>
      <div className="h-2 rounded-full bg-sunken overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}
