'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import ThemeToggle from '@/components/theme/ThemeToggle'
import LogoutButton from '@/components/auth/LogoutButton'

interface PreviewTicket {
  key: string
  system: string
  status: string
  businessUnit: string
  typeOfIssue: string
  recurringCategory?: string
  standaloneCategory?: string
  summary?: string
  rootCause?: string
  resolution?: string
  deployDate?: string
  problems: string[]
  valid: boolean
}

type LoadState =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; message: string }

type SaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'error'; message: string }

type ViewFilter = 'all' | 'valid' | 'invalid'
type EditableField = 'summary' | 'businessUnit' | 'status' | 'typeOfIssue' | 'rootCause' | 'resolution'

const REQUIRED_FIELDS: Array<{ key: EditableField | 'key' | 'system'; label: string }> = [
  { key: 'key',          label: 'ไม่มี Key' },
  { key: 'status',       label: 'ไม่มี Status' },
  { key: 'businessUnit', label: 'ไม่มี Business Unit' },
  { key: 'typeOfIssue',  label: 'ไม่มี Type of Issue' },
  { key: 'system',       label: 'ไม่มี System' },
]

// Recompute validation problems for a single ticket after an inline edit
function revalidate(t: PreviewTicket, allKeys: string[]): PreviewTicket {
  const problems: string[] = []
  if (!t.key) problems.push('ไม่มี Key')
  if (!t.status) problems.push('ไม่มี Status')
  if (!t.businessUnit) problems.push('ไม่มี Business Unit')
  if (!t.typeOfIssue) problems.push('ไม่มี Type of Issue')
  if (!t.system) problems.push('ไม่มี System')
  const dupCount = allKeys.filter(k => k === t.key).length
  if (dupCount > 1) problems.push('Key ซ้ำในชุดข้อมูลนี้')
  return { ...t, problems, valid: problems.length === 0 }
}

