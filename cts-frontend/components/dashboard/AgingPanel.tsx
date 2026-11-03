'use client'

import { useMemo, useState } from 'react'
import type { TicketDetail } from './types'
import { AGE_BUCKETS, formatDate, openTicketAges, statusBadge, type AgeBucketId } from './utils'

// Older = stronger, one hue (age is a magnitude). Mixed from the "attention" token so the
// ramp follows light/dark mode. Labels always carry the number, so colour is never alone.
const BUCKET_MIX: Record<AgeBucketId, number> = { '0-3': 22, '4-7': 40, '8-14': 60, '15-30': 80, '30+': 100 }
const bucketBg = (id: AgeBucketId) => ({ background: `color-mix(in srgb, var(--attention) ${BUCKET_MIX[id]}%, var(--surface))` })

// ── Aging: how long open tickets have been waiting ─────────────
// Age = from ticket creation to the report's data date (last refresh, or when it was synced).
export default function AgingPanel({
  tickets, asOf, onOpenTicket,
}: {
  tickets: TicketDetail[]
  asOf: Date
  onOpenTicket: (key: string) => void
}) {
  const [bucketFilter, setBucketFilter] = useState<AgeBucketId | null>(null)
  const ages = useMemo(() => openTicketAges(tickets, asOf), [tickets, asOf])
  const noDate = useMemo(
    () => tickets.filter(t => !t.ticketCreatedAt).length,
    [tickets],
  )

  const counts = useMemo(() => {
    const c = Object.fromEntries(AGE_BUCKETS.map(b => [b.id, 0])) as Record<AgeBucketId, number>
    ages.forEach(a => { c[a.bucket]++ })
    return c
  }, [ages])

  const byBu = useMemo(() => {
    const m = new Map<string, Record<AgeBucketId, number> & { total: number }>()
    for (const a of ages) {
      const bu = a.ticket.businessUnit || 'ไม่ระบุ'
      let row = m.get(bu)
      if (!row) {
        row = { ...(Object.fromEntries(AGE_BUCKETS.map(b => [b.id, 0])) as Record<AgeBucketId, number>), total: 0 }
        m.set(bu, row)
      }
      row[a.bucket]++
      row.total++
    }
    return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 8)
  }, [ages])

  const open = ages.length
  const over14 = ages.filter(a => a.days > 14).length
  const avg = open ? ages.reduce((s, a) => s + a.days, 0) / open : 0
  const list = (bucketFilter ? ages.filter(a => a.bucket === bucketFilter) : ages).slice(0, 10)

  return (
    <div className="panel panel-pad">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="section-title">ticket ที่ยังเปิดค้าง</h2>
          <p className="text-xs text-faint mt-0.5">
            อายุนับจากวันสร้างถึง {formatDate(asOf.toISOString())} ไม่นับ ticket ที่ Closed, Done, Resolved หรือ Cancel แล้ว
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <div><p className="text-xl font-semibold text-ink">{open}</p><p className="text-[11px] text-faint">เปิดค้าง</p></div>
          <div><p className="text-xl font-semibold text-ink">{avg ? avg.toFixed(1) : '0'}</p><p className="text-[11px] text-faint">อายุเฉลี่ย (วัน)</p></div>
          <div><p className={`text-xl font-semibold ${over14 ? 'text-attention' : 'text-ink'}`}>{over14}</p><p className="text-[11px] text-faint">เกิน 14 วัน</p></div>
        </div>
      </div>

      {open === 0 ? (
        <p className="text-sm text-faint py-6 text-center">
          ไม่มี ticket ที่เปิดค้าง{noDate > 0 ? ` (มี ${noDate} ticket ที่ไม่มีวันสร้าง — ไม่ถูกนับ)` : ''}
        </p>
      ) : (
        <>
          {/* Stacked bar: share of open tickets per age bucket (2px gaps between segments) */}
          <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="สัดส่วนอายุของ ticket ที่เปิดค้าง">
            {AGE_BUCKETS.map(b => counts[b.id] > 0 && (
              <div
                key={b.id}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ ...bucketBg(b.id), width: `${(counts[b.id] / open) * 100}%` }}
                title={`${b.label}: ${counts[b.id]} ticket`}
              />
            ))}
          </div>
          {/* Legend = filter */}
          <div className="mt-3 flex flex-wrap gap-2">
            {AGE_BUCKETS.map(b => (
              <button
                key={b.id}
                onClick={() => setBucketFilter(f => (f === b.id ? null : b.id))}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  bucketFilter === b.id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted hover:bg-sunken'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-sm" style={bucketBg(b.id)} />
                {b.label}
                <span className="font-semibold">{counts[b.id]}</span>
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* Oldest open tickets */}
            <div>
              <p className="text-xs font-semibold text-muted mb-2">
                ค้างนานที่สุด{bucketFilter ? ` · ${AGE_BUCKETS.find(b => b.id === bucketFilter)?.label}` : ''}
              </p>
              <ul className="divide-y divide-line">
                {list.map(a => (
                  <li key={a.ticket.key}>
                    <button
                      onClick={() => onOpenTicket(a.ticket.key)}
                      className="w-full flex items-center gap-3 py-2 text-left hover:bg-sunken rounded-lg px-1.5 -mx-1.5 transition-colors"
                    >
                      <span className="w-14 shrink-0 text-right text-sm font-semibold text-ink">{a.days} วัน</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-accent">{a.ticket.key}</span>
                        <span className="block truncate text-xs text-muted">{a.ticket.summary || '—'}</span>
                      </span>
                      <span className={`shrink-0 max-w-[120px] truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(a.ticket.status)}`}>{a.ticket.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* BU x age bucket */}
            <div className="overflow-x-auto">
              <p className="text-xs font-semibold text-muted mb-2">แยกตาม Business Unit (8 อันดับแรก)</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-1.5 pr-2 text-left font-medium">BU</th>
                    {AGE_BUCKETS.map(b => <th key={b.id} className="py-1.5 px-1 text-right font-medium whitespace-nowrap">{b.id}</th>)}
                    <th className="py-1.5 pl-2 text-right font-medium">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {byBu.map(([bu, row]) => (
                    <tr key={bu} className="border-b border-line text-muted">
                      <td className="py-1.5 pr-2 max-w-[140px] truncate" title={bu}>{bu}</td>
                      {AGE_BUCKETS.map(b => (
                        <td key={b.id} className={`py-1.5 px-1 text-right ${row[b.id] && (b.id === '15-30' || b.id === '30+') ? 'font-semibold text-attention' : ''}`}>
                          {row[b.id] || <span className="text-faint">·</span>}
                        </td>
                      ))}
                      <td className="py-1.5 pl-2 text-right font-semibold">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {noDate > 0 && <p className="mt-3 text-[11px] text-faint">มี {noDate} ticket ที่ไม่มีวันสร้าง จึงไม่ถูกนับใน Aging</p>}
        </>
      )}
    </div>
  )
}
