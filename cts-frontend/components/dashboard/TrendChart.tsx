'use client'

import { useMemo, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface TicketDetail {
  key: string
  status: string
  businessUnit: string
  typeOfIssue: string
  ticketCreatedAt?: string | null
}

type ViewMode = 'weekly' | 'daily'

interface TrendChartProps {
  tickets: TicketDetail[]
}

// ── Helpers ────────────────────────────────────────────────────
function isClosedStatus(s: string) {
  return s.toLowerCase().includes('closed') || s.toLowerCase().includes('done')
}

function getWeekLabel(date: Date): string {
  // Monday of that week
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

function getDayLabel(date: Date): string {
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

function getWeekKey(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// ── SVG Line Chart ─────────────────────────────────────────────
interface LinePoint { label: string; open: number; closed: number; total: number }

function LineChart({ points }: { points: LinePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-slate-400">
        ข้อมูลไม่เพียงพอสำหรับแสดงกราฟเส้น (ต้องการอย่างน้อย 2 จุด)
      </div>
    )
  }

  const W = 600
  const H = 180
  const PAD = { top: 16, right: 20, bottom: 40, left: 36 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxY = Math.max(...points.map(p => p.total), 1)
  const xStep = chartW / (points.length - 1)

  const toX = (i: number) => PAD.left + i * xStep
  const toY = (v: number) => PAD.top + chartH - (v / maxY) * chartH

  // Build SVG path
  const pathTotal  = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.total).toFixed(1)}`).join(' ')
  const pathClosed = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.closed).toFixed(1)}`).join(' ')
  const pathOpen   = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.open).toFixed(1)}`).join(' ')

  // Area fill for total
  const areaTotal = `${pathTotal} L${toX(points.length-1).toFixed(1)},${(PAD.top+chartH).toFixed(1)} L${PAD.left.toFixed(1)},${(PAD.top+chartH).toFixed(1)} Z`

  // Y-axis grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: PAD.top + chartH * (1 - f),
    label: Math.round(maxY * f),
  }))

  // Hover state
  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: Math.max(points.length * 60, 320) }}
      >
        {/* Grid lines */}
        {gridLines.map(g => (
          <g key={g.y}>
            <line
              x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y}
              stroke="currentColor" strokeOpacity="0.08" strokeWidth="1"
              className="text-slate-500"
            />
            <text
              x={PAD.left - 6} y={g.y + 4}
              textAnchor="end" fontSize="10"
              className="fill-slate-400"
            >{g.label}</text>
          </g>
        ))}

        {/* Area fill */}
        <path d={areaTotal} fill="#3b82f6" fillOpacity="0.07" />

        {/* Lines */}
        <path d={pathTotal}  fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={pathClosed} fill="none" stroke="#10b981" strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" strokeDasharray="0" />
        <path d={pathOpen}   fill="none" stroke="#f59e0b" strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 2" />

        {/* Data points + tooltips */}
        {points.map((p, i) => (
          <g key={i} className="group">
            {/* X-axis label */}
            <text
              x={toX(i)} y={H - 6}
              textAnchor="middle" fontSize="10"
              className="fill-slate-400"
            >{p.label}</text>

            {/* Vertical hover line */}
            <line
              x1={toX(i)} y1={PAD.top} x2={toX(i)} y2={PAD.top + chartH}
              stroke="currentColor" strokeWidth="1" strokeOpacity="0"
              className="text-slate-400 group-hover:stroke-opacity-30 transition-all"
            />

            {/* Dots */}
            <circle cx={toX(i)} cy={toY(p.total)}  r="4" fill="#3b82f6" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            <circle cx={toX(i)} cy={toY(p.closed)} r="3.5" fill="#10b981" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            <circle cx={toX(i)} cy={toY(p.open)}   r="3.5" fill="#f59e0b" className="opacity-0 group-hover:opacity-100 transition-opacity" />

            {/* Tooltip box */}
            <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <rect
                x={Math.min(toX(i) - 44, W - PAD.right - 90)}
                y={PAD.top}
                width="90" height="60"
                rx="6"
                fill="currentColor" fillOpacity="0.92"
                className="text-slate-800 dark:text-slate-700"
              />
              <text x={Math.min(toX(i) - 44, W - PAD.right - 90) + 8} y={PAD.top + 16} fontSize="10" fontWeight="600" className="fill-slate-100">{p.label}</text>
              <text x={Math.min(toX(i) - 44, W - PAD.right - 90) + 8} y={PAD.top + 30} fontSize="10" className="fill-blue-300">Total: {p.total}</text>
              <text x={Math.min(toX(i) - 44, W - PAD.right - 90) + 8} y={PAD.top + 43} fontSize="10" className="fill-emerald-400">Closed: {p.closed}</text>
              <text x={Math.min(toX(i) - 44, W - PAD.right - 90) + 8} y={PAD.top + 56} fontSize="10" className="fill-amber-400">Open: {p.open}</text>
            </g>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Week comparison card ───────────────────────────────────────
function WeekCompareCard({
  label, current, previous,
}: {
  label: string
  current: number
  previous: number
}) {
  const diff = current - previous
  const pct  = previous > 0 ? Math.round(Math.abs(diff) / previous * 100) : 0
  const up   = diff > 0
  const same = diff === 0

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{current}</p>
      <div className="flex items-center gap-1 mt-1">
        {same ? (
          <span className="text-xs text-slate-400">— เท่าเดิม</span>
        ) : (
          <>
            <span className={`text-xs font-medium ${up ? 'text-rose-500' : 'text-emerald-500'}`}>
              {up ? '▲' : '▼'} {pct}%
            </span>
            <span className="text-xs text-slate-400">vs สัปดาห์ที่แล้ว ({previous})</span>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────
export default function TrendChart({ tickets }: TrendChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('weekly')

  // กรองเฉพาะ ticket ที่มีวันที่
  const ticketsWithDate = useMemo(
    () => tickets.filter(t => t.ticketCreatedAt),
    [tickets]
  )

  const noDateCount = tickets.length - ticketsWithDate.length

  // Build timeline data points
  const points = useMemo(() => {
    const map = new Map<string, { label: string; open: number; closed: number; ts: number }>()

    for (const t of ticketsWithDate) {
      const date = new Date(t.ticketCreatedAt!)
      if (isNaN(date.getTime())) continue

      const key   = viewMode === 'weekly' ? getWeekKey(date) : getDayKey(date)
      const label = viewMode === 'weekly' ? getWeekLabel(date) : getDayLabel(date)

      if (!map.has(key)) map.set(key, { label, open: 0, closed: 0, ts: date.getTime() })
      const entry = map.get(key)!
      if (isClosedStatus(t.status)) entry.closed++
      else entry.open++
    }

    return Array.from(map.values())
      .sort((a, b) => a.ts - b.ts)
      .map(e => ({ label: e.label, open: e.open, closed: e.closed, total: e.open + e.closed }))
  }, [ticketsWithDate, viewMode])

  // สัปดาห์ปัจจุบัน vs สัปดาห์ที่แล้ว
  const { thisWeek, lastWeek } = useMemo(() => {
    const now = new Date()
    const thisKey = getWeekKey(now)
    const lastDate = new Date(now)
    lastDate.setDate(lastDate.getDate() - 7)
    const lastKey = getWeekKey(lastDate)

    const tw = { total: 0, closed: 0, open: 0 }
    const lw = { total: 0, closed: 0, open: 0 }

    for (const t of ticketsWithDate) {
      const date = new Date(t.ticketCreatedAt!)
      if (isNaN(date.getTime())) continue
      const key = getWeekKey(date)
      const closed = isClosedStatus(t.status)
      if (key === thisKey) {
        tw.total++
        closed ? tw.closed++ : tw.open++
      } else if (key === lastKey) {
        lw.total++
        closed ? lw.closed++ : lw.open++
      }
    }
    return { thisWeek: tw, lastWeek: lw }
  }, [ticketsWithDate])

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 16l4-4 4 4 4-8" />
            </svg>
            Ticket Trend — เปรียบเทียบตามเวลา
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            เส้นน้ำเงิน = Total · เส้นเขียว = Closed · เส้นเหลือง (ประ) = Open
          </p>
        </div>

        {/* Toggle weekly / daily */}
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs font-medium">
          {(['weekly', 'daily'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`px-3 py-1.5 transition-colors ${
                viewMode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {m === 'weekly' ? 'รายสัปดาห์' : 'รายวัน'}
            </button>
          ))}
        </div>
      </div>

      {/* No date warning */}
      {noDateCount > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 px-4 py-2.5 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
          มี <strong>{noDateCount} ticket</strong> ที่ยังไม่มีวันที่สร้าง — จะแสดงหลัง Sync ใหม่
        </div>
      )}

      {/* Week-on-week comparison */}
      <div>
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
          สัปดาห์นี้ vs สัปดาห์ที่แล้ว
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <WeekCompareCard label="Total Tickets"  current={thisWeek.total}  previous={lastWeek.total} />
          <WeekCompareCard label="Closed"         current={thisWeek.closed} previous={lastWeek.closed} />
          <WeekCompareCard label="Open / Pending" current={thisWeek.open}   previous={lastWeek.open} />
        </div>
      </div>

      {/* Line chart */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
          Trend {viewMode === 'weekly' ? 'รายสัปดาห์' : 'รายวัน'}
        </p>

        {ticketsWithDate.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
            <svg className="h-10 w-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3v18h18M7 16l4-4 4 4 4-8" />
            </svg>
            <p className="text-sm">ยังไม่มีข้อมูลวันที่</p>
            <p className="text-xs text-center max-w-xs">
              Sync ข้อมูลจาก Jira ใหม่หลัง deploy ครั้งนี้<br/>เพื่อให้ระบบบันทึกวันที่สร้าง ticket
            </p>
          </div>
        ) : (
          <>
            <LineChart points={points} />

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 bg-blue-500 rounded" />
                Total
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-6 bg-emerald-500 rounded" />
                Closed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-amber-400 rounded" style={{borderBottom:'2px dashed #f59e0b', background:'none', height:0}} />
                <svg width="24" height="4"><line x1="0" y1="2" x2="24" y2="2" stroke="#f59e0b" strokeWidth="2" strokeDasharray="4 2"/></svg>
                Open
              </span>
              <span className="ml-auto text-slate-400">
                {ticketsWithDate.length} tickets · {points.length} {viewMode === 'weekly' ? 'สัปดาห์' : 'วัน'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
