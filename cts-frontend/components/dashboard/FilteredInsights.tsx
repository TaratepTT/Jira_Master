import type { TicketDetail } from './types'
import { isClosedStatus, isL3Status, pct, statusBadge } from './utils'

// ── Filtered Insights panel ────────────────────────────────────
export default function FilteredInsights({ tickets }: { tickets: TicketDetail[] }) {
  const total = tickets.length
  if (!total) return null

  const closedN    = tickets.filter(t => isClosedStatus(t.status)).length
  const l3N        = tickets.filter(t => isL3Status(t.status)).length
  const deployedN  = tickets.filter(t => !!t.deployDate).length

  const statusCounts: Record<string, number> = {}
  const buCounts: Record<string, number> = {}
  tickets.forEach(t => {
    const s = t.status || 'ไม่ระบุ'
    const b = t.businessUnit || 'ไม่ระบุ'
    statusCounts[s] = (statusCounts[s] ?? 0) + 1
    buCounts[b] = (buCounts[b] ?? 0) + 1
  })
  const statusEntries = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])
  const buEntries = Object.entries(buCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)

  return (
    <div className="mb-5 rounded-lg border border-line bg-sunken p-5 space-y-5">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M18.7 8l-5.1 5.1-2.8-2.8L7 14" />
        </svg>
        <h3 className="text-sm font-semibold text-ink">ภาพรวมของข้อมูลที่กรองอยู่</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-surface border border-line p-3">
          <p className="text-xl font-semibold text-ink">{total}</p>
          <p className="text-xs text-faint mt-0.5">Tickets ที่กรองได้</p>
        </div>
        <div className="rounded-lg bg-surface border border-line p-3">
          <p className="text-xl font-semibold text-ok">{pct(closedN, total)}%</p>
          <p className="text-xs text-faint mt-0.5">Closure rate ({closedN})</p>
        </div>
        <div className="rounded-lg bg-surface border border-line p-3">
          <p className={`text-xl font-semibold ${l3N ? 'text-attention' : 'text-ink'}`}>{l3N}</p>
          <p className="text-xs text-faint mt-0.5">L3 escalation</p>
        </div>
        <div className="rounded-lg bg-surface border border-line p-3">
          <p className="text-xl font-semibold text-accent">{pct(deployedN, total)}%</p>
          <p className="text-xs text-faint mt-0.5">Deployed ({deployedN}/{total})</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg bg-surface border border-line p-4">
          <p className="text-xs font-semibold text-muted mb-3">Status ในกลุ่มที่กรอง</p>
          {statusEntries.map(([s, c]) => (
            <div key={s} className="mb-2.5 last:mb-0">
              <div className="flex justify-between items-center text-xs text-muted mb-1">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${statusBadge(s)}`}>{s}</span>
                <span className="font-medium">{c} · {pct(c, total)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-sunken overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct(c, total)}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-surface border border-line p-4">
          <p className="text-xs font-semibold text-muted mb-3">Business Unit ในกลุ่มที่กรอง</p>
          {buEntries.map(([b, c]) => (
            <div key={b} className="mb-2.5 last:mb-0">
              <div className="flex justify-between items-center text-xs text-muted mb-1">
                <span className="truncate max-w-[160px]">{b}</span>
                <span className="font-medium flex-shrink-0">{c} · {pct(c, total)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-sunken overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct(c, total)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-surface border border-line p-4">
        <div className="flex justify-between items-center text-xs text-muted mb-1.5">
          <span className="font-medium">Deploy Progress</span>
          <span>{deployedN} deployed · {total - deployedN} pending</span>
        </div>
        <div className="h-2.5 rounded-full bg-sunken overflow-hidden flex">
          <div className="h-full bg-accent" style={{ width: `${pct(deployedN, total)}%` }} />
        </div>
      </div>
    </div>
  )
}
