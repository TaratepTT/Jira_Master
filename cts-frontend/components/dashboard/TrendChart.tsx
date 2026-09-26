'use client'

import { useMemo, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface TicketDetail {
  key: string
  status: string
  businessUnit: string
  typeOfIssue: string
  deployDate?: string
}

type GroupMode = 'bu' | 'category' | 'status'

interface TrendChartProps {
  tickets: TicketDetail[]
}

// ── Helpers ────────────────────────────────────────────────────
const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
]

function isClosedStatus(s: string) {
  return s.toLowerCase().includes('closed') || s.toLowerCase().includes('done')
}

// ── Mini bar component ─────────────────────────────────────────
function Bar({
  label, open, closed, total, color, maxVal,
}: {
  label: string
  open: number
  closed: number
  total: number
  color: string
  maxVal: number
}) {
  const openPct  = maxVal ? (open  / maxVal) * 100 : 0
  const closePct = maxVal ? (closed / maxVal) * 100 : 0

  return (
    <div className="group relative flex items-center gap-3 py-1.5">
      {/* Label */}
      <div className="w-32 shrink-0 text-right">
        <span className="text-xs text-slate-600 dark:text-slate-300 truncate block" title={label}>{label}</span>
      </div>

      {/* Bars */}
      <div className="flex-1 flex flex-col gap-0.5">
        {/* Open bar */}
        <div className="relative h-3 rounded-sm bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-sm transition-all duration-500"
            style={{ width: `${openPct}%`, backgroundColor: color, opacity: 0.55 }}
          />
        </div>
        {/* Closed bar */}
        <div className="relative h-3 rounded-sm bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-sm transition-all duration-500"
            style={{ width: `${closePct}%`, backgroundColor: color }}
          />
        </div>
      </div>

      {/* Count */}
      <div className="w-20 shrink-0 text-xs text-slate-500 dark:text-slate-400 text-right">
        <span className="font-medium text-slate-700 dark:text-slate-200">{total}</span>
        <span className="ml-1 text-slate-400">({closed}✓)</span>
      </div>

      {/* Tooltip on hover */}
      <div className="pointer-events-none absolute left-36 bottom-full mb-1.5 hidden group-hover:flex z-20">
        <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 shadow-lg text-xs space-y-0.5 whitespace-nowrap">
          <p className="font-semibold text-slate-700 dark:text-slate-200">{label}</p>
          <p className="text-slate-500">Total: <span className="font-medium text-slate-700 dark:text-slate-200">{total}</span></p>
          <p className="text-green-600 dark:text-green-400">Closed: {closed} ({total ? Math.round(closed/total*100) : 0}%)</p>
          <p className="text-orange-500 dark:text-orange-400">Open: {open} ({total ? Math.round(open/total*100) : 0}%)</p>
        </div>
      </div>
    </div>
  )
}

