'use client'

import Spinner from '@/components/ui/Spinner'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api, {
  compareReportsApi, getReports, getRootCauseInsight,
  type CompareKpi, type ReportComparison, type RootCauseInsight,
} from '@/lib/api'
import type { ReportData } from '@/components/dashboard/types'
import {
  AGE_BUCKETS, fmtDays, formatDate, isIncomplete, median, openTicketAges, parseDate, percentile, resolutionDays,
} from '@/components/dashboard/utils'

// ── One-page summary for the weekly meeting ────────────────────
// A plain, light document laid out for A4: open it, check it, then "พิมพ์ / บันทึกเป็น PDF".
// Compared with the report just before this one (or any report picked in the toolbar).

interface ReportListItem { id: string; name: string; totalTickets: number; createdAt: string }

function Delta({ k }: { k?: CompareKpi }) {
  if (!k || k.delta === 0) return k ? <span className="text-slate-400">ไม่เปลี่ยน</span> : null
  const up = k.delta > 0
  const good = k.goodWhen === 'neutral' ? null : (k.goodWhen === 'up') === up
  const cls = good === null ? 'text-slate-500' : good ? 'text-emerald-700' : 'text-red-700'
  const v = k.unit === 'percent' ? `${Math.abs(k.delta).toFixed(1)} จุด` : Math.abs(k.delta).toLocaleString()
  return <span className={cls}>{up ? '▲' : '▼'} {v}</span>
}

