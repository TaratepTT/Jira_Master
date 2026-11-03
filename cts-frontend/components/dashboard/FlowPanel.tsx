'use client'

import { useMemo, useState } from 'react'
import type { TicketDetail } from './types'
import { fmtDays, median, parseDate, percentile, resolutionDays, shortThaiDate, weekKey } from './utils'

const MAX_WEEKS = 12
// Validated pair (light: blue-600 / amber-600, dark: blue-500 / amber-600) — distinct for colour-blind readers too
const CREATED_FILL = 'fill-chart-a'
const RESOLVED_FILL = 'fill-chart-b'

interface Week { key: string; created: number; resolved: number }

function buildWeeks(tickets: TicketDetail[]): Week[] {
  const m = new Map<string, Week>()
  const bump = (d: Date | null, field: 'created' | 'resolved') => {
    if (!d) return
    const k = weekKey(d)
    const w = m.get(k) ?? { key: k, created: 0, resolved: 0 }
    w[field]++
    m.set(k, w)
  }
  for (const t of tickets) {
    bump(parseDate(t.ticketCreatedAt), 'created')
    bump(parseDate(t.resolvedAt), 'resolved')
  }
  if (!m.size) return []
  // Fill empty weeks between the first and last so gaps are visible
  const keys = Array.from(m.keys()).sort()
  const out: Week[] = []
  const cur = new Date(`${keys[0]}T00:00:00`)
  const last = new Date(`${keys[keys.length - 1]}T00:00:00`)
  while (cur <= last) {
    const k = weekKey(cur)
    out.push(m.get(k) ?? { key: k, created: 0, resolved: 0 })
    cur.setDate(cur.getDate() + 7)
  }
  return out.slice(-MAX_WEEKS)
}

function FlowChart({ weeks }: { weeks: Week[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 960, H = 210
  const PAD = { top: 12, right: 8, bottom: 28, left: 32 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom
  const maxY = Math.max(1, ...weeks.map(w => Math.max(w.created, w.resolved)))
  const niceMax = maxY <= 5 ? maxY : Math.ceil(maxY / 5) * 5
  const slot = cw / weeks.length
  const barW = Math.max(4, Math.min(18, (slot - 10) / 2))
  const y = (v: number) => PAD.top + ch - (v / niceMax) * ch
  const ticks = niceMax <= 5 ? Array.from({ length: niceMax + 1 }, (_, i) => i) : [0, niceMax / 5 * 1, niceMax / 5 * 2, niceMax / 5 * 3, niceMax / 5 * 4, niceMax]
  const labelEvery = weeks.length > 8 ? 2 : 1

  // Bar with a 4px rounded top anchored to the baseline
  const bar = (x: number, v: number) => {
    if (v <= 0) return ''
    const top = y(v), base = PAD.top + ch, r = Math.min(4, (base - top), barW / 2)
    return `M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${base} Z`
  }

  const hw = hover !== null ? weeks[hover] : null
  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[600px]" role="img" aria-label="จำนวน ticket ที่สร้างและที่ resolve ต่อสัปดาห์">
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="11" className="fill-faint">{Math.round(t)}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x0 = PAD.left + i * slot + (slot - (barW * 2 + 2)) / 2
          return (
            <g key={w.key}>
              {hover === i && <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={ch} className="fill-sunken" />}
              <path d={bar(x0, w.created)} className={CREATED_FILL} />
              <path d={bar(x0 + barW + 2, w.resolved)} className={RESOLVED_FILL} />
              {i % labelEvery === 0 && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 10} textAnchor="middle" fontSize="11" className="fill-faint">{shortThaiDate(w.key)}</text>
              )}
              {/* hit target: the whole week column */}
              <rect
                x={PAD.left + i * slot} y={PAD.top} width={slot} height={ch + 16} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              />
            </g>
          )
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + ch} y2={PAD.top + ch} className="stroke-line-strong" strokeWidth={1} />
      </svg>
      {hw && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-sm"
          style={{ left: `${Math.min(80, Math.max(0, ((PAD.left + hover * slot) / W) * 100))}%` }}
        >
          <p className="font-medium text-ink mb-1">สัปดาห์ {shortThaiDate(hw.key)}</p>
          <p className="text-muted">สร้างใหม่ <strong>{hw.created}</strong></p>
          <p className="text-muted">Resolve <strong>{hw.resolved}</strong></p>
          <p className="text-muted">สุทธิ {hw.created - hw.resolved > 0 ? '+' : ''}{hw.created - hw.resolved}</p>
        </div>
      )}
    </div>
  )
}