// ── Donut chart (SVG) ──────────────────────────────────────────
function DonutChart({ closed, open }: { closed: number; open: number }) {
  const total = closed + open
  if (!total) return null
  const r = 36
  const circ = 2 * Math.PI * r
  const closedDash = (closed / total) * circ
  const size = 96

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background ring */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="14"
          className="text-slate-100 dark:text-slate-700"
        />
        {/* Closed arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="#10b981"
          strokeWidth="14"
          strokeDasharray={`${closedDash} ${circ - closedDash}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        {/* Open arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="14"
          strokeDasharray={`${circ - closedDash - 2} ${closedDash + 2}`}
          strokeDashoffset={circ / 4 - closedDash}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute text-center pointer-events-none">
        <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{Math.round(closed / total * 100)}%</p>
        <p className="text-[10px] text-slate-400">closed</p>
      </div>
    </div>
  )
}

// ── Main TrendChart component ──────────────────────────────────
export default function TrendChart({ tickets }: TrendChartProps) {
  const [mode, setMode] = useState<GroupMode>('bu')
  const [showAll, setShowAll] = useState(false)
  const SHOW_LIMIT = 8

  const rows = useMemo(() => {
    const map: Record<string, { open: number; closed: number }> = {}

    for (const t of tickets) {
      let key = ''
      if (mode === 'bu')       key = t.businessUnit || 'ไม่ระบุ BU'
      if (mode === 'category') key = t.typeOfIssue  || 'ไม่ระบุ Category'
      if (mode === 'status')   key = t.status       || 'ไม่ระบุ Status'

      if (!map[key]) map[key] = { open: 0, closed: 0 }
      if (isClosedStatus(t.status)) map[key].closed++
      else                          map[key].open++
    }

    return Object.entries(map)
      .map(([label, { open, closed }]) => ({ label, open, closed, total: open + closed }))
      .sort((a, b) => b.total - a.total)
  }, [tickets, mode])

  const maxVal     = Math.max(...rows.map(r => r.total), 1)
  const totalAll   = tickets.length
  const totalClosed = tickets.filter(t => isClosedStatus(t.status)).length
  const totalOpen   = totalAll - totalClosed

  const displayed  = showAll ? rows : rows.slice(0, SHOW_LIMIT)

  const modeLabel: Record<GroupMode, string> = {
    bu:       'Business Unit',
    category: 'Issue Category',
    status:   'Status',
  }

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M7 16l4-4 4 4 4-8" />
            </svg>
            Ticket Trend — จำแนกตาม {modeLabel[mode]}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">แถบบน = Open · แถบล่าง = Closed · เรียงตามจำนวนรวม</p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs font-medium">
          {(['bu', 'category', 'status'] as GroupMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setShowAll(false) }}
              className={`px-3 py-1.5 transition-colors ${
                mode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {{ bu: 'BU', category: 'Category', status: 'Status' }[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/40 p-3 flex flex-col items-center">
          <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{totalAll}</p>
          <p className="text-xs text-slate-400 mt-0.5">Total Tickets</p>
        </div>
        <div className="rounded-xl border border-green-100 dark:border-green-900/50 bg-green-50 dark:bg-green-950/20 p-3 flex flex-col items-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{totalClosed}</p>
          <p className="text-xs text-slate-400 mt-0.5">Closed</p>
        </div>
        <div className="rounded-xl border border-orange-100 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/20 p-3 flex flex-col items-center">
          <p className="text-2xl font-bold text-orange-500 dark:text-orange-400">{totalOpen}</p>
          <p className="text-xs text-slate-400 mt-0.5">Open / Pending</p>
        </div>
      </div>

      {/* Donut + Legend */}
      <div className="flex items-center gap-6 mb-5 px-1">
        <DonutChart closed={totalClosed} open={totalOpen} />
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 shrink-0" />
            <span className="text-slate-600 dark:text-slate-300">Closed ({totalClosed} tickets · {totalAll ? Math.round(totalClosed/totalAll*100) : 0}%)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-400 shrink-0" />
            <span className="text-slate-600 dark:text-slate-300">Open / Pending ({totalOpen} tickets · {totalAll ? Math.round(totalOpen/totalAll*100) : 0}%)</span>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-700">
            <span className="text-slate-400">{rows.length} กลุ่ม ({modeLabel[mode]})</span>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
        {/* Column headers */}
        <div className="flex items-center gap-3 mb-2 px-0.5">
          <div className="w-32 shrink-0" />
          <div className="flex-1 flex justify-between text-[10px] text-slate-400 px-0.5">
            <span>0</span>
            <span>{Math.round(maxVal / 2)}</span>
            <span>{maxVal}</span>
          </div>
          <div className="w-20 shrink-0 text-right text-[10px] text-slate-400">Total (✓)</div>
        </div>

        {displayed.map((row, i) => (
          <Bar
            key={row.label}
            label={row.label}
            open={row.open}
            closed={row.closed}
            total={row.total}
            color={COLORS[i % COLORS.length]}
            maxVal={maxVal}
          />
        ))}

        {rows.length > SHOW_LIMIT && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="mt-3 w-full rounded-lg border border-dashed border-slate-300 dark:border-slate-600 py-2 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            {showAll ? '▲ แสดงน้อยลง' : `▼ แสดงทั้งหมด ${rows.length} กลุ่ม`}
          </button>
        )}

        {!rows.length && (
          <p className="py-8 text-center text-sm text-slate-400">ไม่มีข้อมูล</p>
        )}
      </div>
    </div>
  )
}
