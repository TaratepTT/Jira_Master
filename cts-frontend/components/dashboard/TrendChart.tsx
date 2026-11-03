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

// ── Chart data ─────────────────────────────────────────────────
interface LinePoint { label: string; open: number; closed: number; total: number }

// Whole-number ticks only (ticket counts), at most ~5 lines
function intTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 4))
  const top = Math.max(step, Math.ceil(max / step) * step)
  const out: number[] = []
  for (let v = 0; v <= top; v += step) out.push(v)
  return out
}

// Stacked bars: each period = tickets created then, split by where they are now (closed at the
// bottom, still open on top), so the open part — the work left — is what stands out.
function StackedBars({ points }: { points: LinePoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!points.length) return null
  const W = 960, H = 220
  const PAD = { top: 14, right: 12, bottom: 30, left: 34 }
  const cw = W - PAD.left - PAD.right, ch = H - PAD.top - PAD.bottom
  const ticks = intTicks(Math.max(...points.map(p => p.total), 1))
  const maxY = ticks[ticks.length - 1]
  const slot = cw / points.length
  const bw = Math.max(4, Math.min(36, slot * 0.62))
  const x = (i: number) => PAD.left + i * slot + slot / 2
  const y = (v: number) => PAD.top + ch - (v / maxY) * ch
  const every = Math.max(1, Math.ceil(points.length / 10))
  const hp = hover !== null ? points[hover] : null
  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[600px]" role="img" aria-label="จำนวน ticket ที่สร้างในแต่ละช่วง แยกเป็นปิดแล้วและยังเปิด">
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="fill-faint">{t}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const yc = y(p.closed), yt = y(p.total)
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.45}>
              {p.closed > 0 && <rect x={x(i) - bw / 2} y={yc} width={bw} height={PAD.top + ch - yc} rx={2} className="fill-ok" />}
              {p.open > 0 && <rect x={x(i) - bw / 2} y={yt} width={bw} height={yc - yt - (p.closed > 0 ? 1.5 : 0)} rx={2} className="fill-chart-b" />}
              {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" className="fill-faint">{p.label}</text>}
              <rect x={x(i) - slot / 2} y={PAD.top} width={slot} height={ch + 20} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-sm"
          style={{ left: `${Math.min(78, Math.max(0, (x(hover) / W) * 100 - 8))}%` }}
        >
          <p className="mb-0.5 font-medium text-ink">{hp.label}</p>
          <p className="text-muted">สร้างทั้งหมด <span className="num font-medium text-ink">{hp.total}</span></p>
          <p className="text-muted">ยังเปิด <span className="num font-medium text-ink">{hp.open}</span></p>
          <p className="text-muted">ปิดแล้ว <span className="num font-medium text-ink">{hp.closed}</span></p>
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

    const sorted = Array.from(map.entries()).sort((a, b) => a[1].ts - b[1].ts)
    if (!sorted.length) return []
    // fill the periods with no new tickets, so a quiet week shows as a gap and not as nothing
    const stepDays = viewMode === 'weekly' ? 7 : 1
    const out: LinePoint[] = []
    const first = new Date(sorted[0][0] + 'T00:00:00Z'), last = new Date(sorted[sorted.length - 1][0] + 'T00:00:00Z')
    for (let d = first, n = 0; d <= last && n < 120; d = new Date(d.getTime() + stepDays * 864e5), n++) {
      const k = d.toISOString().slice(0, 10)
      const e = map.get(k)
      const label = e?.label ?? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      out.push({ label, open: e?.open ?? 0, closed: e?.closed ?? 0, total: (e?.open ?? 0) + (e?.closed ?? 0) })
    }
    return out
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
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-chart-b" aria-hidden />ยังเปิด</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ok" aria-hidden />ปิดแล้ว (สถานะปัจจุบัน)</span>
          </div>
          <div className="mt-2"><StackedBars points={points} /></div>
          {noDateCount > 0 && <p className="mt-2 text-[12px] text-faint">มี {noDateCount} ticket ที่ไม่มีวันที่สร้าง จึงไม่อยู่ในกราฟ</p>}
        </>
      )}
    </div>
  )
}