// ── Created vs Resolved + time to resolve ──────────────────────
export default function FlowPanel({
  tickets, canRefresh, onRefresh, refreshing,
}: {
  tickets: TicketDetail[]
  canRefresh: boolean
  onRefresh: () => void
  refreshing: boolean
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const weeks = useMemo(() => buildWeeks(tickets), [tickets])
  const hasResolved = useMemo(() => tickets.some(t => t.resolvedAt), [tickets])
  const durations = useMemo(() => resolutionDays(tickets), [tickets])

  const byCategory = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const d of durations) {
      const c = d.ticket.typeOfIssue || 'ไม่ระบุ'
      const list = m.get(c)
      if (list) list.push(d.days)
      else m.set(c, [d.days])
    }
    return Array.from(m.entries())
      .map(([category, days]) => ({ category, count: days.length, median: median(days), p90: percentile(days, 90) }))
      .sort((a, b) => b.median - a.median)
  }, [durations])

  const allDays = durations.map(d => d.days)
  const createdTotal = weeks.reduce((s, w) => s + w.created, 0)
  const resolvedTotal = weeks.reduce((s, w) => s + w.resolved, 0)

  return (
    <div className="panel panel-pad">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h2 className="section-title">Created vs Resolved และเวลาที่ใช้แก้</h2>
          <p className="section-note mt-0.5">นับเฉพาะ ticket ใน report นี้ ย้อนหลัง {MAX_WEEKS} สัปดาห์</p>
        </div>
        {hasResolved && weeks.length > 0 && (
          <div className="flex rounded-lg border border-line overflow-hidden text-xs">
            {(['chart', 'table'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 ${view === v ? 'bg-sunken font-medium text-ink' : 'text-muted'}`}
              >
                {v === 'chart' ? 'กราฟ' : 'ตาราง'}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasResolved ? (
        <div className="mt-4 rounded-lg border border-dashed border-line-strong p-5 text-center">
          <p className="text-sm text-muted">report นี้ยังไม่มีวันที่ resolve ของ ticket (สร้างก่อนที่ระบบจะเก็บค่านี้)</p>
          {canRefresh ? (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              aria-busy={refreshing}
              className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50"
            >
              {refreshing ? 'กำลังดึงจาก Jira...' : 'รีเฟรชจาก Jira เพื่อดึงวันที่ resolve'}
            </button>
          ) : (
            <p className="mt-2 text-xs text-faint">ให้ผู้มีสิทธิ์ editor กด &quot;รีเฟรชจาก Jira&quot;</p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><svg width="10" height="10"><rect width="10" height="10" rx="2" className={CREATED_FILL} /></svg>สร้างใหม่ {createdTotal}</span>
            <span className="flex items-center gap-1.5"><svg width="10" height="10"><rect width="10" height="10" rx="2" className={RESOLVED_FILL} /></svg>Resolve {resolvedTotal}</span>
          </div>

          {view === 'chart' ? (
            <div className="mt-2"><FlowChart weeks={weeks} /></div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th className="py-1.5 text-left font-medium">สัปดาห์ (เริ่มวันจันทร์)</th>
                    <th className="py-1.5 text-right font-medium">สร้างใหม่</th>
                    <th className="py-1.5 text-right font-medium">Resolve</th>
                    <th className="py-1.5 text-right font-medium">สุทธิ</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map(w => (
                    <tr key={w.key} className="border-b border-line text-muted">
                      <td className="py-1.5">{shortThaiDate(w.key)}</td>
                      <td className="py-1.5 text-right">{w.created}</td>
                      <td className="py-1.5 text-right">{w.resolved}</td>
                      <td className="py-1.5 text-right font-medium">{w.created - w.resolved > 0 ? '+' : ''}{w.created - w.resolved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-line">
            <div className="flex flex-wrap gap-6 mb-3">
              <div><p className="text-xl font-semibold text-ink">{allDays.length ? fmtDays(median(allDays)) : '—'}</p><p className="text-[11px] text-faint">เวลาแก้ (มัธยฐาน)</p></div>
              <div><p className="text-xl font-semibold text-ink">{allDays.length ? fmtDays(percentile(allDays, 90)) : '—'}</p><p className="text-[11px] text-faint">90% แก้เสร็จภายใน</p></div>
              <div><p className="text-xl font-semibold text-ink">{allDays.length}</p><p className="text-[11px] text-faint">ticket ที่มีวันที่ resolve</p></div>
            </div>
            {byCategory.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-1.5 text-left font-medium">Type of Issue</th>
                      <th className="py-1.5 text-right font-medium">จำนวน</th>
                      <th className="py-1.5 text-right font-medium">มัธยฐาน</th>
                      <th className="py-1.5 text-right font-medium">90%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCategory.map(r => (
                      <tr key={r.category} className="border-b border-line text-muted">
                        <td className="py-1.5">{r.category}</td>
                        <td className="py-1.5 text-right">{r.count}</td>
                        <td className="py-1.5 text-right font-medium">{fmtDays(r.median)}</td>
                        <td className="py-1.5 text-right">{fmtDays(r.p90)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