// ── Inline editable text cell ──────────────────────────────────
function EditableText({
  value, onSave, placeholder, multiline,
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  if (editing) {
    const Field = multiline ? 'textarea' : 'input'
    return (
      <Field
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !multiline) commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        rows={multiline ? 2 : undefined}
        className="w-full min-w-[140px] rounded border border-blue-400 bg-white dark:bg-slate-700 px-1.5 py-1 text-xs text-slate-800 dark:text-slate-100 outline-none resize-none"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left truncate hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded px-1 py-0.5 -mx-1 transition-colors"
      title={value || placeholder}
    >
      {value || <span className="text-red-400 dark:text-red-500 italic">{placeholder ?? 'ว่าง'}</span>}
    </button>
  )
}

// ── Inline editable dropdown cell ──────────────────────────────
function EditableSelect({
  value, options, onSave, placeholder,
}: {
  value: string
  options: string[]
  onSave: (v: string) => void
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        onChange={e => { onSave(e.target.value); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="w-full min-w-[120px] rounded border border-blue-400 bg-white dark:bg-slate-700 px-1.5 py-1 text-xs text-slate-800 dark:text-slate-100 outline-none"
      >
        <option value="">— เลือก —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left truncate hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded px-1 py-0.5 -mx-1 transition-colors"
    >
      {value || <span className="text-red-400 dark:text-red-500 italic">{placeholder ?? 'ว่าง'}</span>}
    </button>
  )
}

function ValidateScreenInner() {
  const router = useRouter()
  const params = useSearchParams()
  const jql = params.get('jql') ?? ''
  const reportName = params.get('reportName') ?? `Jira Sync — ${new Date().toISOString().slice(0, 10)}`

  const [loadState, setLoadState] = useState<LoadState>({ state: 'loading' })
  const [saveState, setSaveState] = useState<SaveState>({ state: 'idle' })
  const [tickets, setTickets] = useState<PreviewTicket[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!jql) {
      setLoadState({ state: 'error', message: 'ไม่พบ JQL — กลับไปตั้งค่าที่หน้า Jira Sync' })
      return
    }
    api.post('/api/jira/preview-all', { jql })
      .then(r => {
        const data = r.data as { tickets: PreviewTicket[] }
        setTickets(data.tickets)
        setSelected(new Set(data.tickets.filter(t => t.valid).map(t => t.key)))
        setLoadState({ state: 'ready' })
      })
      .catch(e => {
        const msg = e?.response?.data?.message ?? 'โหลดข้อมูลไม่สำเร็จ'
        setLoadState({ state: 'error', message: msg })
      })
  }, [jql])

  // ── Dropdown option pools, derived from the fetched data ──────
  const statusOptions = useMemo(() => {
    const set = new Set(tickets.map(t => t.status).filter(Boolean))
    ;['Closed', 'Open', 'In Progress', 'L2-IN PROGRESS', 'L3-INVESTIGATE', 'Cancel', 'Waiting for customer'].forEach(s => set.add(s))
    return Array.from(set).sort()
  }, [tickets])

  const typeOfIssueOptions = useMemo(() => {
    const set = new Set(tickets.map(t => t.typeOfIssue).filter(Boolean))
    ;['Non-app issue', 'User request', 'Human Error', 'Data Issue', 'Other'].forEach(s => set.add(s))
    return Array.from(set).sort()
  }, [tickets])

  // ── Edit a single field on a single ticket ─────────────────────
  const editField = (key: string, field: EditableField, value: string) => {
    setTickets(prev => {
      const allKeys = prev.map(t => t.key)
      return prev.map(t => t.key === key ? revalidate({ ...t, [field]: value }, allKeys) : t)
    })
  }

  const validCount   = useMemo(() => tickets.filter(t => t.valid).length, [tickets])
  const invalidCount = tickets.length - validCount

  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      const matchView =
        viewFilter === 'all' ||
        (viewFilter === 'valid' && t.valid) ||
        (viewFilter === 'invalid' && !t.valid)
      const matchSearch =
        !search ||
        t.key.toLowerCase().includes(search.toLowerCase()) ||
        (t.summary ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.businessUnit ?? '').toLowerCase().includes(search.toLowerCase())
      return matchView && matchSearch
    })
  }, [tickets, viewFilter, search])

  const toggleOne = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev)
      filteredTickets.forEach(t => next.add(t.key))
      return next
    })
  }

  const deselectAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev)
      filteredTickets.forEach(t => next.delete(t.key))
      return next
    })
  }

  const selectOnlyValid = () => {
    setSelected(new Set(tickets.filter(t => t.valid).map(t => t.key)))
  }

  const handleConfirm = async () => {
    const chosen = tickets.filter(t => selected.has(t.key))
    if (!chosen.length) {
      setSaveState({ state: 'error', message: 'กรุณาเลือกอย่างน้อย 1 ticket' })
      return
    }
    setSaveState({ state: 'saving' })
    try {
      const { data } = await api.post('/api/jira/confirm', {
        reportName,
        tickets: chosen.map(({ problems, valid, ...rest }) => rest),
      })
      router.push(`/dashboard/${data.reportId}`)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'บันทึกไม่สำเร็จ'
      setSaveState({ state: 'error', message: msg })
    }
  }

  if (loadState.state === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-3">
          <svg className="mx-auto h-8 w-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-500 dark:text-slate-400">กำลังดึงข้อมูลจาก Jira เพื่อตรวจสอบ...</p>
        </div>
      </div>
    )
  }

  if (loadState.state === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm px-4">
          <p className="text-red-500 font-medium">{loadState.message}</p>
          <Link href="/jira" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">กลับไปหน้า Jira Sync</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/jira" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
            </Link>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">ตรวจสอบข้อมูลก่อนสร้าง Dashboard</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">{reportName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 py-8 space-y-6">

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-2xl font-semibold text-slate-800 dark:text-slate-100">{tickets.length}</p>
            <p className="text-xs text-slate-400 mt-0.5">ทั้งหมดที่ดึงมา</p>
          </div>
          <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-2xl font-semibold text-green-600 dark:text-green-400">{validCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">ผ่านการตรวจสอบ</p>
          </div>
          <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
            <p className={`text-2xl font-semibold ${invalidCount ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>{invalidCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">มีข้อมูลไม่ครบ</p>
          </div>
          <div className="rounded-xl bg-blue-600 p-4">
            <p className="text-2xl font-semibold text-white">{selected.size}</p>
            <p className="text-xs text-blue-100 mt-0.5">เลือกไว้เพื่อบันทึก</p>
          </div>
        </div>

        {invalidCount > 0 && (
          <div className="rounded-xl border border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/20 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-orange-800 dark:text-orange-300">
              <strong>{invalidCount} tickets</strong> มีข้อมูลไม่ครบ — คลิกที่เซลล์เพื่อแก้ไขได้โดยตรง แล้วรายการจะย้ายไปกลุ่ม &quot;ผ่าน&quot; อัตโนมัติ
            </p>
            <button
              onClick={() => setViewFilter('invalid')}
              className="text-xs font-medium text-orange-700 dark:text-orange-400 underline whitespace-nowrap"
            >
              ดูเฉพาะรายการที่มีปัญหา
            </button>
          </div>
        )}

        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {(['all', 'valid', 'invalid'] as ViewFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setViewFilter(f)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewFilter === f
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {f === 'all' ? `ทั้งหมด (${tickets.length})` : f === 'valid' ? `ผ่าน (${validCount})` : `มีปัญหา (${invalidCount})`}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา Key, Summary, BU..."
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 transition-colors w-56"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-slate-100 dark:border-slate-700">
            <span className="text-xs text-slate-400 mr-1">เลือกด่วน:</span>
            <button onClick={selectAllVisible} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">เลือกทั้งหมดที่แสดง</button>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <button onClick={deselectAllVisible} className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:underline">ไม่เลือกที่แสดง</button>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <button onClick={selectOnlyValid} className="text-xs font-medium text-green-600 dark:text-green-400 hover:underline">เลือกเฉพาะที่ผ่าน validation</button>
            <span className="ml-auto text-xs text-slate-400 italic">💡 คลิกที่เซลล์ใดก็ได้เพื่อแก้ไข</span>
          </div>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-10" />
                <col className="w-24" />
                <col className="w-52" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-44" />
                <col className="w-44" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                  <th className="py-2.5 px-3"></th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Key</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Summary</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">BU</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Status</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Root Cause</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">Resolution</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-slate-500 dark:text-slate-400">ปัญหา</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => (
                  <tr
                    key={t.key}
                    className={`border-b border-slate-100 dark:border-slate-700/50 transition-colors align-top ${
                      !t.valid ? 'bg-orange-50/40 dark:bg-orange-950/10' : ''
                    }`}
                  >
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(t.key)}
                        onChange={() => toggleOne(t.key)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="py-2 px-3 font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{t.key}</td>
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-200">
                      <EditableText value={t.summary ?? ''} onSave={v => editField(t.key, 'summary', v)} placeholder="ไม่มี summary" />
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                      <EditableText value={t.businessUnit} onSave={v => editField(t.key, 'businessUnit', v)} placeholder="ไม่มี BU" />
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                      <EditableSelect value={t.status} options={statusOptions} onSave={v => editField(t.key, 'status', v)} />
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                      <EditableText value={t.rootCause ?? ''} onSave={v => editField(t.key, 'rootCause', v)} placeholder="ไม่มีข้อมูล" multiline />
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                      <EditableText value={t.resolution ?? ''} onSave={v => editField(t.key, 'resolution', v)} placeholder="ไม่มีข้อมูล" multiline />
                    </td>
                    <td className="py-2 px-3">
                      {t.problems.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {t.problems.map((p, i) => (
                            <span key={i} className="rounded-full bg-red-50 dark:bg-red-900/30 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5"/></svg>
                          ครบถ้วน
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredTickets.length && (
                  <tr><td colSpan={8} className="py-10 text-center text-sm text-slate-400">ไม่พบข้อมูลที่ตรงกับตัวกรอง</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {saveState.state === 'error' && (
          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-5 py-3">
            <p className="text-sm text-red-700 dark:text-red-400">{saveState.message}</p>
          </div>
        )}

        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-lg">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            จะสร้าง Dashboard จาก <strong className="text-blue-600 dark:text-blue-400">{selected.size}</strong> จากทั้งหมด {tickets.length} tickets
          </p>
          <button
            onClick={handleConfirm}
            disabled={saveState.state === 'saving' || selected.size === 0}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveState.state === 'saving' ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                กำลังบันทึก...
              </>
            ) : (
              <>
                ยืนยันและสร้าง Dashboard
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
              </>
            )}
          </button>
        </div>

      </main>
    </div>
  )
}

export default function ValidateScreen() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    }>
      <ValidateScreenInner />
    </Suspense>
  )
}
