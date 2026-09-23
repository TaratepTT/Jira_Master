'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────
interface FreqRow { rank: number; category: string; count: number; pct: string; keys: string[] }
interface BuTop { name: string; count: number }
interface L3Ticket { key: string; bu: string; status: string; summary?: string }
interface TicketDetail {
  key: string
  system: string
  status: string
  businessUnit: string
  typeOfIssue: string
  recurringCategory: string
  standaloneCategory: string
  summary?: string
  rootCause?: string
  resolution?: string
  deployDate?: string
}
interface Aggregations {
  systemCount: Record<string, number>
  statusCount: Record<string, number>
  buCount: Record<string, number>
  issueTypeCount: Record<string, number>
  frequencyTable: FreqRow[]
  top5Bu: BuTop[]
  top3Cat: FreqRow[]
  l3Tickets: L3Ticket[]
}
interface ReportData {
  id: string; name: string; totalTickets: number; createdAt: string
  tickets: TicketDetail[]
  aggregations: Aggregations
}

// ── Helpers ───────────────────────────────────────────────────
function pct(n: number, total: number) { return total ? Math.round(n / total * 100) : 0 }
const STATUS_COLOR: Record<string, string> = {
  closed: 'bg-green-100 text-green-700',
  'l3-investigate': 'bg-orange-100 text-orange-700',
  default: 'bg-slate-100 text-slate-600',
}
function statusBadge(s: string) {
  const k = s.toLowerCase().replace(/\s+/g, '-')
  return STATUS_COLOR[k] ?? (k.includes('l3') || k.includes('invest') ? STATUS_COLOR['l3-investigate'] : STATUS_COLOR.default)
}
function formatDate(d?: string) {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Sub-components ────────────────────────────────────────────
function ProgressBar({ label, count, total, color = 'bg-blue-500' }: { label: string; count: number; total: number; color?: string }) {
  const p = pct(count, total)
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-slate-600 mb-1">
        <span>{label}</span><span className="font-medium">{count} · {p}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

// ── Ticket Detail Modal ──────────────────────────────────────
function TicketDetailModal({ ticket, onClose }: { ticket: TicketDetail; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-slate-400">Ticket</p>
            <p className="text-lg font-semibold text-blue-600">{ticket.key}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 text-sm">
          {ticket.summary && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Summary</p>
              <p className="text-slate-700">{ticket.summary}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Status</p>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(ticket.status)}`}>
                {ticket.status}
              </span>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">System</p>
              <p className="text-slate-700">{ticket.system}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Business Unit</p>
              <p className="text-slate-700">{ticket.businessUnit || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Type of Issue</p>
              <p className="text-slate-700">{ticket.typeOfIssue || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Deploy Date</p>
              <p className="text-slate-700">
                {ticket.deployDate
                  ? <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {formatDate(ticket.deployDate)}
                    </span>
                  : <span className="text-slate-300">ยังไม่ deploy</span>}
              </p>
            </div>
          </div>

          {/* Root Cause */}
          <div className="rounded-xl bg-red-50 border border-red-100 p-4">
            <p className="text-xs font-semibold text-red-700 mb-1.5 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Root Cause
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">
              {ticket.rootCause || <span className="text-slate-400 italic">ไม่มีข้อมูล</span>}
            </p>
          </div>

          {/* Resolution */}
          <div className="rounded-xl bg-green-50 border border-green-100 p-4">
            <p className="text-xs font-semibold text-green-700 mb-1.5 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Resolution
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">
              {ticket.resolution || <span className="text-slate-400 italic">ไม่มีข้อมูล</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main dashboard ─────────────────────────────────────────────
export default function DashboardPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!id) return
    api.get(`/api/reports/${id}`)
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.message ?? 'โหลด report ไม่สำเร็จ'))
  }, [id])

  if (error) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-red-500 font-medium">{error}</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline">กลับหน้าหลัก</Link>
      </div>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="space-y-3 w-full max-w-2xl px-6">
        {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-slate-200 animate-pulse" />)}
      </div>
    </div>
  )

  const { aggregations: ag, totalTickets, name, createdAt, tickets } = data
  const closedN = ag.statusCount['Closed'] ?? 0
  const l3N = ag.l3Tickets.length
  const systemEntries = Object.entries(ag.systemCount).sort((a,b) => b[1]-a[1])
  const statusEntries = Object.entries(ag.statusCount).sort((a,b) => b[1]-a[1])
  const buEntries = Object.entries(ag.buCount).sort((a,b) => b[1]-a[1])
  const catEntries = Object.entries(ag.issueTypeCount).sort((a,b) => b[1]-a[1])

  const filteredTickets = tickets.filter(t =>
    !search ||
    t.key.toLowerCase().includes(search.toLowerCase()) ||
    (t.summary ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (t.rootCause ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
            </Link>
            <div>
              <p className="text-sm font-semibold text-slate-800">{name}</p>
              <p className="text-xs text-slate-400">{totalTickets} tickets · {new Date(createdAt).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' })}</p>
            </div>
          </div>
          <a href={`${process.env.NEXT_PUBLIC_API_URL}/api/export/${id}`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
            Export CSV
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">

        {/* Executive Summary */}
        <section className="rounded-2xl bg-gradient-to-br from-blue-700 to-blue-500 p-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-2">Executive Summary</p>
          <p className="text-lg font-medium leading-relaxed mb-5">
            ช่วงนี้ทีม Tech Support จัดการ <strong>{totalTickets} tickets</strong> ทั้งหมด
            ปิดได้ <strong>{pct(closedN, totalTickets)}%</strong> ({closedN} tickets)
            {l3N > 0 && ` · ยังมี ${l3N} ticket ที่อยู่ระหว่างสอบสวน (L3)`}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white/15 rounded-xl p-3"><p className="text-2xl font-semibold">{totalTickets}</p><p className="text-xs opacity-75 mt-0.5">Total tickets</p></div>
            <div className="bg-white/15 rounded-xl p-3"><p className="text-2xl font-semibold">{pct(closedN,totalTickets)}%</p><p className="text-xs opacity-75 mt-0.5">Closure rate</p></div>
            <div className="bg-white/15 rounded-xl p-3"><p className="text-2xl font-semibold">{l3N}</p><p className="text-xs opacity-75 mt-0.5">L3 escalation</p></div>
            <div className="bg-white/15 rounded-xl p-3"><p className="text-2xl font-semibold">{Object.keys(ag.systemCount).length}</p><p className="text-xs opacity-75 mt-0.5">Systems</p></div>
            <div className="bg-white/15 rounded-xl p-3"><p className="text-2xl font-semibold">{ag.top5Bu[0]?.count ?? 0}</p><p className="text-xs opacity-75 mt-0.5">{ag.top5Bu[0]?.name ?? '-'}</p></div>
            <div className="bg-white/15 rounded-xl p-3"><p className="text-2xl font-semibold">{ag.top3Cat[0]?.count ?? 0}</p><p className="text-xs opacity-75 mt-0.5">{ag.top3Cat[0]?.category ?? '-'}</p></div>
          </div>
        </section>

        {/* L3 Alert */}
        {l3N > 0 && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-5 py-4">
            <p className="text-sm font-semibold text-orange-800 mb-2">⚠ L3-INVESTIGATE — ต้องติดตาม</p>
            {ag.l3Tickets.map(t => (
              <p key={t.key} className="text-sm text-orange-700">{t.key}: {t.summary ?? t.bu}</p>
            ))}
          </div>
        )}

        {/* Row 1: System + Status */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl bg-white border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Issue Type — ระบบ</h2>
            {systemEntries.map(([s, c]) => <ProgressBar key={s} label={s} count={c} total={totalTickets} color="bg-blue-500" />)}
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Status Type</h2>
            {statusEntries.map(([s, c]) => (
              <div key={s} className="mb-3">
                <div className="flex justify-between items-center text-xs text-slate-600 mb-1">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(s)}`}>{s}</span>
                  <span className="font-medium">{c} · {pct(c, totalTickets)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-slate-400 transition-all" style={{ width: `${pct(c, totalTickets)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 2: BU + Category */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl bg-white border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Business Unit</h2>
            <p className="text-xs text-slate-400 mb-4">Top 5 BU</p>
            <ol className="mb-4 space-y-1">
              {ag.top5Bu.map((b, i) => <li key={b.name} className="text-sm text-slate-600">{i+1}. {b.name} <span className="text-slate-400">({b.count})</span></li>)}
            </ol>
            {buEntries.map(([b, c]) => <ProgressBar key={b} label={b} count={c} total={totalTickets} color="bg-purple-400" />)}
          </div>
          <div className="rounded-2xl bg-white border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Ticket Type Category</h2>
            <p className="text-xs text-slate-400 mb-4">Top 3 category: {ag.top3Cat.map(c => c.category).join(', ')}</p>
            {catEntries.map(([c, n]) => <ProgressBar key={c} label={c} count={n} total={totalTickets} color="bg-teal-500" />)}
          </div>
        </div>

        {/* Frequency Table */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Ticket Frequency by Category</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">ลำดับ</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Category</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">จำนวน</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-500">%</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Ticket Keys</th>
                </tr>
              </thead>
              <tbody>
                {ag.frequencyTable.map(row => (
                  <tr key={row.rank} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 text-slate-500">{row.rank}</td>
                    <td className="py-2 px-3 font-medium text-slate-700">{row.category}</td>
                    <td className="py-2 px-3 text-right">{row.count}</td>
                    <td className="py-2 px-3 text-right text-slate-500">{row.pct}</td>
                    <td className="py-2 px-3 text-xs text-blue-600 max-w-xs truncate">{row.keys.join(', ')}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2 px-3">-</td>
                  <td className="py-2 px-3">Grand Total</td>
                  <td className="py-2 px-3 text-right">{totalTickets}</td>
                  <td className="py-2 px-3 text-right">100.00%</td>
                  <td className="py-2 px-3">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Issue Detail — Root Cause & Resolution & Deploy */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-700">Issue Detail — Root Cause, Resolution & Deploy</h2>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา Key, Summary, Root Cause..."
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors w-64"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Key</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Summary</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Root Cause</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Resolution</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Deploy</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => (
                  <tr
                    key={t.key}
                    onClick={() => setSelectedTicket(t)}
                    className="border-b border-slate-100 hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-3 font-medium text-blue-600 whitespace-nowrap">{t.key}</td>
                    <td className="py-2 px-3 text-slate-700 max-w-[180px] truncate">{t.summary || '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadge(t.status)}`}>{t.status}</span>
                    </td>
                    <td className="py-2 px-3 text-slate-600 max-w-[200px] truncate">{t.rootCause || <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 px-3 text-slate-600 max-w-[200px] truncate">{t.resolution || <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {t.deployDate ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          {formatDate(t.deployDate)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredTickets.length && (
                  <tr><td colSpan={6} className="py-6 text-center text-slate-400 text-sm">ไม่พบข้อมูลที่ตรงกับการค้นหา</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">คลิกแถวเพื่อดูรายละเอียดเต็ม</p>
        </div>

      </main>

      {selectedTicket && (
        <TicketDetailModal ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
      )}
    </div>
  )
}
