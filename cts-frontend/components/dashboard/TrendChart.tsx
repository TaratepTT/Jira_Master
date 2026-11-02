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

// Whole-number ticks only (ticket counts), at most ~5 lines
function intTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 4))
  const top = Math.max(step, Math.ceil(max / step) * step)
  const out: number[] = []
  for (let v = 0; v <= top; v += step) out.push(v)
  return out
}

function LineChart({ points }: { points: LinePoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) {
    return <p className="py-10 text-center text-[13px] text-faint">ต้องมีข้อมูลอย่างน้อย 2 ช่วงเวลาถึงจะวาดกราฟได้</p>
  }
  const W = 960, H = 210
  const PAD = { top: 14, right: 16, bottom: 30, left: 34 }
  const cw = W - PAD.left - PAD.right, ch = H - PAD.top - PAD.bottom
  const ticks = intTicks(Math.max(...points.map(p => p.total), 1))
  const maxY = ticks[ticks.length - 1]
  const step = cw / (points.length - 1)
  const x = (i: number) => PAD.left + i * step
  const y = (v: number) => PAD.top + ch - (v / maxY) * ch
  const path = (k: 'total' | 'closed' | 'open') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ')
  const area = `${path('total')} L${x(points.length - 1)},${PAD.top + ch} L${PAD.left},${PAD.top + ch} Z`
  const every = Math.max(1, Math.ceil(points.length / 10))
  const hp = hover !== null ? points[hover] : null

  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[600px]" role="img" aria-label="จำนวน ticket ตามวันที่สร้าง แยกตามสถานะปัจจุบัน">
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="fill-faint">{t}</text>
          </g>
        ))}
        <path d={area} className="fill-sunken" />
        <path d={path('total')} fill="none" className="stroke-faint" strokeWidth={1.5} strokeLinejoin="round" />
        <path d={path('closed')} fill="none" className="stroke-chart-a" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={path('open')} fill="none" className="stroke-chart-b" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" className="fill-faint">{p.label}</text>}
            {hover === i && (
              <>
                <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={PAD.top + ch} className="stroke-line-strong" strokeWidth={1} />
                <circle cx={x(i)} cy={y(p.closed)} r={4.5} className="fill-chart-a stroke-surface" strokeWidth={2} />
                <circle cx={x(i)} cy={y(p.open)} r={4.5} className="fill-chart-b stroke-surface" strokeWidth={2} />
              </>
            )}
            <rect x={x(i) - step / 2} y={PAD.top} width={step} height={ch + 20} fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
      </svg>
      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-sm"
          style={{ left: `${Math.min(78, Math.max(0, (x(hover) / W) * 100 - 8))}%` }}
        >
          <p className="mb-0.5 font-medium text-ink">{hp.label}</p>
          <p className="text-muted">สร้างทั้งหมด <span className="num font-medium text-ink">{hp.total}</span></p>
          <p className="text-muted">ปิดแล้ว <span className="num font-medium text-ink">{hp.closed}</span></p>
          <p className="text-muted">ยังเปิด <span className="num font-medium text-ink">{hp.open}</span></p>
        </div>
      )}
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

  const delta = thisWeek.total - lastWeek.total
  return (
    <div className="panel panel-pad">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">ticket ที่สร้างใหม่ตามช่วงเวลา</h2>
          <p className="section-note mt-0.5">
            สัปดาห์นี้สร้างใหม่ <span className="num text-ink">{thisWeek.total}</span> ใบ
            {lastWeek.total || thisWeek.total
              ? <> ({delta === 0 ? 'เท่ากับ' : delta > 0 ? `มากกว่า ${delta} ใบจาก` : `น้อยกว่า ${-delta} ใบจาก`}สัปดาห์ก่อนที่มี <span className="num">{lastWeek.total}</span> ใบ)</>
              : null}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-line-strong text-[12px] font-medium" role="group" aria-label="ช่วงเวลา">
          {(['weekly', 'daily'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              aria-pressed={viewMode === m}
              className={`px-3 py-1 transition-colors ${viewMode === m ? 'bg-sunken text-ink' : 'bg-surface text-muted hover:text-ink'}`}
            >
              {m === 'weekly' ? 'รายสัปดาห์' : 'รายวัน'}
            </button>
          ))}
        </div>
      </div>

      {ticketsWithDate.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-faint">ยังไม่มีวันที่สร้างของ ticket — sync ข้อมูลจาก Jira ใหม่อีกครั้ง</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted">
            <span className="flex items-center gap-1.5"><svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" className="stroke-chart-a" strokeWidth="2" /></svg>ปิดแล้ว (สถานะปัจจุบัน)</span>
            <span className="flex items-center gap-1.5"><svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" className="stroke-chart-b" strokeWidth="2" strokeDasharray="5 3" /></svg>ยังเปิด</span>
            <span className="flex items-center gap-1.5"><svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" className="stroke-faint" strokeWidth="1.5" /></svg>รวม</span>
          </div>
          <div className="mt-2"><LineChart points={points} /></div>
          {noDateCount > 0 && <p className="mt-2 text-[12px] text-faint">มี {noDateCount} ticket ที่ไม่มีวันที่สร้าง จึงไม่อยู่ในกราฟ</p>}
        </>
      )}
    </div>
  )
}
