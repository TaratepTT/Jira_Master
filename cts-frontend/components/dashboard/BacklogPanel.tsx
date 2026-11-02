'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBacklog, type BacklogPoint } from '@/lib/api'

// Open tickets in each report, oldest -> newest. Each bar is one report (one sync); the darker
// part is what had already been open for more than 14 days. Click a bar to open that report.
export default function BacklogPanel() {
  const router = useRouter()
  const [rows, setRows] = useState<BacklogPoint[] | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => { getBacklog().then(setRows).catch(() => setRows([])) }, [])

  if (!rows || rows.length < 2) return null

  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  const delta = last.open - prev.open
  const W = 960, H = 190
  const PAD = { top: 12, right: 12, bottom: 30, left: 34 }
  const cw = W - PAD.left - PAD.right, ch = H - PAD.top - PAD.bottom
  const maxOpen = Math.max(1, ...rows.map(r => r.open))
  const step = Math.max(1, Math.ceil(maxOpen / 4))
  const top = Math.ceil(maxOpen / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  const slot = cw / rows.length
  const barW = Math.max(6, Math.min(36, slot * 0.6))
  const y = (v: number) => PAD.top + ch - (v / top) * ch
  const every = Math.max(1, Math.ceil(rows.length / 12))
  const label = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
  const hp = hover !== null ? rows[hover] : null

  return (
    <section className="panel panel-pad mb-8" aria-labelledby="backlog-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="backlog-title" className="section-title">งานค้างในแต่ละรอบ</h2>
          <p className="section-note mt-0.5">
            report ล่าสุดยังเปิดอยู่ <span className="num text-ink">{last.open}</span> ใบ
            {delta === 0 ? ' เท่ากับรอบก่อน' : delta > 0
              ? <>, <span className="text-attention">มากกว่ารอบก่อน {delta} ใบ</span></>
              : <>, <span className="text-ok">น้อยกว่ารอบก่อน {-delta} ใบ</span></>}
            {last.over14 > 0 && <>, ในจำนวนนี้ค้างเกิน 14 วัน <span className="num text-ink">{last.over14}</span> ใบ</>}
          </p>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><svg width="10" height="10" aria-hidden><rect width="10" height="10" rx="2" className="fill-chart-a" /></svg>เปิดไม่เกิน 14 วัน</span>
          <span className="flex items-center gap-1.5"><svg width="10" height="10" aria-hidden><rect width="10" height="10" rx="2" className="fill-chart-b" /></svg>ค้างเกิน 14 วัน</span>
        </div>
      </div>

      <div className="relative mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[600px]" role="img" aria-label="จำนวน ticket ที่ยังเปิดของแต่ละ report">
          {ticks.map(t => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" className="fill-faint">{t}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2
            const fresh = r.open - r.over14
            const hOld = (r.over14 / top) * ch
            const hFresh = (fresh / top) * ch
            const base = PAD.top + ch
            return (
              <g key={r.id}>
                {hover === i && <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={ch} className="fill-sunken" />}
                {/* bottom = older than 14 days, 2px surface gap, then the rest */}
                {r.over14 > 0 && <rect x={x} y={base - hOld} width={barW} height={hOld} rx={2} className="fill-chart-b" />}
                {fresh > 0 && <rect x={x} y={base - hOld - hFresh - (r.over14 > 0 ? 2 : 0)} width={barW} height={hFresh} rx={3} className="fill-chart-a" />}
                {i % every === 0 && <text x={x + barW / 2} y={H - 10} textAnchor="middle" fontSize="11" className="fill-faint">{label(r.date)}</text>}
                <rect
                  x={PAD.left + i * slot} y={PAD.top} width={slot} height={ch + 22} fill="transparent" className="cursor-pointer"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                  onClick={() => router.push(`/dashboard/${r.id}`)}
                >
                  <title>{`${r.name}: เปิดอยู่ ${r.open} จาก ${r.total}`}</title>
                </rect>
              </g>
            )
          })}
        </svg>
        {hp && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-sm"
            style={{ left: `${Math.min(76, Math.max(0, ((PAD.left + hover * slot) / W) * 100 - 6))}%` }}
          >
            <p className="mb-0.5 font-medium text-ink">{hp.name}</p>
            <p className="text-muted">{label(hp.date)}</p>
            <p className="text-muted">ยังเปิด <span className="num font-medium text-ink">{hp.open}</span> จาก <span className="num">{hp.total}</span></p>
            <p className="text-muted">ค้างเกิน 14 วัน <span className="num font-medium text-ink">{hp.over14}</span></p>
            <p className="text-muted">L3 <span className="num font-medium text-ink">{hp.l3}</span></p>
          </div>
        )}
      </div>
      <p className="mt-2 text-[12px] text-faint">แต่ละแท่งคือ report หนึ่งรอบ นับตามสถานะตอน sync หรือรีเฟรชล่าสุด คลิกแท่งเพื่อเปิด report นั้น</p>
    </section>
  )
}
