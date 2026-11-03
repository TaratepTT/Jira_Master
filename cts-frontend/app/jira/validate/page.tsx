'use client'

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { AppNav, PageHeader } from '@/components/layout/AppShell'
import { TYPE_OF_ISSUE_OPTIONS } from '@/components/dashboard/utils'

// Value of a field found in an earlier report for the same ticket (Jira has it empty)
interface CarryValue { value: string; reportName: string; reportDate: string }
type CarryField = 'businessUnit' | 'typeOfIssue' | 'rootCause' | 'resolution' | 'deployDate'
const CARRY_LABEL: Record<CarryField, string> = {
  businessUnit: 'BU', typeOfIssue: 'Type of Issue', rootCause: 'Root Cause', resolution: 'Resolution', deployDate: 'Deploy Date',
}

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
  assignee?: string
  priority?: string
  suggestedCategory?: string | null
  ticketCreatedAt?: string | null
  resolvedAt?: string | null
  carryOver?: Partial<Record<CarryField, CarryValue>>
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
type EditableField = 'summary' | 'businessUnit' | 'status' | 'typeOfIssue' | 'rootCause' | 'resolution' | 'deployDate'

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
  value, onSave, placeholder, multiline, required,
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  multiline?: boolean
  /** empty value blocks saving -> show it in the attention colour; optional fields stay quiet */
  required?: boolean
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
        className="w-full min-w-[140px] rounded border border-accent bg-surface px-1.5 py-1 text-xs text-ink outline-none resize-none"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left truncate hover:bg-accent-soft rounded px-1 py-0.5 -mx-1 transition-colors"
      title={value || placeholder}
    >
      {value || <span className={required ? 'text-attention' : 'text-faint'}>{placeholder ?? 'ว่าง'}</span>}
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
        className="w-full min-w-[120px] rounded border border-accent bg-surface px-1.5 py-1 text-xs text-ink outline-none"
      >
        <option value="">— เลือก —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left truncate hover:bg-accent-soft rounded px-1 py-0.5 -mx-1 transition-colors"
    >
      {value || <span className="text-attention">{placeholder ?? 'ว่าง'}</span>}
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
  const [truncation, setTruncation] = useState<{ limit: number } | null>(null)

  useEffect(() => {
    if (!jql) {
      setLoadState({ state: 'error', message: 'ไม่พบ JQL — กลับไปตั้งค่าที่หน้า Jira Sync' })
      return
    }
    api.post('/api/jira/preview-all', { jql })
      .then(r => {
        const data = r.data as { tickets: PreviewTicket[]; truncated?: boolean; limit?: number }
        setTickets(data.tickets)
        setTruncation(data.truncated ? { limit: data.limit ?? data.tickets.length } : null)
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
    TYPE_OF_ISSUE_OPTIONS.forEach(s => set.add(s))
    return Array.from(set).sort()
  }, [tickets])

  // ── Edit a single field on a single ticket ─────────────────────
  const editField = (key: string, field: EditableField, value: string) => {
    setTickets(prev => {
      const allKeys = prev.map(t => t.key)
      return prev.map(t => t.key === key ? revalidate({ ...t, [field]: value }, allKeys) : t)
    })
  }

  // ── Carry-over from earlier reports ───────────────────────────
  // A suggestion is "pending" while the field is still empty; accepting it fills the field
  // (it is then saved into the new report like any inline edit).
  const pendingCarry = (t: PreviewTicket): CarryField[] =>
    (Object.keys(t.carryOver ?? {}) as CarryField[]).filter(f => !String(t[f] ?? '').trim())
  const carryTicketCount = useMemo(() => tickets.filter(t => pendingCarry(t).length > 0).length, [tickets])
  const carryFieldCount = useMemo(() => tickets.reduce((n, t) => n + pendingCarry(t).length, 0), [tickets])

  // Fill carried values. A ticket that becomes valid because of it is also ticked for saving
  // (it was left unticked at load time only because it had missing fields).
  const applyCarryTo = (pick: (t: PreviewTicket) => CarryField[]) => {
    const allKeys = tickets.map(t => t.key)
    const nowValid: string[] = []
    const next = tickets.map(t => {
      const fields = pick(t)
      if (!fields.length) return t
      const patch: Partial<PreviewTicket> = {}
      for (const f of fields) {
        const c = t.carryOver?.[f]
        if (c && !String(t[f] ?? '').trim()) patch[f] = c.value
      }
      const u = revalidate({ ...t, ...patch }, allKeys)
      if (!t.valid && u.valid) nowValid.push(u.key)
      return u
    })
    setTickets(next)
    if (nowValid.length) setSelected(prev => new Set([...Array.from(prev), ...nowValid]))
  }
  const applyCarry = (key: string, fields?: CarryField[]) =>
    applyCarryTo(t => (t.key === key ? (fields ?? pendingCarry(t)) : []))
  const applyAllCarry = () => applyCarryTo(pendingCarry)
  const [carryOpen, setCarryOpen] = useState<string | null>(null)

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
        tickets: chosen.map(({ problems, valid, suggestedCategory, carryOver, ...rest }) => rest),
      })
      router.push(`/dashboard/${data.reportId}?new=1`)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'บันทึกไม่สำเร็จ'
      setSaveState({ state: 'error', message: msg })
    }
  }

  if (loadState.state === 'loading') {
    return (
      <div className="min-h-screen bg-paper">
        <AppNav />
        <div className="flex flex-col items-center justify-center gap-3 py-32 text-center">
          <svg className="mx-auto h-6 w-6 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-[14px] text-muted">กำลังดึง ticket จาก Jira มาให้ตรวจ</p>
        </div>
      </div>
    )
  }

  if (loadState.state === 'error') {
    return (
      <div className="min-h-screen bg-paper">
        <AppNav />
        <div className="mx-auto max-w-sm space-y-3 px-4 py-32 text-center">
          <p className="font-medium text-danger">{loadState.message}</p>
          <Link href="/jira" className="link text-[14px]">กลับไปแก้เงื่อนไขการ sync</Link>
        </div>
      </div>
    )
  }

  const ledger: Array<{ label: string; value: number; tone?: string }> = [
    { label: 'ดึงมาทั้งหมด', value: tickets.length },
    { label: 'ข้อมูลครบ', value: validCount, tone: 'text-ok' },
    { label: 'ข้อมูลไม่ครบ', value: invalidCount, tone: invalidCount ? 'text-attention' : undefined },
    { label: 'เลือกไว้จะบันทึก', value: selected.size, tone: 'text-accent' },
  ]

  return (
    <div className="min-h-screen bg-paper text-ink">
      <AppNav />
      <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-8 lg:py-10 space-y-6">
        <PageHeader
          back={{ href: '/jira', label: 'แก้เงื่อนไขการ sync' }}
          title="ตรวจข้อมูลก่อนบันทึก"
          description={<>report: <span className="text-ink">{reportName}</span> คลิกช่องในตารางเพื่อแก้ ใบที่ข้อมูลครบจะถูกเลือกไว้ให้</>}
        />

        <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-4">
          {ledger.map((c, i) => (
            <div key={c.label} className={`border-line px-4 py-3 ${i % 2 ? 'border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l' : ''}`}>
              <dt className="text-[12px] text-muted">{c.label}</dt>
              <dd className={`mt-1 text-[22px] font-semibold leading-none num ${c.tone ?? 'text-ink'}`} data-testid={`ledger-${i}`}>{c.value}</dd>
            </div>
          ))}
        </dl>

        {truncation && (
          <div className="rounded-lg border border-line bg-danger-soft px-4 py-3">
            <p className="text-[14px] text-danger">
              <strong>ดึงข้อมูลได้ไม่ครบ</strong> มี ticket ตรงเงื่อนไขมากกว่า {truncation.limit.toLocaleString()} รายการ ระบบดึงมาแค่ {truncation.limit.toLocaleString()} รายการแรก
              กลับไปแคบ JQL ให้เล็กลง (เช่น ช่วงวันที่สั้นลง) เพื่อให้ได้ข้อมูลครบ
            </p>
          </div>
        )}

        {carryFieldCount > 0 && (
          <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[14px] text-ink">
              <strong>{carryTicketCount} tickets</strong> เคยกรอกข้อมูลไว้ใน report ก่อนหน้า ({carryFieldCount} ช่อง) แต่ใน Jira ยังว่าง
              <span className="mt-0.5 block text-[13px] text-muted">
                ค่าที่เติมจะบันทึกลง report ใหม่นี้ ไม่ได้เขียนกลับเข้า Jira ดูทีละใบได้จากปุ่ม ↺ ข้าง key
              </span>
            </p>
            <button
              onClick={applyAllCarry}
              className="btn-primary whitespace-nowrap"
            >
              เติมจาก report ก่อนหน้าทั้งหมด
            </button>
          </div>
        )}

        {invalidCount > 0 && (
          <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="flex items-start gap-3 text-[14px]">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-attention" aria-hidden />
              <span><strong>{invalidCount} tickets</strong> ข้อมูลไม่ครบ คลิกช่องในตารางเพื่อแก้ แล้วใบนั้นจะย้ายไปกลุ่ม &quot;ข้อมูลครบ&quot; เอง</span>
            </p>
            <button onClick={() => setViewFilter('invalid')} className="btn whitespace-nowrap">ดูเฉพาะใบที่ไม่ครบ</button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex overflow-hidden rounded-md border border-line-strong text-[13px] font-medium" role="group" aria-label="แสดง">
            {(['all', 'valid', 'invalid'] as ViewFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setViewFilter(f)}
                aria-pressed={viewFilter === f}
                className={`border-l border-line-strong px-3 py-1.5 first:border-l-0 transition-colors ${viewFilter === f ? 'bg-sunken text-ink' : 'bg-surface text-muted hover:text-ink'}`}
              >
                {f === 'all' ? 'ทั้งหมด' : f === 'valid' ? 'ข้อมูลครบ' : 'ไม่ครบ'} <span className="num text-faint">{f === 'all' ? tickets.length : f === 'valid' ? validCount : invalidCount}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button onClick={selectAllVisible} className="btn-quiet">เลือกทั้งหมดที่แสดง</button>
            <button onClick={deselectAllVisible} className="btn-quiet">ไม่เลือกที่แสดง</button>
            <button onClick={selectOnlyValid} className="btn-quiet">เลือกเฉพาะที่ข้อมูลครบ</button>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหา key, summary, BU"
              aria-label="ค้นหา"
              className="field ml-2 w-56"
            />
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-10" />
                <col className="w-24" />
                <col className="w-44" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-40" />
                <col className="w-40" />
                <col className="w-28" />
              </colgroup>
              <thead>
                <tr className="border-b border-line bg-sunken">
                  <th className="py-2.5 px-3"></th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">Key</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">Summary</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">BU</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">Status</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">Category</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">Root Cause</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">Resolution</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted">ปัญหา</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(t => (
                  <Fragment key={t.key}>
                  <tr
                    className={`border-b border-line transition-colors align-top ${
                      !t.valid ? 'bg-sunken' : ''
                    }`}
                  >
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(t.key)}
                        onChange={() => toggleOne(t.key)}
                        className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
                      />
                    </td>
                    <td className="py-2 px-3 font-medium text-accent whitespace-nowrap">
                      {t.key}
                      {pendingCarry(t).length > 0 && (
                        <>
                          <button
                            onClick={() => setCarryOpen(o => (o === t.key ? null : t.key))}
                            title="มีค่าจาก report ก่อนหน้า"
                            className="ml-1 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent hover:bg-accent-soft"
                          >
                            ↺ {pendingCarry(t).length}
                          </button>
                        </>
                      )}
                    </td>
                    <td className="py-2 px-3 text-ink">
                      <EditableText value={t.summary ?? ''} onSave={v => editField(t.key, 'summary', v)} placeholder="ไม่มี summary" />
                    </td>
                    <td className="py-2 px-3 text-muted">
                      <EditableText value={t.businessUnit} onSave={v => editField(t.key, 'businessUnit', v)} placeholder="ไม่มี BU" required />
                    </td>
                    <td className="py-2 px-3 text-muted">
                      <EditableSelect value={t.status} options={statusOptions} onSave={v => editField(t.key, 'status', v)} />
                    </td>
                    <td className="py-2 px-3 text-muted">
                      <EditableSelect value={t.typeOfIssue} options={typeOfIssueOptions} onSave={v => editField(t.key, 'typeOfIssue', v)} />
                      {!t.typeOfIssue && t.suggestedCategory && (
                        <button
                          onClick={() => editField(t.key, 'typeOfIssue', t.suggestedCategory!)}
                          className="mt-1 flex items-center gap-1 text-[10px] font-medium text-accent hover:underline"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                          </svg>
                          แนะนำ: {t.suggestedCategory}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3 text-muted">
                      <EditableText value={t.rootCause ?? ''} onSave={v => editField(t.key, 'rootCause', v)} placeholder="ยังไม่กรอก" multiline />
                    </td>
                    <td className="py-2 px-3 text-muted">
                      <EditableText value={t.resolution ?? ''} onSave={v => editField(t.key, 'resolution', v)} placeholder="ยังไม่กรอก" multiline />
                    </td>
                    <td className="py-2 px-3">
                      {t.problems.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          {t.problems.map((p, i) => (
                            <span key={i} className="whitespace-nowrap text-[12px] text-attention">
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5"/></svg>
                          ครบถ้วน
                        </span>
                      )}
                    </td>
                  </tr>
                  {carryOpen === t.key && pendingCarry(t).length > 0 && (
                    <tr className="bg-accent-soft border-b border-line">
                      <td></td>
                      <td colSpan={8} className="py-3 px-3">
                        <p className="text-xs font-semibold text-ink mb-2">ค่าจาก report ก่อนหน้าของ {t.key}</p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {pendingCarry(t).map(f => (
                            <div key={f} className="rounded-lg border border-line bg-surface p-2.5 text-xs">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-medium text-muted">{CARRY_LABEL[f]}</p>
                                  <p className="text-ink break-words line-clamp-3">{t.carryOver![f]!.value}</p>
                                  <p className="text-[10px] text-faint mt-0.5">จาก &quot;{t.carryOver![f]!.reportName}&quot;</p>
                                </div>
                                <button
                                  onClick={() => applyCarry(t.key, [f])}
                                  className="shrink-0 rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-accent hover:bg-indigo-50"
                                >
                                  ใช้ค่านี้
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-4">
                          <button onClick={() => { applyCarry(t.key); setCarryOpen(null) }} className="text-[11px] font-medium text-accent hover:underline">ใช้ทั้งหมดของใบนี้</button>
                          <button onClick={() => setCarryOpen(null)} className="text-[11px] text-muted hover:underline">ปิด</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                {!filteredTickets.length && (
                  <tr><td colSpan={9} className="py-10 text-center text-sm text-faint">ไม่พบข้อมูลที่ตรงกับตัวกรอง</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {saveState.state === 'error' && (
          <div className="rounded-lg border border-line bg-sunken px-5 py-3">
            <p className="text-sm text-danger">{saveState.message}</p>
          </div>
        )}

        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line-strong bg-surface px-4 py-3 shadow-lg">
          <p className="text-[14px] text-muted">
            จะบันทึก <strong className="num text-ink">{selected.size}</strong> จาก <span className="num">{tickets.length}</span> tickets เป็น report ใหม่
          </p>
          <button
            onClick={handleConfirm}
            disabled={saveState.state === 'saving' || selected.size === 0}
            aria-busy={saveState.state === 'saving'}
            className="btn-primary px-4 py-2 text-[14px]"
          >
            {saveState.state === 'saving' ? 'กำลังบันทึก...' : 'บันทึกเป็น report'}
          </button>
        </div>

      </main>
    </div>
  )
}

export default function ValidateScreen() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    }>
      <ValidateScreenInner />
    </Suspense>
  )
}
