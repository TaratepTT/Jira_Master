'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import ThemeToggle from '@/components/theme/ThemeToggle'
import ExpandableKeys from '@/components/dashboard/ExpandableKeys'


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

type SortKey = 'key' | 'summary' | 'businessUnit' | 'status' | 'rootCause' | 'resolution' | 'typeOfIssue'| 'deployDate'
type SortDir = 'asc' | 'desc'

// ── Helpers ───────────────────────────────────────────────────
function pct(n: number, total: number) { return total ? Math.round(n / total * 100) : 0 }
const STATUS_COLOR: Record<string, string> = {
  closed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  'l3-investigate': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  default: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
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
function isClosedStatus(s: string) {
  return s.toLowerCase().includes('closed') || s.toLowerCase().includes('done')
}
function isL3Status(s: string) {
  return s.toLowerCase().includes('l3') || s.toLowerCase().includes('investigate')
}

// ── Sub-components ────────────────────────────────────────────
function ProgressBar({ label, count, total, color = 'bg-blue-500' }: { label: string; count: number; total: number; color?: string }) {
  const p = pct(count, total)
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400 mb-1">
        <span>{label}</span><span className="font-medium">{count} · {p}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

// ── Multi-select dropdown ──────────────────────────────────────
interface MultiSelectProps {
  label: string
  options: { value: string; count: number }[]
  selected: string[]
  onChange: (vals: string[]) => void
}
function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val))
    else onChange([...selected, val])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          selected.length
            ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
            {selected.length}
          </span>
        )}
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          )}
          <div className="max-h-64 overflow-y-auto">
            {options.map(opt => (
              <label
                key={opt.value}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                  />
                  <span className="text-xs text-slate-700 dark:text-slate-200 truncate">{opt.value}</span>
                </span>
                <span className="text-xs text-slate-400 flex-shrink-0">{opt.count}</span>
              </label>
            ))}
            {!options.length && (
              <p className="px-2 py-3 text-xs text-slate-400 text-center">ไม่มีตัวเลือก</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sortable column header ─────────────────────────────────────
function SortableHeader({
  label, sortKey, activeKey, dir, onSort,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey | null
  dir: SortDir
  onSort: (key: SortKey) => void
}) {
  const isActive = activeKey === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="flex flex-col -space-y-1">
          <svg
            className={`h-2.5 w-2.5 ${isActive && dir === 'asc' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600'}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path d="M10 5l5 6H5l5-6z" />
          </svg>
          <svg
            className={`h-2.5 w-2.5 ${isActive && dir === 'desc' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600'}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path d="M10 15l-5-6h10l-5 6z" />
          </svg>
        </span>
      </span>
    </th>
  )
}

// ── Filtered Insights panel ────────────────────────────────────
function FilteredInsights({ tickets }: { tickets: TicketDetail[] }) {
  const total = tickets.length
  if (!total) return null

  const closedN    = tickets.filter(t => isClosedStatus(t.status)).length
  const l3N        = tickets.filter(t => isL3Status(t.status)).length
  const deployedN  = tickets.filter(t => !!t.deployDate).length

  const statusCounts: Record<string, number> = {}
  const buCounts: Record<string, number> = {}
  tickets.forEach(t => {
    const s = t.status || 'ไม่ระบุ'
    const b = t.businessUnit || 'ไม่ระบุ'
    statusCounts[s] = (statusCounts[s] ?? 0) + 1
    buCounts[b] = (buCounts[b] ?? 0) + 1
  })
  const statusEntries = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])
  const buEntries = Object.entries(buCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)

  return (
    <div className="mb-5 rounded-2xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-5">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M18.7 8l-5.1 5.1-2.8-2.8L7 14" />
        </svg>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">ภาพรวมของข้อมูลที่กรองอยู่</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
          <p className="text-xl font-semibold text-slate-800 dark:text-slate-100">{total}</p>
          <p className="text-xs text-slate-400 mt-0.5">Tickets ที่กรองได้</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
          <p className="text-xl font-semibold text-green-600 dark:text-green-400">{pct(closedN, total)}%</p>
          <p className="text-xs text-slate-400 mt-0.5">Closure rate ({closedN})</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
          <p className={`text-xl font-semibold ${l3N ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-slate-100'}`}>{l3N}</p>
          <p className="text-xs text-slate-400 mt-0.5">L3 escalation</p>
        </div>
        <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
          <p className="text-xl font-semibold text-indigo-600 dark:text-indigo-400">{pct(deployedN, total)}%</p>
          <p className="text-xs text-slate-400 mt-0.5">Deployed ({deployedN}/{total})</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-3">Status ในกลุ่มที่กรอง</p>
          {statusEntries.map(([s, c]) => (
            <div key={s} className="mb-2.5 last:mb-0">
              <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 mb-1">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${statusBadge(s)}`}>{s}</span>
                <span className="font-medium">{c} · {pct(c, total)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full bg-slate-400" style={{ width: `${pct(c, total)}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-3">Business Unit ในกลุ่มที่กรอง</p>
          {buEntries.map(([b, c]) => (
            <div key={b} className="mb-2.5 last:mb-0">
              <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 mb-1">
                <span className="truncate max-w-[160px]">{b}</span>
                <span className="font-medium flex-shrink-0">{c} · {pct(c, total)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full bg-purple-400" style={{ width: `${pct(c, total)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 mb-1.5">
          <span className="font-medium">Deploy Progress</span>
          <span>{deployedN} deployed · {total - deployedN} pending</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex">
          <div className="h-full bg-indigo-500" style={{ width: `${pct(deployedN, total)}%` }} />
        </div>
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
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-slate-400">Ticket</p>
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">{ticket.key}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 text-sm">
          {ticket.summary && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Summary</p>
              <p className="text-slate-700 dark:text-slate-200">{ticket.summary}</p>
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
              <p className="text-slate-700 dark:text-slate-200">{ticket.system}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Business Unit</p>
              <p className="text-slate-700 dark:text-slate-200">{ticket.businessUnit || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Type of Issue</p>
              <p className="text-slate-700 dark:text-slate-200">{ticket.typeOfIssue || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Deploy Date</p>
              <p className="text-slate-700 dark:text-slate-200">
                {ticket.deployDate
                  ? <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium">
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {formatDate(ticket.deployDate)}
                    </span>
                  : <span className="text-slate-300 dark:text-slate-600">ยังไม่ deploy</span>}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 p-4">
            <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1.5 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Root Cause
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
              {ticket.rootCause || <span className="text-slate-400 italic">ไม่มีข้อมูล</span>}
            </p>
          </div>

          <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-900/50 p-4">
            <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1.5 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Resolution
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
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

  const [buFilter, setBuFilter]         = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [systemFilter, setSystemFilter] = useState<string[]>([])

  // ── Sort state ────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    if (!id) return
    api.get(`/api/reports/${id}`)
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.message ?? 'โหลด report ไม่สำเร็จ'))
  }, [id])

  const buOptions = useMemo(() => {
    if (!data) return []
    const counts: Record<string, number> = {}
    data.tickets.forEach(t => {
      const bu = t.businessUnit || 'ไม่ระบุ'
      counts[bu] = (counts[bu] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
  }, [data])

  const statusOptions = useMemo(() => {
    if (!data) return []
    const counts: Record<string, number> = {}
    data.tickets.forEach(t => {
      const s = t.status || 'ไม่ระบุ'
      counts[s] = (counts[s] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
  }, [data])

  const systemOptions = useMemo(() => {
    if (!data) return []
    const counts: Record<string, number> = {}
    data.tickets.forEach(t => {
      const s = t.system || 'ไม่ระบุ'
      counts[s] = (counts[s] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
  }, [data])

  const filteredTickets = useMemo(() => {
    if (!data) return []
    const result = data.tickets.filter(t => {
      const matchSearch =
        !search ||
        t.key.toLowerCase().includes(search.toLowerCase()) ||
        (t.summary ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.rootCause ?? '').toLowerCase().includes(search.toLowerCase())

      const matchBu     = !buFilter.length     || buFilter.includes(t.businessUnit || 'ไม่ระบุ')
      const matchStatus = !statusFilter.length || statusFilter.includes(t.status || 'ไม่ระบุ')
      const matchSystem = !systemFilter.length || systemFilter.includes(t.system || 'ไม่ระบุ')

      return matchSearch && matchBu && matchStatus && matchSystem
    })

    if (!sortKey) return result

    const sorted = [...result].sort((a, b) => {
      let valA: string = ''
      let valB: string = ''

      if (sortKey === 'deployDate') {
        // Sort by actual date value; empty dates go last regardless of direction
        const dA = a.deployDate ? new Date(a.deployDate).getTime() : null
        const dB = b.deployDate ? new Date(b.deployDate).getTime() : null
        if (dA === null && dB === null) return 0
        if (dA === null) return 1
        if (dB === null) return -1
        return sortDir === 'asc' ? dA - dB : dB - dA
      }

      valA = (a[sortKey] ?? '').toString().toLowerCase()
      valB = (b[sortKey] ?? '').toString().toLowerCase()

      if (!valA && valB) return 1
      if (valA && !valB) return -1

      const cmp = valA.localeCompare(valB, 'th')
      return sortDir === 'asc' ? cmp : -cmp
    })

    return sorted
  }, [data, search, buFilter, statusFilter, systemFilter, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const activeFilterCount = buFilter.length + statusFilter.length + systemFilter.length
  const hasActiveFilterOrSearch = activeFilterCount > 0 || search.trim().length > 0

  const clearAllFilters = () => {
    setBuFilter([])
    setStatusFilter([])
    setSystemFilter([])
    setSearch('')
  }

  if (error) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-red-500 font-medium">{error}</p>
        <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">กลับหน้าหลัก</Link>
      </div>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="space-y-3 w-full max-w-2xl px-6">
        {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />)}
      </div>
    </div>
  )

  const { aggregations: ag, totalTickets, name, createdAt } = data
  const closedN = ag.statusCount['Closed'] ?? 0
  const l3N = ag.l3Tickets.length
  const systemEntries = Object.entries(ag.systemCount).sort((a,b) => b[1]-a[1])
  const statusEntries = Object.entries(ag.statusCount).sort((a,b) => b[1]-a[1])
  const buEntries = Object.entries(ag.buCount).sort((a,b) => b[1]-a[1])
  const catEntries = Object.entries(ag.issueTypeCount).sort((a,b) => b[1]-a[1])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 transition-colors">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
            </Link>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</p>
              <p className="text-xs text-slate-400">{totalTickets} tickets · {new Date(createdAt).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a href={`${process.env.NEXT_PUBLIC_API_URL}/api/export/${id}`}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
              Export CSV
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">

        {/* Executive Summary */}
        <section className="rounded-2xl bg-gradient-to-br from-blue-700 to-blue-500 dark:from-blue-800 dark:to-blue-600 p-6 text-white">
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
          <div className="rounded-xl border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/20 px-5 py-4">
            <p className="text-sm font-semibold text-orange-800 dark:text-orange-400 mb-2">⚠ L3-INVESTIGATE — ต้องติดตาม</p>
            {ag.l3Tickets.map(t => (
              <p key={t.key} className="text-sm text-orange-700 dark:text-orange-300">{t.key}: {t.summary ?? t.bu}</p>
            ))}
          </div>
        )}

        {/* Row 1: System + Status */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Issue Type — ระบบ</h2>
            {systemEntries.map(([s, c]) => <ProgressBar key={s} label={s} count={c} total={totalTickets} color="bg-blue-500" />)}
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Status Type</h2>
            {statusEntries.map(([s, c]) => (
              <div key={s} className="mb-3">
                <div className="flex justify-between items-center text-xs text-slate-600 dark:text-slate-400 mb-1">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(s)}`}>{s}</span>
                  <span className="font-medium">{c} · {pct(c, totalTickets)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full rounded-full bg-slate-400 transition-all" style={{ width: `${pct(c, totalTickets)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Row 2: BU + Category */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Business Unit</h2>
            <p className="text-xs text-slate-400 mb-4">Top 5 BU</p>
            <ol className="mb-4 space-y-1">
              {ag.top5Bu.map((b, i) => <li key={b.name} className="text-sm text-slate-600 dark:text-slate-300">{i+1}. {b.name} <span className="text-slate-400">({b.count})</span></li>)}
            </ol>
            {buEntries.map(([b, c]) => <ProgressBar key={b} label={b} count={c} total={totalTickets} color="bg-purple-400" />)}
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Ticket Type Category</h2>
            <p className="text-xs text-slate-400 mb-4">Top 3 category: {ag.top3Cat.map(c => c.category).join(', ')}</p>
            {catEntries.map(([c, n]) => <ProgressBar key={c} label={c} count={n} total={totalTickets} color="bg-teal-500" />)}
          </div>
        </div>

        {/* Frequency Table */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Ticket Frequency by Category</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">ลำดับ</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Category</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">จำนวน</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">%</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Ticket Keys</th>
                </tr>
              </thead>
              <tbody>
                {ag.frequencyTable.map(row => (
                  <tr key={row.rank} className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{row.rank}</td>
                    <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-200">{row.category}</td>
                    <td className="py-2 px-3 text-right dark:text-slate-300">{row.count}</td>
                    <td className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">{row.pct}</td>
                    <td className="py-2 px-3"><ExpandableKeys keys={row.keys} /></td>
                  </tr>
                  
                ))}
                <tr className="bg-slate-50 dark:bg-slate-700/50 font-semibold">
                  <td className="py-2 px-3 dark:text-slate-200">-</td>
                  <td className="py-2 px-3 dark:text-slate-200">Grand Total</td>
                  <td className="py-2 px-3 text-right dark:text-slate-200">{totalTickets}</td>
                  <td className="py-2 px-3 text-right dark:text-slate-200">100.00%</td>
                  <td className="py-2 px-3 dark:text-slate-200">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Issue Detail — Root Cause & Resolution & Deploy — with filters & sort */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Issue Detail — Root Cause, Resolution & Deploy</h2>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา Key, Summary, Root Cause..."
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 transition-colors w-64"
            />
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap mb-4 pb-4 border-b border-slate-100 dark:border-slate-700">
            <span className="text-xs font-medium text-slate-400 mr-1">ตัวกรอง:</span>
            <MultiSelectFilter label="Business Unit" options={buOptions} selected={buFilter} onChange={setBuFilter} />
            <MultiSelectFilter label="Status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} />
            <MultiSelectFilter label="System" options={systemOptions} selected={systemFilter} onChange={setSystemFilter} />
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                ล้างตัวกรอง ({activeFilterCount})
              </button>
            )}
            <span className="ml-auto text-xs text-slate-400">
              แสดง {filteredTickets.length} จาก {totalTickets} tickets
            </span>
          </div>

          {/* Active filter chips */}
          {(buFilter.length > 0 || statusFilter.length > 0 || systemFilter.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {buFilter.map(v => (
                <span key={`bu-${v}`} className="flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
                  BU: {v}
                  <button onClick={() => setBuFilter(buFilter.filter(x => x !== v))} className="hover:text-blue-900 dark:hover:text-blue-100">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
              {statusFilter.map(v => (
                <span key={`st-${v}`} className="flex items-center gap-1 rounded-full bg-orange-50 dark:bg-orange-900/30 px-2.5 py-1 text-xs font-medium text-orange-700 dark:text-orange-300">
                  Status: {v}
                  <button onClick={() => setStatusFilter(statusFilter.filter(x => x !== v))} className="hover:text-orange-900 dark:hover:text-orange-100">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
              {systemFilter.map(v => (
                <span key={`sys-${v}`} className="flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-900/30 px-2.5 py-1 text-xs font-medium text-teal-700 dark:text-teal-300">
                  System: {v}
                  <button onClick={() => setSystemFilter(systemFilter.filter(x => x !== v))} className="hover:text-teal-900 dark:hover:text-teal-100">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {hasActiveFilterOrSearch && <FilteredInsights tickets={filteredTickets} />}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <SortableHeader label="Key"        sortKey="key"          activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Summary"    sortKey="summary"      activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableHeader label="BU"         sortKey="businessUnit" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Status"     sortKey="status"       activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Root Cause" sortKey="rootCause"    activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Resolution" sortKey="resolution"   activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Category"   sortKey="typeOfIssue"  activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableHeader label="Deploy"     sortKey="deployDate"   activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => (
                  <tr
                    key={t.key}
                    onClick={() => setSelectedTicket(t)}
                    className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-blue-50 dark:hover:bg-blue-950/20 cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-3 font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{t.key}</td>
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-200 max-w-[160px] truncate">{t.summary || '—'}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 max-w-[120px] truncate">{t.businessUnit || '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadge(t.status)}`}>{t.status}</span>
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 max-w-[140px] truncate">{t.typeOfIssue || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 max-w-[180px] truncate">{t.rootCause || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 max-w-[180px] truncate">{t.resolution || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {t.deployDate ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          {formatDate(t.deployDate)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredTickets.length && (
                  <tr><td colSpan={8} className="py-8 text-center text-slate-400 text-sm">
                    ไม่พบข้อมูลที่ตรงกับตัวกรอง
                    {activeFilterCount > 0 && (
                      <button onClick={clearAllFilters} className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">ล้างตัวกรอง</button>
                    )}
                  </td></tr>
                )}
                {!filteredTickets.length && (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-sm">
                    ไม่พบข้อมูลที่ตรงกับตัวกรอง
                    {activeFilterCount > 0 && (
                      <button onClick={clearAllFilters} className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">ล้างตัวกรอง</button>
                    )}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">คลิกแถวเพื่อดูรายละเอียดเต็ม · คลิกหัวตารางเพื่อเรียงลำดับ</p>
        </div>

      </main>

      {selectedTicket && (
        <TicketDetailModal ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
      )}
    </div>
  )
}
