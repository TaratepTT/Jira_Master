'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api, { refreshReportFromJira, updateTicket, getJiraConnection, type BulkUpdateResponse } from '@/lib/api'
import { useUrlFilters, filtersToQuery, readFilters } from '@/lib/useUrlFilters'
import ViewsMenu from '@/components/dashboard/ViewsMenu'
import InlineCell, { type CellState } from '@/components/dashboard/InlineCell'
import { AppNav, PageHeader } from '@/components/layout/AppShell'
import ExpandableKeys from '@/components/dashboard/ExpandableKeys'
import { useAuth } from '@/components/auth/AuthContext'
import RootCauseInsights from '@/components/dashboard/RootCauseInsights'
import BulkEditModal from '@/components/dashboard/BulkEditModal'
import TrendChart from '@/components/dashboard/TrendChart'
import AgingPanel from '@/components/dashboard/AgingPanel'
import FlowPanel from '@/components/dashboard/FlowPanel'
import BreakdownList from '@/components/dashboard/BreakdownList'
import MultiSelectFilter from '@/components/dashboard/MultiSelectFilter'
import SortableHeader from '@/components/dashboard/SortableHeader'
import FilteredInsights from '@/components/dashboard/FilteredInsights'
import TicketDetailModal, { type TicketNav } from '@/components/dashboard/TicketDetailModal'
import type { ReportData, SortDir, SortKey, TicketDetail } from '@/components/dashboard/types'
import {
  TYPE_OF_ISSUE_OPTIONS, formatDate, isClosedStatus, isIncomplete, jiraBrowseUrl, openTicketAges, pct, statusBadge,
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
export default function DashboardPage() {
  const { id } = useParams<{ id: string }>()
  const { canEdit, user } = useAuth()
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
  const assigneeFilter = filters.assignee
  const setAssigneeFilter = (assignee: string[]) => setFilters({ assignee })

  // "งานของฉัน": match the ticket assignee against my Jira name (when my Jira account is
  // connected) or my Dashboard name.
  const [jiraName, setJiraName] = useState<string | null>(null)
  useEffect(() => {
    getJiraConnection().then(c => setJiraName(c.connected ? c.account?.displayName ?? null : null)).catch(() => setJiraName(null))
  }, [])

  // "แก้ในตาราง": BU / Type / Root Cause / Resolution become editable cells (saved to Jira one by one)
  const [inlineEdit, setInlineEdit] = useState(false)
  const [cellStatus, setCellStatus] = useState<Record<string, CellState>>({})

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

  const assigneeOptions = useMemo(() => {
    if (!data) return []
    const counts: Record<string, number> = {}
    data.tickets.forEach(t => {
      const a = t.assignee || 'ไม่มีผู้รับผิดชอบ'
      counts[a] = (counts[a] ?? 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
  }, [data])

  const myNames = [jiraName, user?.name].filter((n): n is string => !!n)
  const myAssignee = assigneeOptions.find(o => myNames.some(n => n.trim().toLowerCase() === o.value.trim().toLowerCase()))?.value ?? null

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

      const matchAssignee = !assigneeFilter.length || assigneeFilter.includes(t.assignee || 'ไม่มีผู้รับผิดชอบ')

      return matchSearch && matchBu && matchStatus && matchSystem && matchCategory && matchAssignee
    })

    return sortTickets(result, sortKey, sortDir)
  }, [data, search, buFilter, statusFilter, systemFilter, categoryFilter, assigneeFilter, incompleteOnly, sortKey, sortDir])

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

  const activeFilterCount = buFilter.length + statusFilter.length + systemFilter.length + categoryFilter.length + assigneeFilter.length + (incompleteOnly ? 1 : 0)
  const hasActiveFilterOrSearch = activeFilterCount > 0 || search.trim().length > 0

  const clearAllFilters = () => {
    setFilters({ bu: [], status: [], system: [], category: [], assignee: [], q: '', incomplete: false })
  }

  // Save one inline-edited cell to Jira (same endpoint as the ticket window)
  const saveCell = async (key: string, field: 'businessUnit' | 'typeOfIssue' | 'rootCause' | 'resolution', value: string) => {
    const id_ = `${key}:${field}`
    setCellStatus(s => ({ ...s, [id_]: { state: 'saving' } }))
    try {
      const r = await updateTicket(id as string, key, { [field]: value })
      setData(prev => prev ? { ...prev, tickets: prev.tickets.map(t => (t.key === key ? { ...t, ...r.ticket } as TicketDetail : t)) } : prev)
      setCellStatus(s => ({ ...s, [id_]: r.warnings.length ? { state: 'error', message: r.warnings.join(' | ') } : { state: 'saved' } }))
      if (!r.warnings.length) setTimeout(() => setCellStatus(s => { const n = { ...s }; if (n[id_]?.state === 'saved') delete n[id_]; return n }), 2500)
    } catch (e: unknown) {
      setCellStatus(s => ({ ...s, [id_]: { state: 'error', message: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'บันทึกไม่สำเร็จ' } }))
    }
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
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="text-center space-y-3">
        <p className="font-medium text-danger">{error}</p>
        <Link href="/" className="link text-sm">กลับไปหน้ารายการ report</Link>
      </div>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen bg-paper">
      <AppNav />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-10 space-y-4">
        <div className="h-9 w-2/3 rounded bg-sunken animate-pulse" />
        <div className="h-20 rounded bg-sunken animate-pulse" />
        <div className="h-64 rounded bg-sunken animate-pulse" />
      </div>
    </div>
  )

  const { aggregations: ag, totalTickets, name, createdAt } = data
  const asOf = new Date(data.refreshedAt ?? createdAt)
  const closedN = data.tickets.filter(t => isClosedStatus(t.status)).length
  const openN = totalTickets - closedN
  const l3N = ag.l3Tickets.length
  const ages = openTicketAges(data.tickets, asOf)
  const over14 = ages.filter(a => a.days > 14).length
  const oldest = ages[0]
  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])
  const pickAndShow = (patch: Parameters<typeof setFilters>[0]) => {
    setFilters(patch)
    document.getElementById('issue-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const thaiDate = (d: string | Date) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  const thaiDateTime = (d: string | Date) => new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const ledger: Array<{ label: string; value: string; tone?: 'attention' | 'danger'; onClick?: () => void; hint?: string }> = [
    { label: 'Tickets ใน report', value: totalTickets.toLocaleString() },
    { label: 'ปิดแล้ว', value: `${pct(closedN, totalTickets)}%`, hint: `${closedN} ใบ` },
    { label: 'ยังเปิดอยู่', value: openN.toLocaleString() },
    { label: 'ค้างเกิน 14 วัน', value: over14.toLocaleString(), tone: over14 ? 'attention' : undefined },
    { label: 'อยู่ที่ L3', value: l3N.toLocaleString(), tone: l3N ? 'danger' : undefined },
    {
      label: 'ข้อมูลยังไม่ครบ', value: incompleteCount.toLocaleString(), tone: incompleteCount ? 'attention' : undefined,
      onClick: incompleteCount ? () => pickAndShow({ incomplete: true }) : undefined, hint: incompleteCount ? 'ดูในตาราง' : undefined,
    },
  ]
  const toneText = { attention: 'text-attention', danger: 'text-danger' } as const

  return (
    <div className="min-h-screen bg-paper text-ink">
      <AppNav />

      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 space-y-10">
        <PageHeader
          back={{ href: '/', label: 'Reports' }}
          title={name}
          description={<>sync เมื่อ {thaiDate(createdAt)}{data.refreshedAt && <>, รีเฟรชจาก Jira ล่าสุด {thaiDateTime(data.refreshedAt)}</>}</>}
          actions={
            <>
              <button onClick={handleExportCsv} disabled={exportingCsv} className="btn">
                {exportingCsv ? 'กำลัง export...' : 'Export CSV'}
              </button>
              <Link href={`/compare?current=${id}`} className="btn">เทียบกับ report ก่อนหน้า</Link>
              <Link href={`/dashboard/${id}/summary`} className="btn">สรุปสำหรับประชุม</Link>
              {canEdit && (
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  title="ดึงสถานะ ผู้รับผิดชอบ และวันที่ resolve ล่าสุดจาก Jira มาใส่ report นี้"
                  className="btn-primary"
                >
                  <svg className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  {refreshing ? 'กำลังรีเฟรช...' : 'รีเฟรชจาก Jira'}
                </button>
              )}
            </>
          }
        />

        {refreshMsg && (
          <div role="status" className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 ${refreshMsg.ok ? 'border-line bg-ok-soft' : 'border-line bg-danger-soft'}`}>
            <div className="text-[13px]">
              <p className={`font-medium ${refreshMsg.ok ? 'text-ok' : 'text-danger'}`}>{refreshMsg.text}</p>
              {refreshMsg.details?.map((d, i) => <p key={i} className="mt-0.5 text-muted">{d}</p>)}
            </div>
            <button onClick={() => setRefreshMsg(null)} className="btn-quiet" aria-label="ปิดข้อความ">ปิด</button>
          </div>
        )}

        {/* Headline: the week in one sentence */}
        <section>
          <p className="max-w-[40rem] text-balance text-[26px] font-semibold leading-[1.35] tracking-[-0.01em] sm:text-[32px]">
            <span className="num">{totalTickets.toLocaleString()}</span> tickets ใน report นี้
            ปิดแล้ว <span className="num">{closedN.toLocaleString()}</span> ยังเปิดอยู่ <span className="num">{openN.toLocaleString()}</span>
          </p>
          <p className="mt-2 max-w-[46rem] text-[15px] leading-relaxed text-muted">
            {oldest
              ? <>ใบที่ค้างนานที่สุดเปิดมาแล้ว <span className="num text-ink">{oldest.days}</span> วัน (<button onClick={() => openTicket(oldest.ticket.key)} className="link key">{oldest.ticket.key}</button>)</>
              : 'ไม่มี ticket ที่เปิดค้าง'}
            {l3N > 0 && <>, มี <span className="num text-danger">{l3N}</span> ใบอยู่ที่ L3</>}
            {ag.top3Cat[0] && <>, ประเภทที่เจอบ่อยที่สุดคือ <span className="text-ink">{ag.top3Cat[0].category}</span> ({ag.top3Cat[0].count} ใบ)</>}
          </p>

          {/* KPI ledger */}
          <dl className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6">
            {ledger.map((c, i) => {
              const inner = (
                <>
                  <dt className="text-[12px] text-muted">{c.label}</dt>
                  <dd className={`mt-1 text-[24px] font-semibold leading-none num ${c.tone ? toneText[c.tone] : 'text-ink'}`}>{c.value}</dd>
                  {c.hint && <dd className={`mt-1.5 text-[12px] ${c.onClick ? 'text-accent' : 'text-faint'}`}>{c.hint}</dd>}
                </>
              )
              const cls = `border-line px-4 py-3.5 text-left ${i % 2 ? 'border-l' : ''} ${i >= 2 ? 'border-t' : ''} sm:border-t-0 sm:border-l ${i % 3 === 0 ? 'sm:border-l-0' : ''} ${i >= 3 ? 'sm:border-t' : ''} lg:border-t-0 lg:border-l ${i === 0 ? 'lg:border-l-0' : ''}`
              return c.onClick
                ? <button key={c.label} onClick={c.onClick} className={`${cls} transition-colors hover:bg-sunken`}>{inner}</button>
                : <div key={c.label} className={cls}>{inner}</div>
            })}
          </dl>
        </section>

        {/* Needs attention */}
        {(incompleteCount > 0 || l3N > 0) && (
          <section aria-labelledby="attention-title">
            <h2 id="attention-title" className="section-title mb-3">ต้องติดตาม</h2>
            <div className="panel divide-y divide-line">
              {incompleteCount > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-attention" aria-hidden />
                    <div>
                      <p className="text-[14px] font-medium">{incompleteCount} tickets ยังกรอกข้อมูลไม่ครบ</p>
                      <p className="text-[13px] text-muted">ขาด BU, Type of Issue, Root Cause หรือ Resolution อย่างใดอย่างหนึ่ง</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => pickAndShow({ incomplete: !incompleteOnly })} className="btn">
                      {incompleteOnly ? 'แสดงทุก ticket' : 'ดูเฉพาะใบที่ไม่ครบ'}
                    </button>
                    <button onClick={startFillQueue} className="btn-primary">
                      {canEdit ? 'กรอกทีละใบ' : 'ดูทีละใบ'}
                    </button>
                  </div>
                </div>
              )}
              {ag.l3Tickets.map(t => (
                <button
                  key={t.key}
                  onClick={() => openTicket(t.key)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-sunken"
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
                  <span className="min-w-0">
                    <span className="text-[14px] font-medium"><span className="key text-accent">{t.key}</span> อยู่ที่ {t.status}</span>
                    <span className="block truncate text-[13px] text-muted">{t.summary ?? t.bu}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Breakdowns — click a row to filter the ticket table */}
        <section aria-labelledby="breakdown-title">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="breakdown-title" className="section-title">แยกตามหมวด</h2>
            <p className="section-note">คลิกรายการเพื่อกรองตาราง ticket ด้านล่าง</p>
          </div>
          <div className="panel panel-pad grid gap-x-10 gap-y-7 md:grid-cols-2 lg:grid-cols-3">
            <BreakdownList title="Status" rows={statusOptions.map(o => [o.value, o.count])} total={totalTickets}
              active={statusFilter} onPick={v => pickAndShow({ status: toggleIn(statusFilter, v) })} />
            <BreakdownList title="Business Unit" rows={buOptions.map(o => [o.value, o.count])} total={totalTickets}
              active={buFilter} onPick={v => pickAndShow({ bu: toggleIn(buFilter, v) })} />
            <BreakdownList title="Type of Issue" rows={categoryOptions.map(o => [o.value, o.count])} total={totalTickets}
              active={categoryFilter} onPick={v => pickAndShow({ category: toggleIn(categoryFilter, v) })} />
            <BreakdownList title="ระบบ" rows={systemOptions.map(o => [o.value, o.count])} total={totalTickets}
              active={systemFilter} onPick={v => pickAndShow({ system: toggleIn(systemFilter, v) })} />
            <BreakdownList title="ผู้รับผิดชอบ" rows={ag.topAssignees.map(a => [a.name, a.count])} total={totalTickets} emptyText="ไม่มีข้อมูล assignee" />
            <BreakdownList title="Priority" rows={Object.entries(ag.priorityCount).sort((a, b) => b[1] - a[1])} total={totalTickets} emptyText="ไม่มีข้อมูล priority" />
          </div>
        </section>

        {/* Time-based views */}
        <section className="space-y-5" aria-label="แนวโน้มและอายุ ticket">
          <TrendChart tickets={data.tickets} />
          <AgingPanel tickets={data.tickets} asOf={asOf} onOpenTicket={key => openTicket(key)} />
          <FlowPanel tickets={data.tickets} canRefresh={canEdit} onRefresh={handleRefresh} refreshing={refreshing} />
        </section>

        {/* Frequency by category */}
        <section aria-labelledby="freq-title">
          <h2 id="freq-title" className="section-title mb-3">ความถี่ตามหมวดปัญหา</h2>
          <div className="panel overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="px-4 py-2 font-medium w-12">#</th>
                  <th className="px-4 py-2 font-medium">หมวด</th>
                  <th className="px-4 py-2 font-medium text-right">จำนวน</th>
                  <th className="px-4 py-2 font-medium text-right">สัดส่วน</th>
                  <th className="px-4 py-2 font-medium">Tickets</th>
                </tr>
              </thead>
              <tbody>
                {ag.frequencyTable.map(row => (
                  <tr key={row.rank} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-4 py-2 text-faint num">{row.rank}</td>
                    <td className="px-4 py-2 font-medium">{row.category || <span className="font-normal text-faint">ไม่ระบุ</span>}</td>
                    <td className="px-4 py-2 text-right num">{row.count}</td>
                    <td className="px-4 py-2 text-right text-muted num">{row.pct}</td>
                    <td className="px-4 py-2"><ExpandableKeys keys={row.keys} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-semibold">
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2">รวม</td>
                  <td className="px-4 py-2 text-right num">{totalTickets}</td>
                  <td className="px-4 py-2 text-right num">100%</td>
                  <td className="px-4 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <RootCauseInsights reportId={id} />

        {/* Pinned tickets */}
        {highlighted.size > 0 && (
          <section aria-labelledby="pinned-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="pinned-title" className="section-title">ที่เลือกไว้ <span className="text-muted num">({highlighted.size})</span></h2>
              <div className="flex gap-2">
                {canEdit && <button onClick={() => setBulkOpen(true)} className="btn-primary">แก้ไขพร้อมกัน {highlighted.size} ใบ</button>}
                <button onClick={() => setHighlighted(new Set())} className="btn">ล้างที่เลือก</button>
              </div>
            </div>
            <div className="panel overflow-x-auto">
              <table className="w-full text-[13px]">
                <tbody>
                  {data.tickets.filter(t => highlighted.has(t.key)).map(t => (
                    <tr key={t.key} onClick={() => openTicket(t.key)} className="cursor-pointer border-b border-line last:border-b-0 hover:bg-sunken">
                      <td className="whitespace-nowrap px-4 py-2"><span className="key text-accent">{t.key}</span></td>
                      <td className="min-w-[220px] px-4 py-2">{t.summary || '—'}</td>
                      <td className="px-4 py-2"><span className={`chip ${statusBadge(t.status)}`}>{t.status}</span></td>
                      <td className="px-4 py-2 text-muted">{t.typeOfIssue || '—'}</td>
                      <td className="px-2 py-2 text-right" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleHighlight(t.key)} className="btn-quiet" aria-label={`เอา ${t.key} ออกจากที่เลือก`}>เอาออก</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Ticket table */}
        <section id="issue-table" aria-labelledby="issues-title" className="scroll-mt-20">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="issues-title" className="section-title">Tickets</h2>
              <p className="section-note num">แสดง {filteredTickets.length} จาก {totalTickets}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหา key, summary, root cause"
                aria-label="ค้นหา ticket"
                className="field w-64"
              />
              <ViewsMenu
                currentQuery={filtersToQuery({ ...filters, ticket: null }).replace(/^\?/, '')}
                onApply={q => setFilters({ ...readFilters(`?${q}`), ticket: null })}
              />
              <button onClick={copyViewLink} className="btn" title="คัดลอกลิงก์ที่มีตัวกรองนี้ ส่งให้ทีมเปิดแล้วเห็นแบบเดียวกัน">
                {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
              </button>
              {canEdit && (
                <button
                  onClick={() => setInlineEdit(v => !v)}
                  aria-pressed={inlineEdit}
                  title="แก้ BU, Type of Issue, Root Cause และ Resolution ในตารางได้เลย แต่ละช่องบันทึกลง Jira ทันทีที่ออกจากช่อง"
                  className={inlineEdit ? 'btn-primary' : 'btn'}
                >
                  {inlineEdit ? 'เลิกแก้ในตาราง' : 'แก้ในตาราง'}
                </button>
              )}
            </div>
          </div>

          <div className="panel">
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <MultiSelectFilter label="Business Unit" options={buOptions} selected={buFilter} onChange={setBuFilter} />
              <MultiSelectFilter label="Status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} />
              <MultiSelectFilter label="ระบบ" options={systemOptions} selected={systemFilter} onChange={setSystemFilter} />
              <MultiSelectFilter label="Type of Issue" options={categoryOptions} selected={categoryFilter} onChange={setCategoryFilter} />
              <MultiSelectFilter label="ผู้รับผิดชอบ" options={assigneeOptions} selected={assigneeFilter} onChange={setAssigneeFilter} />
              <button
                onClick={() => myAssignee && setAssigneeFilter(assigneeFilter.length === 1 && assigneeFilter[0] === myAssignee ? [] : [myAssignee])}
                disabled={!myAssignee}
                aria-pressed={!!myAssignee && assigneeFilter.length === 1 && assigneeFilter[0] === myAssignee}
                title={myAssignee ? `ticket ที่ ${myAssignee} รับผิดชอบ` : `ไม่พบ ticket ที่ assignee ตรงกับชื่อคุณ (${myNames.join(' / ') || '—'}) ใน report นี้`}
                className={myAssignee && assigneeFilter.length === 1 && assigneeFilter[0] === myAssignee ? 'btn border-accent bg-accent-soft text-accent hover:bg-accent-soft' : 'btn'}
              >
                งานของฉัน
              </button>
              <button
                onClick={() => setFilters({ incomplete: !incompleteOnly })}
                aria-pressed={incompleteOnly}
                className={incompleteOnly ? 'btn border-attention bg-attention-soft text-attention hover:bg-attention-soft' : 'btn'}
              >
                ข้อมูลไม่ครบ <span className="num">{incompleteCount}</span>
              </button>
              {activeFilterCount > 0 && (
                <button onClick={clearAllFilters} className="btn-quiet">ล้างตัวกรอง ({activeFilterCount})</button>
              )}
            </div>

            {(buFilter.length > 0 || statusFilter.length > 0 || systemFilter.length > 0 || categoryFilter.length > 0 || assigneeFilter.length > 0) && (
              <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
                {([
                  ['BU', buFilter, (v: string) => setBuFilter(buFilter.filter(x => x !== v))],
                  ['Status', statusFilter, (v: string) => setStatusFilter(statusFilter.filter(x => x !== v))],
                  ['ระบบ', systemFilter, (v: string) => setSystemFilter(systemFilter.filter(x => x !== v))],
                  ['Type', categoryFilter, (v: string) => setCategoryFilter(categoryFilter.filter(x => x !== v))],
                  ['ผู้รับผิดชอบ', assigneeFilter, (v: string) => setAssigneeFilter(assigneeFilter.filter(x => x !== v))],
                ] as Array<[string, string[], (v: string) => void]>).flatMap(([label, list, remove]) => list.map(v => (
                  <span key={`${label}-${v}`} className="inline-flex items-center gap-1 rounded bg-accent-soft py-0.5 pl-2 pr-1 text-[12px] text-accent">
                    {label}: {v}
                    <button onClick={() => remove(v)} className="rounded px-1 hover:bg-surface" aria-label={`เอาตัวกรอง ${label} ${v} ออก`}>×</button>
                  </span>
                )))}
              </div>
            )}

            {hasActiveFilterOrSearch && <div className="border-b border-line p-4"><FilteredInsights tickets={filteredTickets} /></div>}

            <div className="overflow-x-auto">
              <table className="text-[13px]" style={{ tableLayout: 'fixed', width: Object.values(colWidths).reduce((a, b) => a + b, 0) + 60 }}>
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
                <thead className="bg-sunken">
                  <tr className="border-b border-line">
                    <SortableHeader label="Key"        sortKey="key"          activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('key')} />
                    <SortableHeader label="Summary"    sortKey="summary"      activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('summary')} />
                    <SortableHeader label="BU"         sortKey="businessUnit" activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('businessUnit')} />
                    <SortableHeader label="Status"     sortKey="status"       activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('status')} />
                    <SortableHeader label="Type"       sortKey="typeOfIssue"  activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('typeOfIssue')} />
                    <SortableHeader label="Root Cause" sortKey="rootCause"    activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('rootCause')} />
                    <SortableHeader label="Resolution" sortKey="resolution"   activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('resolution')} />
                    <SortableHeader label="Deploy"     sortKey="deployDate"   activeKey={sortKey} dir={sortDir} onSort={handleSort} onResizeStart={startResize('deployDate')} />
                    <th className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        onChange={toggleAllShown}
                        aria-label="เลือกทุกรายการที่แสดงอยู่"
                        title="เลือก/ยกเลิกทุกรายการที่แสดงอยู่"
                        className="h-4 w-4 cursor-pointer rounded border-line-strong accent-[var(--accent)]"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map(t => {
                    const empty = <span className="text-faint">—</span>
                    return (
                      <tr
                        key={t.key}
                        onClick={() => { if (!inlineEdit) openTicket(t.key) }}
                        className={`border-b border-line align-top transition-colors ${inlineEdit ? '' : 'cursor-pointer hover:bg-sunken'} ${highlighted.has(t.key) ? 'bg-accent-soft' : ''}`}
                      >
                        <td className="overflow-hidden whitespace-nowrap px-3 py-2">
                          <a
                            href={jiraBrowseUrl(t.key)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="key text-accent hover:underline"
                            title="เปิดใน Jira"
                          >
                            {t.key}
                          </a>
                        </td>
                        <td className="overflow-hidden whitespace-normal break-words px-3 py-2">{t.summary || empty}</td>
                        <td className="overflow-hidden whitespace-normal break-words px-3 py-2 text-muted">{inlineEdit
                          ? <InlineCell value={t.businessUnit || ''} label={`Business Unit ของ ${t.key}`} status={cellStatus[`${t.key}:businessUnit`]} onSave={v => saveCell(t.key, 'businessUnit', v)} />
                          : (t.businessUnit || empty)}</td>
                        <td className="overflow-hidden px-3 py-2"><span className={`chip ${statusBadge(t.status)}`}>{t.status}</span></td>
                        <td className="overflow-hidden whitespace-normal break-words px-3 py-2 text-muted">{inlineEdit
                          ? <InlineCell value={t.typeOfIssue || ''} label={`Type of Issue ของ ${t.key}`} status={cellStatus[`${t.key}:typeOfIssue`]} onSave={v => saveCell(t.key, 'typeOfIssue', v)} options={TYPE_OF_ISSUE_OPTIONS} />
                          : (t.typeOfIssue || empty)}</td>
                        <td className="overflow-hidden whitespace-normal break-words px-3 py-2 text-muted">{inlineEdit
                          ? <InlineCell value={t.rootCause || ''} label={`Root Cause ของ ${t.key}`} status={cellStatus[`${t.key}:rootCause`]} onSave={v => saveCell(t.key, 'rootCause', v)} multiline />
                          : (t.rootCause || empty)}</td>
                        <td className="overflow-hidden whitespace-normal break-words px-3 py-2 text-muted">{inlineEdit
                          ? <InlineCell value={t.resolution || ''} label={`Resolution ของ ${t.key}`} status={cellStatus[`${t.key}:resolution`]} onSave={v => saveCell(t.key, 'resolution', v)} multiline />
                          : (t.resolution || empty)}</td>
                        <td className="overflow-hidden whitespace-nowrap px-3 py-2 num">{t.deployDate ? formatDate(t.deployDate) : empty}</td>
                        <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={highlighted.has(t.key)}
                            onChange={() => toggleHighlight(t.key)}
                            aria-label={`เลือก ${t.key}`}
                            className="h-4 w-4 cursor-pointer rounded border-line-strong accent-[var(--accent)]"
                          />
                        </td>
                      </tr>
                    )
                  })}
                  {!filteredTickets.length && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-[13px] text-muted">
                      ไม่มี ticket ที่ตรงกับตัวกรองนี้
                      {activeFilterCount > 0 && <button onClick={clearAllFilters} className="link ml-2">ล้างตัวกรอง</button>}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-faint">คลิกแถวเพื่อเปิดรายละเอียด ลากขอบหัวตารางเพื่อปรับความกว้าง ในหน้าต่าง ticket ใช้ปุ่มลูกศรซ้ายขวาเพื่อเลื่อนใบ</p>
        </section>
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
