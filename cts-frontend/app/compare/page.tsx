'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell, { PageHeader } from '@/components/layout/AppShell'
import { jiraBrowseUrl } from '@/components/dashboard/utils'
import {
  getReports, compareReportsApi,
  type CompareKpi, type CompareListed, type CompareRange, type CompareTable, type ReportComparison,
} from '@/lib/api'

interface ReportOption { id: string; name: string; totalTickets: number; createdAt: string }

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
}

// ── KPI card ──────────────────────────────────────────────────
function KpiCard({ k }: { k: CompareKpi }) {
  const isPct = k.unit === 'percent'
  const fmt = (n: number) => (isPct ? `${n}%` : String(n))
  // good / bad colouring, driven by what an increase means for this KPI
  let tone = 'text-muted'
  if (k.delta !== 0 && k.goodWhen !== 'neutral') {
    const good = (k.delta > 0) === (k.goodWhen === 'up')
    tone = good ? 'text-ok' : 'text-danger'
  }
  const arrow = k.delta > 0 ? '▲' : k.delta < 0 ? '▼' : '–'
  const deltaText = k.delta === 0
    ? 'ไม่เปลี่ยน'
    : isPct ? `${sign(k.delta)} จุด` : `${sign(k.delta)}${k.deltaPct !== null ? ` (${k.deltaPct > 0 ? '+' : k.deltaPct < 0 ? '−' : ''}${Math.abs(k.deltaPct)}%)` : ''}`

  return (
    <div className="px-4 py-3.5">
      <p className="text-[12px] text-muted">{k.label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none text-ink num">{fmt(k.current)}</p>
      <p className="mt-2 text-[12px]">
        <span className={`font-medium ${tone}`}>{k.delta !== 0 && <span aria-hidden>{arrow} </span>}{deltaText}</span>
        <span className="text-faint"> จาก {fmt(k.base)}</span>
      </p>
    </div>
  )
}

// ── Breakdown table ───────────────────────────────────────────
function BreakdownCard({ t, baseLabel, currentLabel }: { t: CompareTable; baseLabel: string; currentLabel: string }) {
  const max = Math.max(1, ...t.rows.map(r => Math.max(r.base, r.current)))
  return (
    <div className="panel panel-pad">
      <h3 className="mb-3 text-[14px] font-semibold text-ink">{t.label}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-faint border-b border-line">
              <th className="text-left font-medium py-1.5 pr-3">รายการ</th>
              <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap" title={baseLabel}>ก่อนหน้า</th>
              <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap" title={currentLabel}>ล่าสุด</th>
              <th className="text-right font-medium py-1.5 pl-2">เปลี่ยน</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map(r => (
              <tr key={r.name} className="border-b border-line">
                <td className="py-1.5 pr-3 text-ink">
                  <p className="break-words">{r.name}</p>
                  <div className="mt-1 h-1 rounded-full bg-sunken overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${(r.current / max) * 100}%` }} />
                  </div>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted">{r.base}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-medium text-ink">{r.current}</td>
                <td className={`py-1.5 pl-2 text-right tabular-nums text-xs font-medium ${r.delta > 0 ? 'text-accent' : r.delta < 0 ? 'text-attention' : 'text-faint'}`}>
                  {r.delta > 0 ? '▲ ' : r.delta < 0 ? '▼ ' : ''}{sign(r.delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KeyLink({ k }: { k: string }) {
  return (
    <a href={jiraBrowseUrl(k)} target="_blank" rel="noopener noreferrer" className="key whitespace-nowrap text-accent hover:underline">
      {k}
    </a>
  )
}

function ListCard<T>({ title, hint, list, render, open }: {
  title: string; hint: string; list: CompareListed<T>; render: (item: T) => React.ReactNode; open?: boolean
}) {
  if (list.total === 0) return null
  return (
    <details open={open} className="rounded-lg border border-line bg-surface group">
      <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[14px] font-semibold text-ink">{title} <span className="font-normal text-muted num">({list.total})</span></p>
          <p className="text-xs text-faint mt-0.5">{hint}</p>
        </div>
        <svg className="h-4 w-4 text-faint transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
      </summary>
      <div className="border-t border-line px-5 py-3 space-y-2">
        {list.items.map((it, i) => <div key={i} className="text-sm">{render(it)}</div>)}
        {list.total > list.items.length && (
          <p className="text-xs text-faint pt-1">แสดง {list.items.length} จาก {list.total} รายการ</p>
        )}
      </div>
    </details>
  )
}

function WindowLine({ label, name, createdAt, total, range }: { label: string; name: string; createdAt: string; total: number; range: CompareRange }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="text-sm font-medium text-ink break-words">{name}</p>
      <p className="text-xs text-muted">
        {total} tickets, sync เมื่อ {fmtDateTime(createdAt)}
      </p>
      <p className="text-xs text-faint">
        {range.withDate > 0 ? `ticket ถูกสร้างระหว่าง ${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'ไม่มีข้อมูลวันที่สร้าง ticket'}
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────
function CompareInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [reports, setReports] = useState<ReportOption[] | null>(null)
  const [baseId, setBaseId] = useState('')
  const [currentId, setCurrentId] = useState('')
  const [data, setData] = useState<ReportComparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)

  // 1) load the report list and pick sensible defaults (latest report vs the one before it)
  useEffect(() => {
    getReports()
      .then((list: ReportOption[]) => {
        const sorted = [...list].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        setReports(sorted)
        const cur = sorted.find(r => r.id === params.get('current')) ?? sorted[0]
        const explicitBase = sorted.find(r => r.id === params.get('base') && r.id !== cur?.id)
        const base = explicitBase ?? sorted[sorted.findIndex(r => r.id === cur?.id) + 1]
        setCurrentId(cur?.id ?? '')
        setBaseId(base?.id ?? '')
      })
      .catch(e => { setReports([]); setError(errMsg(e, 'โหลดรายการ report ไม่สำเร็จ')) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2) compare whenever both sides are chosen (ignore answers that arrive out of order)
  useEffect(() => {
    if (!baseId || !currentId) { setData(null); return }
    if (baseId === currentId) { setData(null); setError('เลือก report เดียวกันสองฝั่งไม่ได้ — เลือกคนละ report'); return }
    const mine = ++seq.current
    setLoading(true); setError('')
    compareReportsApi(baseId, currentId)
      .then(d => { if (mine === seq.current) setData(d) })
      .catch(e => { if (mine === seq.current) { setData(null); setError(errMsg(e, 'เปรียบเทียบไม่สำเร็จ')) } })
      .finally(() => { if (mine === seq.current) setLoading(false) })
    router.replace(`/compare?base=${baseId}&current=${currentId}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, currentId])

  const label = (r: ReportOption) => `${r.name} (${r.totalTickets} tickets, ${fmtDate(r.createdAt)})`
  const selectCls = 'field py-2 text-[14px]'

  return (
    <AppShell>
      <PageHeader title="เปรียบเทียบ report" description="ดูว่าระหว่างสอง report อะไรเปลี่ยนไปบ้าง เช่น สัปดาห์นี้เทียบสัปดาห์ก่อน" />
      <div className="space-y-6">
        {reports === null ? (
          <div className="h-32 animate-pulse rounded-lg bg-sunken" />
        ) : reports.length < 2 ? (
          <div className="rounded-lg border border-dashed border-line-strong py-16 text-center">
            <p className="text-muted">ต้องมี report อย่างน้อย 2 รายการจึงจะเปรียบเทียบได้</p>
            <Link href="/" className="mt-3 inline-block text-sm text-accent hover:underline">กลับหน้าแรก</Link>
          </div>
        ) : (
          <>
            {/* Pickers */}
            <section className="panel panel-pad">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-end">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">report ก่อนหน้า (ฐานเปรียบเทียบ)</label>
                  <select value={baseId} onChange={e => setBaseId(e.target.value)} className={selectCls}>
                    <option value="">— เลือก —</option>
                    {reports.map(r => <option key={r.id} value={r.id}>{label(r)}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => { setBaseId(currentId); setCurrentId(baseId) }}
                  title="สลับสองฝั่ง"
                  aria-label="สลับสองฝั่ง"
                  className="btn h-[38px]"
                >สลับ</button>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">report ล่าสุด (ที่ต้องการดู)</label>
                  <select value={currentId} onChange={e => setCurrentId(e.target.value)} className={selectCls}>
                    <option value="">— เลือก —</option>
                    {reports.map(r => <option key={r.id} value={r.id}>{label(r)}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {error && (
              <div className="rounded-lg border border-line bg-sunken px-4 py-3">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            {loading && <div className="h-40 animate-pulse rounded-lg bg-sunken" />}

            {!loading && !error && !data && (!baseId || !currentId) && (
              <p className="rounded-lg border border-dashed border-line-strong py-10 text-center text-sm text-faint">
                เลือก report ให้ครบทั้งสองฝั่งเพื่อเปรียบเทียบ
              </p>
            )}

            {data && !loading && (
              <>
                {/* What is being compared */}
                <section className="panel panel-pad space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <WindowLine label="ก่อนหน้า" name={data.base.name} createdAt={data.base.createdAt} total={data.kpis[0].base} range={data.windows.base} />
                    <WindowLine label="ล่าสุด" name={data.current.name} createdAt={data.current.createdAt} total={data.kpis[0].current} range={data.windows.current} />
                  </div>
                  <p className="border-t border-line pt-3 text-xs text-muted leading-relaxed">
                    {data.overlap.both > 0 ? (
                      <>อยู่ในทั้งสอง report <strong>{data.overlap.both}</strong> ticket, ใหม่ใน report ล่าสุด <strong>{data.overlap.onlyCurrent}</strong>, หายไปจาก report ล่าสุด <strong>{data.overlap.onlyBase}</strong> (อาจเพราะ JQL/ช่วงเวลาของสอง report ต่างกัน)</>
                    ) : (
                      <span className="text-attention">ไม่มี ticket ซ้ำกันเลยระหว่างสอง report จึงเห็นได้เฉพาะการเปลี่ยนของภาพรวม (ไม่มีรายการที่เปลี่ยนสถานะ)</span>
                    )}
                    {' '}ตัวเลขทั้งหมดคือ ticket ที่อยู่ในแต่ละ report ตอน sync
                  </p>
                </section>

                {/* KPIs */}
                <section className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
                  {data.kpis.map(k => <KpiCard key={k.id} k={k} />)}
                </section>

                {/* What changed */}
                <ListCard
                  title="ticket ที่เปลี่ยนสถานะ" open
                  hint="อยู่ในทั้งสอง report แต่สถานะไม่เหมือนเดิม"
                  list={data.statusChanges}
                  render={c => (
                    <div className="flex items-start gap-3 flex-wrap">
                      <KeyLink k={c.key} />
                      <span className="text-muted min-w-0 flex-1 break-words">{c.summary}</span>
                      <span className="text-xs whitespace-nowrap">
                        <span className="rounded bg-sunken px-1.5 py-0.5 text-muted">{c.from}</span>
                        <span className="mx-1 text-faint">→</span>
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">{c.to}</span>
                      </span>
                    </div>
                  )}
                />
                <ListCard
                  title="ticket ใหม่ใน report ล่าสุด"
                  hint="ไม่มีใน report ก่อนหน้า"
                  list={data.newTickets}
                  render={t => (
                    <div className="flex items-start gap-3 flex-wrap">
                      <KeyLink k={t.key} />
                      <span className="text-muted min-w-0 flex-1 break-words">{t.summary}</span>
                      <span className="text-xs text-faint whitespace-nowrap">{t.category}, {t.status}</span>
                    </div>
                  )}
                />
                <ListCard
                  title="ticket ที่หายไปจาก report ล่าสุด"
                  hint="มีใน report ก่อนหน้า แต่ไม่มีในฉบับล่าสุด (อาจอยู่นอกช่วง JQL)"
                  list={data.goneTickets}
                  render={t => (
                    <div className="flex items-start gap-3 flex-wrap">
                      <KeyLink k={t.key} />
                      <span className="text-muted min-w-0 flex-1 break-words">{t.summary}</span>
                      <span className="text-xs text-faint whitespace-nowrap">{t.category}, {t.status}</span>
                    </div>
                  )}
                />

                {/* Breakdowns */}
                <section className="grid gap-5 lg:grid-cols-2">
                  {data.breakdowns.map(b => (
                    <BreakdownCard key={b.id} t={b} baseLabel={data.base.name} currentLabel={data.current.name} />
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

// useSearchParams() must sit inside a Suspense boundary for the production build.
export default function ComparePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <CompareInner />
    </Suspense>
  )
}
