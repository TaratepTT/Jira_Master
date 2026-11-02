'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api, { refreshReportFromJira, type BulkUpdateResponse } from '@/lib/api'
import { useUrlFilters } from '@/lib/useUrlFilters'
import ThemeToggle from '@/components/theme/ThemeToggle'
import ExpandableKeys from '@/components/dashboard/ExpandableKeys'
import LogoutButton from '@/components/auth/LogoutButton'
import { useAuth } from '@/components/auth/AuthContext'
import RootCauseInsights from '@/components/dashboard/RootCauseInsights'
import BulkEditModal from '@/components/dashboard/BulkEditModal'
import TrendChart from '@/components/dashboard/TrendChart'
import AgingPanel from '@/components/dashboard/AgingPanel'
import FlowPanel from '@/components/dashboard/FlowPanel'
import ProgressBar from '@/components/dashboard/ProgressBar'
import MultiSelectFilter from '@/components/dashboard/MultiSelectFilter'
import SortableHeader from '@/components/dashboard/SortableHeader'
import FilteredInsights from '@/components/dashboard/FilteredInsights'
import TicketDetailModal, { type TicketNav } from '@/components/dashboard/TicketDetailModal'
import type { ReportData, SortDir, SortKey, TicketDetail } from '@/components/dashboard/types'
import {
  TYPE_OF_ISSUE_OPTIONS, formatDate, isIncomplete, jiraBrowseUrl, pct, statusBadge,
} from '@/components/dashboard/utils'

// The dashboard of one report. Sub-components live in components/dashboard/*:
//   TicketDetailModal (edit + sync to Jira) · TicketActivityPanel (comments/history/files)
//   AgingPanel · FlowPanel (created vs resolved) · FilteredInsights · filters & table headers

const SORT_KEYS: SortKey[] = ['key', 'summary', 'businessUnit', 'status', 'typeOfIssue', 'rootCause', 'resolution', 'deployDate']