function Section({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`break-inside-avoid ${className}`}>
      <h2 className="mb-2 border-b border-slate-300 pb-1 text-[13px] font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

export default function ReportSummaryPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReportData | null>(null)
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [baseId, setBaseId] = useState<string>('')
  const [cmp, setCmp] = useState<ReportComparison | null>(null)
  const [cmpError, setCmpError] = useState('')
  const [insight, setInsight] = useState<RootCauseInsight | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    api.get(`/api/reports/${id}`).then(r => setData(r.data)).catch(e => setError(e?.response?.data?.message ?? 'โหลด report ไม่สำเร็จ'))
    getReports().then((list: ReportListItem[]) => setReports(list)).catch(() => setReports([]))
    getRootCauseInsight(id).then(s => setInsight(s.latest)).catch(() => setInsight(null))
  }, [id])

  // Default comparison: the newest report created before this one
  useEffect(() => {
    if (!data || !reports.length || baseId) return
    const mine = new Date(data.createdAt).getTime()
    const prev = reports
      .filter(r => r.id !== data.id && new Date(r.createdAt).getTime() < mine)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    if (prev) setBaseId(prev.id)
  }, [data, reports, baseId])

  useEffect(() => {
    if (!id || !baseId) { setCmp(null); return }
    setCmpError('')
    compareReportsApi(baseId, id).then(setCmp).catch(e => { setCmp(null); setCmpError(e?.response?.data?.message ?? 'เปรียบเทียบไม่สำเร็จ') })
  }, [id, baseId])

  const asOf = useMemo(() => (data ? new Date(data.refreshedAt ?? data.createdAt) : new Date()), [data])
  const stats = useMemo(() => {
    if (!data) return null
    const t = data.tickets
    const ages = openTicketAges(t, asOf)
    const durations = resolutionDays(t).map(d => d.days)
    const created = t.map(x => parseDate(x.ticketCreatedAt)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())
    const top = (rec: Record<string, number>, n: number) => Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n)
    return {
      ages,
      over14: ages.filter(a => a.days > 14).length,
      bucketCounts: AGE_BUCKETS.map(b => ({ ...b, n: ages.filter(a => a.bucket === b.id).length })),
      durations,
      incomplete: t.filter(isIncomplete).length,
      range: created.length ? { from: created[0], to: created[created.length - 1] } : null,
      topBu: top(data.aggregations.buCount, 5),
      topCat: top(data.aggregations.issueTypeCount, 5),
      topStatus: top(data.aggregations.statusCount, 6),
    }
  }, [data, asOf])

  if (error) return <div className="min-h-screen bg-white flex items-center justify-center text-red-600">{error}</div>
  if (!data || !stats) return <div className="min-h-screen bg-white flex items-center justify-center gap-2 text-slate-400"><Spinner />กำลังโหลด...</div>

  const kpi = (kid: CompareKpi['id']) => cmp?.kpis.find(k => k.id === kid)
  const total = data.totalTickets
  const closed = kpi('closed')?.current ?? data.tickets.filter(t => /closed|done/i.test(t.status)).length
  const closureRate = total ? (closed / total) * 100 : 0
  const open = kpi('open')?.current ?? total - closed
  const l3 = data.aggregations.l3Tickets.length
  const bdRow = (bid: string, name: string) => cmp?.breakdowns.find(b => b.id === bid)?.rows.find(r => r.name === name)
  const fmtDelta = (d?: number) => (d === undefined || d === 0 ? '' : d > 0 ? ` (+${d})` : ` (${d})`)

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white text-slate-800">
      {/* Toolbar — not printed */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="mx-auto max-w-[210mm] px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
          <Link href={`/dashboard/${id}`} className="text-sm text-blue-600 hover:underline">← กลับไป Dashboard</Link>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-500">เทียบกับ</label>
            <select
              value={baseId}
              onChange={e => setBaseId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm max-w-[240px]"
            >
              <option value="">— ไม่เทียบ —</option>
              {reports.filter(r => r.id !== id).map(r => (
                <option key={r.id} value={r.id}>{r.name} ({formatDate(r.createdAt)})</option>
              ))}
            </select>
            <button onClick={() => window.print()} className="btn-primary">
              พิมพ์ / บันทึกเป็น PDF
            </button>
          </div>
        </div>
      </div>

      {/* The page */}
      <article className="mx-auto my-6 print:my-0 max-w-[210mm] bg-white shadow print:shadow-none px-[12mm] py-[10mm] space-y-5 text-[12px] leading-relaxed">
        <header className="flex items-end justify-between border-b-2 border-[#006a7a] pb-2">
          <div>
            <p className="text-[12px] text-slate-500">สรุปประจำสัปดาห์ ทีม CTS Tech Support</p>
            <h1 className="text-xl font-bold text-slate-900">{data.name}</h1>
            <p className="text-slate-500">
              {stats.range ? `ticket สร้างระหว่าง ${formatDate(stats.range.from.toISOString())} – ${formatDate(stats.range.to.toISOString())} · ` : ''}
              ข้อมูล ณ {formatDate(asOf.toISOString())}
            </p>
          </div>
          {cmp && <p className="text-right text-[11px] text-slate-500">เทียบกับ<br /><span className="font-medium text-slate-700">{cmp.base.name}</span></p>}
        </header>

        {cmpError && <p className="print:hidden text-xs text-red-600">{cmpError}</p>}

        {/* KPI row */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Tickets ทั้งหมด', value: total.toLocaleString(), k: kpi('total') },
            { label: 'ปิดแล้ว', value: `${closed} (${closureRate.toFixed(0)}%)`, k: kpi('closureRate') },
            { label: 'ยังเปิดอยู่', value: open.toLocaleString(), k: kpi('open') },
            { label: 'L3 / Investigate', value: l3.toLocaleString(), k: kpi('l3') },
            { label: 'ค้างเกิน 14 วัน', value: stats.over14.toLocaleString() },
          ].map(c => (
            <div key={c.label} className="rounded-lg border border-slate-200 p-2.5">
              <p className="text-[11px] text-slate-500">{c.label}</p>
              <p className="text-lg font-bold text-slate-900">{c.value}</p>
              {cmp && 'k' in c && <p className="text-[11px]"><Delta k={c.k} /></p>}
            </div>
          ))}
        </div>

        {/* Highlights */}
        <Section title="ประเด็นสำคัญ">
          <ul className="list-disc pl-5 space-y-0.5">
            {cmp && <li>ticket ใหม่ที่ไม่มีใน report ก่อน <strong>{cmp.newTickets.total}</strong> ใบ · หายไปจาก report นี้ {cmp.goneTickets.total} ใบ · เปลี่ยนสถานะ <strong>{cmp.statusChanges.total}</strong> ใบ</li>}
            <li>ปิดได้ <strong>{closureRate.toFixed(0)}%</strong> ({closed}/{total}){kpi('closureRate') ? <> — <Delta k={kpi('closureRate')} /></> : null}</li>
            {stats.ages.length > 0 && <li>ยังเปิดค้าง {stats.ages.length} ใบ, ค้างเกิน 14 วัน <strong>{stats.over14}</strong> ใบ (นานสุด {stats.ages[0].days} วัน: {stats.ages[0].ticket.key})</li>}
            {stats.durations.length > 0 && <li>เวลาแก้ไขมัธยฐาน <strong>{fmtDays(median(stats.durations))}</strong> · 90% แก้เสร็จภายใน {fmtDays(percentile(stats.durations, 90))}</li>}
            {stats.topCat[0] && <li>ประเภทที่พบมากที่สุด: <strong>{stats.topCat[0][0]}</strong> {stats.topCat[0][1]} ใบ ({Math.round((stats.topCat[0][1] / total) * 100)}%)</li>}
            {stats.incomplete > 0 && <li className="text-amber-800">ยังกรอกข้อมูลไม่ครบ {stats.incomplete} ใบ (BU / Type of Issue / Root Cause / Resolution)</li>}
          </ul>
        </Section>

        <div className="grid grid-cols-3 gap-5">
          {([
            ['Status', stats.topStatus, 'status'],
            ['Business Unit (Top 5)', stats.topBu, 'businessUnit'],
            ['Type of Issue (Top 5)', stats.topCat, 'category'],
          ] as Array<[string, Array<[string, number]>, string]>).map(([title, rows, bid]) => (
            <Section key={title} title={title}>
              <table className="w-full">
                <tbody>
                  {rows.map(([name, n]) => (
                    <tr key={name} className="border-b border-slate-100">
                      <td className="py-0.5 pr-2 truncate max-w-[120px]" title={name}>{name || 'ไม่ระบุ'}</td>
                      <td className="py-0.5 text-right font-medium whitespace-nowrap">{n}<span className="text-slate-400 font-normal">{fmtDelta(bdRow(bid, name)?.delta)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-5">
          <Section title="ticket ที่ค้างนานที่สุด">
            {stats.ages.length === 0 ? <p className="text-slate-400">ไม่มี ticket ค้าง</p> : (
              <>
                <p className="text-[11px] text-slate-500 mb-1">
                  {stats.bucketCounts.map(b => `${b.label} ${b.n}`).join(' · ')}
                </p>
                <table className="w-full">
                  <tbody>
                    {stats.ages.slice(0, 6).map(a => (
                      <tr key={a.ticket.key} className="border-b border-slate-100 align-top">
                        <td className="py-0.5 pr-2 font-semibold whitespace-nowrap">{a.days} วัน</td>
                        <td className="py-0.5 pr-2 whitespace-nowrap">{a.ticket.key}</td>
                        <td className="py-0.5 text-slate-600 line-clamp-1">{a.ticket.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Section>
          <Section title="L3 / ต้องติดตาม">
            {data.aggregations.l3Tickets.length === 0 ? <p className="text-slate-400">ไม่มี</p> : (
              <ul className="space-y-0.5">
                {data.aggregations.l3Tickets.slice(0, 8).map(t => (
                  <li key={t.key}><span className="font-medium">{t.key}</span> <span className="text-slate-600">{t.summary ?? t.bu}</span></li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {insight && insight.result.themes.length > 0 && (
          <Section title={`Root Cause ที่เกิดซ้ำ (AI · ${formatDate(insight.createdAt)})`}>
            <p className="mb-1.5 text-slate-700">{insight.result.overview}</p>
            <ol className="list-decimal pl-5 space-y-1">
              {insight.result.themes.slice(0, 5).map(th => (
                <li key={th.title}>
                  <strong>{th.title}</strong> ({th.count} ใบ) — {th.description}
                  {th.suggestedAction && <span className="block text-slate-600">แนวทาง: {th.suggestedAction}</span>}
                </li>
              ))}
            </ol>
          </Section>
        )}

        {cmp && cmp.statusChanges.items.length > 0 && (
          <Section title={`สถานะที่เปลี่ยนจาก report ก่อน (${cmp.statusChanges.total})`}>
            <table className="w-full">
              <tbody>
                {cmp.statusChanges.items.slice(0, 8).map(c => (
                  <tr key={c.key} className="border-b border-slate-100">
                    <td className="py-0.5 pr-2 whitespace-nowrap font-medium">{c.key}</td>
                    <td className="py-0.5 pr-2 whitespace-nowrap text-slate-600">{c.from} → {c.to}</td>
                    <td className="py-0.5 text-slate-500 line-clamp-1">{c.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <footer className="pt-2 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between">
          <span>สร้างจาก CTS Report Dashboard</span>
          <span>พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}</span>
        </footer>
      </article>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 0; }
          html, body { background: #fff !important; }
        }
      `}</style>
    </div>
  )
}