// Sort the Issue Detail table. Empty values always go last; Deploy Date sorts by real date.
function sortTickets(list: TicketDetail[], sortKey: SortKey | null, sortDir: SortDir): TicketDetail[] {
  if (!sortKey) return list

  const sorted = [...list].sort((a, b) => {
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
}

// ── Main dashboard ─────────────────────────────────────────────
// ── Main dashboard ─────────────────────────────────────────────
export default function DashboardPage() {
  const { id } = useParams<{ id: string }>()
  const { canEdit } = useAuth()
  const [bulkOpen, setBulkOpen] = useState(false)
  const [data, setData] = useState<ReportData | null>(null)
  const [error, setError] = useState('')
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set())
  const [exportingCsv, setExportingCsv] = useState(false)

  // Filters, sort and the open ticket live in the address bar (shareable links) — lib/useUrlFilters.ts
  const [filters, setFilters] = useUrlFilters()
  const search = filters.q
  const buFilter = filters.bu
  const statusFilter = filters.status
  const systemFilter = filters.system
  const categoryFilter = filters.category
  const incompleteOnly = filters.incomplete
  const sortKey = (SORT_KEYS.includes(filters.sort as SortKey) ? filters.sort : null) as SortKey | null
  const sortDir: SortDir = filters.dir
  const setSearch = (q: string) => setFilters({ q })
  const setBuFilter = (bu: string[]) => setFilters({ bu })
  const setStatusFilter = (status: string[]) => setFilters({ status })
  const setSystemFilter = (system: string[]) => setFilters({ system })
  const setCategoryFilter = (category: string[]) => setFilters({ category })

  // Ticket modal. `fillMode` = the "ไล่กรอกข้อมูลที่ยังไม่ครบ" queue: each ticket opens in edit mode.
  const [fillMode, setFillMode] = useState(false)
  const selectedTicket = useMemo(
    () => (filters.ticket && data ? data.tickets.find(t => t.key === filters.ticket) ?? null : null),
    [filters.ticket, data],
  )
  const openTicket = (key: string | null) => setFilters({ ticket: key })

  // ── Refresh from Jira ─────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null)

  // ── Resizable columns for the Issue Detail table ────────────
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    key: 110, summary: 220, businessUnit: 130, status: 120,
    typeOfIssue: 130, rootCause: 220, resolution: 220, deployDate: 110,
  })
  const resizingRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null)

  const onResizeMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current
    if (!r) return
    const delta = e.clientX - r.startX
    setColWidths(prev => ({ ...prev, [r.col]: Math.max(70, r.startWidth + delta) }))
  }, [])

  const onResizeEnd = useCallback(() => {
    resizingRef.current = null
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  }, [onResizeMove])

  const startResize = useCallback((col: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizingRef.current = { col, startX: e.clientX, startWidth: colWidths[col] }
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
  }, [colWidths, onResizeMove, onResizeEnd])


  useEffect(() => {
    if (!id) return
    api.get(`/api/reports/${id}`)
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.message ?? 'โหลด report ไม่สำเร็จ'))
  }, [id])

  const handleRefresh = useCallback(async () => {
    if (!id || refreshing) return
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const r = await refreshReportFromJira(id)
      const details: string[] = []
      if (r.statusChanged) details.push(...r.statusChanges.slice(0, 8).map(c => `${c.key}: ${c.from} → ${c.to}`))
      if (r.statusChanged > 8) details.push(`… และอีก ${r.statusChanged - 8} ticket`)
      if (r.filledFields) details.push(`เติมช่องที่ว่างจากข้อมูลใน Jira ${r.filledFields} ช่อง`)
      if (r.missing.length) details.push(`ไม่พบใน Jira (ถูกลบ/ย้าย): ${r.missing.slice(0, 10).join(', ')}${r.missing.length > 10 ? ' …' : ''}`)
      setRefreshMsg({ ok: true, text: `${r.message} (ตรวจ ${r.checked} · เปลี่ยนสถานะ ${r.statusChanged})`, details })
      const fresh = await api.get(`/api/reports/${id}`)
      setData(fresh.data)
    } catch (e: unknown) {
      setRefreshMsg({ ok: false, text: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'รีเฟรชจาก Jira ไม่สำเร็จ' })
    } finally {
      setRefreshing(false)
    }
  }, [id, refreshing])

  // After a bulk edit: reload the whole report so the charts/counters (BU, categories...)
  // match the new values. A failed reload is silent — the table was already patched locally.
  const handleBulkDone = useCallback((res: BulkUpdateResponse) => {
    const byKey = new Map(res.results.filter(r => r.status === 'updated' && r.ticket).map(r => [r.key, r.ticket!]))
    if (byKey.size > 0) {
      setData(prev => prev ? {
        ...prev,
        tickets: prev.tickets.map(t => {
          const u = byKey.get(t.key)
          return u ? { ...t, businessUnit: u.businessUnit, typeOfIssue: u.typeOfIssue, deployDate: u.deployDate ?? '' } : t
        }),
      } : prev)
      api.get(`/api/reports/${id}`).then(r => setData(r.data)).catch(() => { /* keep local patch */ })
    }
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

  const categoryOptions = useMemo(() => {
    if (!data) return []
    const counts: Record<string, number> = {}
    data.tickets.forEach(t => {
      const c = t.typeOfIssue || 'ไม่ระบุ'
      counts[c] = (counts[c] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
  }, [data])

  const incompleteCount = useMemo(() => (data ? data.tickets.filter(isIncomplete).length : 0), [data])

  const filteredTickets = useMemo(() => {
    if (!data) return []
    const result = data.tickets.filter(t => {
      if (incompleteOnly && !isIncomplete(t)) return false
      const matchSearch =
        !search ||
        t.key.toLowerCase().includes(search.toLowerCase()) ||
        (t.summary ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.rootCause ?? '').toLowerCase().includes(search.toLowerCase())

      const matchBu     = !buFilter.length     || buFilter.includes(t.businessUnit || 'ไม่ระบุ')
      const matchStatus = !statusFilter.length || statusFilter.includes(t.status || 'ไม่ระบุ')
      const matchSystem = !systemFilter.length || systemFilter.includes(t.system || 'ไม่ระบุ')
      const matchCategory = !categoryFilter.length || categoryFilter.includes(t.typeOfIssue || 'ไม่ระบุ')

      return matchSearch && matchBu && matchStatus && matchSystem && matchCategory
    })

    return sortTickets(result, sortKey, sortDir)
  }, [data, search, buFilter, statusFilter, systemFilter, categoryFilter, incompleteOnly, sortKey, sortDir])

  // Prev/next in the modal follows the table as it is filtered/sorted right now.
  // In the fill-in queue the list is FROZEN when the queue starts, so a ticket that becomes
  // complete after saving stays in the list and the counter (3 / 12) keeps making sense.
  const [queueKeys, setQueueKeys] = useState<string[] | null>(null)
  const navKeys = useMemo(() => queueKeys ?? filteredTickets.map(t => t.key), [queueKeys, filteredTickets])
  const navIndex = selectedTicket ? navKeys.indexOf(selectedTicket.key) : -1
  const ticketNav: TicketNav | undefined = navIndex >= 0 ? {
    index: navIndex,
    total: navKeys.length,
    label: queueKeys ? 'ไล่กรอกข้อมูลที่ยังไม่ครบ' : incompleteOnly ? 'ข้อมูลยังไม่ครบ' : undefined,
    onPrev: navIndex > 0 ? () => openTicket(navKeys[navIndex - 1]) : undefined,
    onNext: navIndex < navKeys.length - 1 ? () => openTicket(navKeys[navIndex + 1]) : undefined,
  } : undefined

  const startFillQueue = () => {
    if (!data) return
    const queue = sortTickets(data.tickets.filter(isIncomplete), sortKey, sortDir).map(t => t.key)
    if (!queue.length) return
    setFilters({ incomplete: true, q: '', bu: [], status: [], system: [], category: [], ticket: queue[0] })
    setQueueKeys(queue)
    setFillMode(canEdit)
  }
  // Closing the modal ends the queue
  useEffect(() => {
    if (!filters.ticket) { setQueueKeys(null); setFillMode(false) }
  }, [filters.ticket])

  const toggleHighlight = (key: string) => {
    setHighlighted(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allShownSelected = filteredTickets.length > 0 && filteredTickets.every(t => highlighted.has(t.key))
  const toggleAllShown = () => {
    setHighlighted(prev => {
      const next = new Set(prev)
      if (allShownSelected) filteredTickets.forEach(t => next.delete(t.key))
      else filteredTickets.forEach(t => next.add(t.key))
      return next
    })
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setFilters({ dir: sortDir === 'asc' ? 'desc' : 'asc' })
    else setFilters({ sort: key, dir: 'asc' })
  }

  const activeFilterCount = buFilter.length + statusFilter.length + systemFilter.length + categoryFilter.length + (incompleteOnly ? 1 : 0)
  const hasActiveFilterOrSearch = activeFilterCount > 0 || search.trim().length > 0

  const clearAllFilters = () => {
    setFilters({ bu: [], status: [], system: [], category: [], q: '', incomplete: false })
  }

  const [copied, setCopied] = useState(false)
  const copyViewLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — the address bar has the same link */ }
  }

  const handleExportCsv = async () => {
    setExportingCsv(true)
    try {
      const response = await api.get(`/api/export/${id}`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `${data?.name || 'report'}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      alert('Export CSV ไม่สำเร็จ — กรุณา login ใหม่หรือลองอีกครั้ง')
    } finally {
      setExportingCsv(false)
    }
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
  const asOf = new Date(data.refreshedAt ?? createdAt)
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
        <div className="mx-auto max-w-6xl px-4 sm:px-6 min-h-14 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
            </Link>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</p>
              <p className="text-xs text-slate-400">
                {totalTickets} tickets · {new Date(createdAt).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric' })}
                {data.refreshedAt && <> · รีเฟรชจาก Jira {new Date(data.refreshedAt).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ThemeToggle />
            <LogoutButton />
            {canEdit && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title="ดึงสถานะ / ผู้รับผิดชอบ / วันที่ resolve ล่าสุดจาก Jira มาใส่ report นี้"
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                <svg className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                {refreshing ? 'กำลังรีเฟรช...' : 'รีเฟรชจาก Jira'}
              </button>
            )}
            <Link
              href={`/dashboard/${id}/summary`}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
              </svg>
              สรุปสำหรับประชุม
            </Link>
            <Link
              href={`/compare?current=${id}`}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              เทียบกับ report ก่อนหน้า
            </Link>
            <button
              onClick={handleExportCsv}
              disabled={exportingCsv}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {exportingCsv ? (
                <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
              )}
              {exportingCsv ? 'กำลัง Export...' : 'Export CSV'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">

        {refreshMsg && (
          <div className={`rounded-xl border px-4 py-3 ${refreshMsg.ok
            ? 'border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/20'
            : 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-sm font-medium ${refreshMsg.ok ? 'text-green-800 dark:text-green-300' : 'text-red-700 dark:text-red-400'}`}>{refreshMsg.text}</p>
                {refreshMsg.details?.map((d, i) => <p key={i} className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{d}</p>)}
              </div>
              <button onClick={() => setRefreshMsg(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="ปิด">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}

        {incompleteCount > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              <strong>{incompleteCount} tickets</strong> ยังกรอกข้อมูลไม่ครบ (BU / Type of Issue / Root Cause / Resolution)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilters({ incomplete: !incompleteOnly })}
                className="rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
              >
                {incompleteOnly ? 'แสดงทั้งหมด' : 'ดูเฉพาะที่ไม่ครบ'}
              </button>
              <button
                onClick={startFillQueue}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
              >
                {canEdit ? 'เริ่มไล่กรอกทีละใบ →' : 'ไล่ดูทีละใบ →'}
              </button>
            </div>
          </div>
        )}

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
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">รวมทั้งหมด: {totalTickets} tickets</p>
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
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">รวมทั้งหมด: {totalTickets} tickets</p>
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
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">รวมทั้งหมด: {totalTickets} tickets</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Ticket Type Category</h2>
            <p className="text-xs text-slate-400 mb-4">Top 3 category: {ag.top3Cat.map(c => c.category).join(', ')}</p>
            {catEntries.map(([c, n]) => <ProgressBar key={c} label={c} count={n} total={totalTickets} color="bg-teal-500" />)}
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">รวมทั้งหมด: {totalTickets} tickets</p>
          </div>
        </div>

        {/* Row 3: Assignee + Priority */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Assignee Breakdown</h2>
            <p className="text-xs text-slate-400 mb-4">ใครรับผิดชอบ ticket มากที่สุด</p>
            {ag.topAssignees.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">ไม่มีข้อมูล assignee</p>
            ) : (
              ag.topAssignees.map(a => (
                <ProgressBar key={a.name} label={a.name} count={a.count} total={totalTickets} color="bg-indigo-400" />
              ))
            )}
          </div>
          <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Priority Breakdown</h2>
            {Object.keys(ag.priorityCount).length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">ไม่มีข้อมูล priority</p>
            ) : (
              Object.entries(ag.priorityCount).sort((a, b) => b[1] - a[1]).map(([p, c]) => (
                <ProgressBar key={p} label={p} count={c} total={totalTickets} color="bg-rose-400" />
              ))
            )}
          </div>
        </div>

        {/* Trend Chart */}
        <TrendChart tickets={data.tickets} />

        {/* Aging + Created vs Resolved */}
        <AgingPanel tickets={data.tickets} asOf={asOf} onOpenTicket={key => openTicket(key)} />
        <FlowPanel tickets={data.tickets} canRefresh={canEdit} onRefresh={handleRefresh} refreshing={refreshing} />

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
                    <td className="py-2 px-3">
                      <ExpandableKeys keys={row.keys} />
                    </td>
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

        {/* AI Root Cause summary */}
        <RootCauseInsights reportId={id} />

        {/* Highlighted Issues */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              รายการที่เลือกไว้ {highlighted.size > 0 && <span className="text-blue-600 dark:text-blue-400">({highlighted.size})</span>}
            </h2>
            {highlighted.size > 0 && (
              <div className="flex items-center gap-3">
                {canEdit && (
                  <button
                    onClick={() => setBulkOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                    </svg>
                    แก้ไขพร้อมกัน ({highlighted.size})
                  </button>
                )}
                <button onClick={() => setHighlighted(new Set())} className="text-xs font-medium text-red-500 hover:underline">
                  ล้างทั้งหมด
                </button>
              </div>
            )}
          </div>

          {highlighted.size === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">
              ยังไม่ได้เลือกรายการ — ติ๊กเลือกจากตาราง Issue Detail ด้านล่าง (เช่น Non-app issue, Human Error) เพื่อนำมาไฮไลท์ตรงนี้
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Key</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Summary</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Status</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Category</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.tickets.filter(t => highlighted.has(t.key)).map(t => (
                    <tr
                      key={t.key}
                      onClick={() => openTicket(t.key)}
                      className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-blue-50 dark:hover:bg-blue-950/20 cursor-pointer"
                    >
                      <td className="py-2 px-3 font-medium whitespace-nowrap">
                        <a
                          href={jiraBrowseUrl(t.key)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                        >
                          {t.key}
                          <svg className="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      </td>
                      <td className="py-2 px-3 text-slate-700 dark:text-slate-200 whitespace-normal break-words min-w-[200px] max-w-[400px]">{t.summary || '—'}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadge(t.status)}`}>{t.status}</span>
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{t.typeOfIssue || '—'}</td>
                      <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleHighlight(t.key)} className="text-slate-400 hover:text-red-500 transition-colors">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
            <MultiSelectFilter label="Category" options={categoryOptions} selected={categoryFilter} onChange={setCategoryFilter} />
            <button
              onClick={() => setFilters({ incomplete: !incompleteOnly })}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                incompleteOnly
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              ข้อมูลยังไม่ครบ ({incompleteCount})
            </button>
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
            <span className="ml-auto flex items-center gap-3 text-xs text-slate-400">
              แสดง {filteredTickets.length} จาก {totalTickets} tickets
              <button
                onClick={copyViewLink}
                title="คัดลอกลิงก์ที่มีตัวกรองนี้ ส่งให้ทีมเปิดแล้วเห็นแบบเดียวกัน"
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอกลิงก์มุมมองนี้'}
              </button>
            </span>
          </div>

          {/* Active filter chips */}
          {(buFilter.length > 0 || statusFilter.length > 0 || systemFilter.length > 0 || categoryFilter.length > 0) && (
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
              {categoryFilter.map(v => (
                <span key={`cat-${v}`} className="flex items-center gap-1 rounded-full bg-purple-50 dark:bg-purple-900/30 px-2.5 py-1 text-xs font-medium text-purple-700 dark:text-purple-300">
                  Category: {v}
                  <button onClick={() => setCategoryFilter(categoryFilter.filter(x => x !== v))} className="hover:text-purple-900 dark:hover:text-purple-100">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {hasActiveFilterOrSearch && <FilteredInsights tickets={filteredTickets} />}

          <div className="overflow-x-auto -mx-5 px-5">
            <table className="text-sm" style={{ tableLayout: 'fixed', width: Object.values(colWidths).reduce((a, b) => a + b, 0) + 60 }}>
              <colgroup>
                <col style={{ width: colWidths.key }} />
                <col style={{ width: colWidths.summary }} />
                <col style={{ width: colWidths.businessUnit }} />
                <col style={{ width: colWidths.status }} />
                <col style={{ width: colWidths.typeOfIssue }} />
                <col style={{ width: colWidths.rootCause }} />
                <col style={{ width: colWidths.resolution }} />
                <col style={{ width: colWidths.deployDate }} />
                <col style={{ width: 50 }} />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <SortableHeader label="Key"        sortKey="key"          activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('key')} />
                  <SortableHeader label="Summary"    sortKey="summary"      activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('summary')} />
                  <SortableHeader label="BU"         sortKey="businessUnit" activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('businessUnit')} />
                  <SortableHeader label="Status"     sortKey="status"       activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('status')} />
                  <SortableHeader label="Category"   sortKey="typeOfIssue"  activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('typeOfIssue')} />
                  <SortableHeader label="Root Cause" sortKey="rootCause"    activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('rootCause')} />
                  <SortableHeader label="Resolution" sortKey="resolution"   activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('resolution')} />
                  <SortableHeader label="Deploy"     sortKey="deployDate"   activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('deployDate')} />
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <label className="inline-flex flex-col items-center gap-1 cursor-pointer" title="เลือก/ยกเลิกทุกรายการที่แสดงอยู่ (ตามตัวกรองปัจจุบัน)">
                      <span>เลือก</span>
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        onChange={toggleAllShown}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </label>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => (
                  <tr
                    key={t.key}
                    onClick={() => openTicket(t.key)}
                    className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-blue-50 dark:hover:bg-blue-950/20 cursor-pointer transition-colors align-top"
                  >
                    <td className="py-2 px-3 font-medium whitespace-nowrap overflow-hidden">
                      <a
                        href={jiraBrowseUrl(t.key)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        {t.key}
                        <svg className="h-3 w-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                      </a>
                    </td>
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-200 whitespace-normal break-words overflow-hidden">{t.summary || '—'}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-normal break-words overflow-hidden">{t.businessUnit || '—'}</td>
                    <td className="py-2 px-3 overflow-hidden">
                      <span className={`inline-block max-w-full truncate align-middle px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(t.status)}`}>{t.status}</span>
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-normal break-words overflow-hidden">{t.typeOfIssue || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-normal break-words overflow-hidden">{t.rootCause || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-normal break-words overflow-hidden">{t.resolution || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className="py-2 px-3 whitespace-nowrap overflow-hidden">
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
                    <td className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={highlighted.has(t.key)}
                        onChange={() => toggleHighlight(t.key)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                  </tr>
                ))}
                {!filteredTickets.length && (
                  <tr><td colSpan={9} className="py-8 text-center text-slate-400 text-sm">
                    ไม่พบข้อมูลที่ตรงกับตัวกรอง
                    {activeFilterCount > 0 && (
                      <button onClick={clearAllFilters} className="ml-2 text-blue-600 dark:text-blue-400 hover:underline">ล้างตัวกรอง</button>
                    )}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">คลิกแถวเพื่อดูรายละเอียดเต็ม · คลิกหัวตารางเพื่อเรียงลำดับ · ในหน้าต่าง ticket กด ← / → เพื่อเลื่อนใบ</p>
        </div>

      </main>

      {bulkOpen && data && (
        <BulkEditModal
          reportId={id as string}
          tickets={data.tickets.filter(t => highlighted.has(t.key))}
          typeOptions={TYPE_OF_ISSUE_OPTIONS}
          onClose={() => setBulkOpen(false)}
          onDone={handleBulkDone}
        />
      )}

      {selectedTicket && (
        <TicketDetailModal
          key={selectedTicket.key}
          ticket={selectedTicket}
          reportId={id as string}
          nav={ticketNav}
          autoEdit={fillMode && canEdit}
          onClose={() => openTicket(null)}
          onUpdated={(updated) => {
            setData(prev => prev ? {
              ...prev,
              tickets: prev.tickets.map(t => t.key === updated.key ? updated : t),
            } : prev)
          }}
        />
      )}
    </div>
  )
}
