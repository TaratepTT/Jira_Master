'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  updateTicket, getTicketTransitions, getTicketCustomFields,
  type TransitionRequirement, type ExtraFieldMeta, type ExtraFieldInput, type TicketUpdateInput, type JiraIdentity,
} from '@/lib/api'
import { useAuth } from '@/components/auth/AuthContext'
import TicketActivityPanel from './TicketActivityPanel'
import type { TicketDetail } from './types'
import { TYPE_OF_ISSUE_OPTIONS, formatDate, jiraBrowseUrl, missingFields, statusBadge, toDateInput } from './utils'

// Prev/next through a list of tickets (the filtered table, or the "ข้อมูลยังไม่ครบ" queue)
export interface TicketNav {
  index: number   // 0-based position of this ticket in the list
  total: number
  label?: string  // e.g. "คิวข้อมูลยังไม่ครบ"
  onPrev?: () => void
  onNext?: () => void
}

// Draft value of one extra dropdown field while editing
interface ExtraDraft { id: string; childId: string; ids: string[]; text: string }
function draftFromMeta(f: ExtraFieldMeta): ExtraDraft {
  return { id: f.current.id ?? '', childId: f.current.childId ?? '', ids: f.current.ids ?? [], text: f.current.text ?? '' }
}
// null = unchanged; otherwise the value to send (null inside = clear the field)
function extraChange(f: ExtraFieldMeta, d: ExtraDraft): { send: ExtraFieldInput } | null {
  if (f.kind === 'text') {
    if (d.text.trim() === (f.current.text ?? '').trim()) return null
    return { send: d.text.trim() ? { text: d.text.trim() } : null }
  }
  if (f.kind === 'multi-option') {
    const cur = [...(f.current.ids ?? [])].sort().join(',')
    const now = [...d.ids].sort().join(',')
    if (cur === now) return null
    return { send: d.ids.length ? { ids: d.ids } : null }
  }
  const curId = f.current.id ?? ''
  const curChild = f.current.childId ?? ''
  if (d.id === curId && (f.kind !== 'option-with-child' || d.childId === curChild)) return null
  if (!d.id) return { send: null }
  return { send: f.kind === 'option-with-child' && d.childId ? { id: d.id, childId: d.childId } : { id: d.id } }
}

export default function TicketDetailModal({
  ticket, reportId, onClose, onUpdated, nav, autoEdit = false,
}: {
  ticket: TicketDetail
  reportId: string
  onClose: () => void
  onUpdated: (updated: TicketDetail) => void
  nav?: TicketNav
  /** open straight in edit mode (used by the fill-in queue) */
  autoEdit?: boolean
}) {
  const { canEdit } = useAuth()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  // Statuses Jira allows right now (null = not loaded yet)
  const [allowedStatuses, setAllowedStatuses] = useState<string[] | null>(null)
  const [statusNote, setStatusNote] = useState('')
  const [transitionDetails, setTransitionDetails] = useState<Record<string, TransitionRequirement>>({})
  // status -> ordered steps the app runs as a queue (e.g. Closed: Resolved → CLOSING → Closed)
  const [queuedPaths, setQueuedPaths] = useState<Record<string, string[]>>({})
  // The requirements (Resolution picker, extra fields) belong to the FIRST step of a queue
  const reqKey = (st: string) => queuedPaths[st]?.[0] ?? st
  const [transitionResolution, setTransitionResolution] = useState('')
  // Status in Jira right now (the report is a snapshot and may be older). null = unknown / not loaded
  const [liveStatus, setLiveStatus] = useState<string | null>(null)
  const currentStatus = liveStatus ?? ticket.status
  // Whose Jira account the save will use (from the backend)
  const [identity, setIdentity] = useState<JiraIdentity | null>(null)
  const [savedNote, setSavedNote] = useState('')

  // Action Card / Type / Task Type — loaded from Jira (options + current values), editors only
  const [extra, setExtra] = useState<ExtraFieldMeta[] | null>(null)
  const [extraDraft, setExtraDraft] = useState<Record<string, ExtraDraft>>({})
  const [extraMissing, setExtraMissing] = useState<string[]>([])
  const [extraError, setExtraError] = useState('')
  const loadExtra = useCallback(() => {
    if (!canEdit) return
    getTicketCustomFields(reportId, ticket.key)
      .then(r => {
        setExtra(r.fields)
        setExtraMissing(r.missing)
        setExtraError(r.error ?? '')
        setExtraDraft(Object.fromEntries(r.fields.map(f => [f.id, draftFromMeta(f)])))
      })
      .catch(() => { setExtra([]); setExtraError('ดึงข้อมูล Action Card / Type / Task Type จาก Jira ไม่สำเร็จ') })
  }, [canEdit, reportId, ticket.key])
  useEffect(() => { loadExtra() }, [loadExtra])

  const [draft, setDraft] = useState({
    businessUnit: ticket.businessUnit || '',
    typeOfIssue:  ticket.typeOfIssue || '',
    status:       ticket.status || '',
    rootCause:    ticket.rootCause || '',
    resolution:   ticket.resolution || '',
    deployDate:   toDateInput(ticket.deployDate),
  })

  const startEdit = () => {
    setDraft({
      businessUnit: ticket.businessUnit || '',
      typeOfIssue:  ticket.typeOfIssue || '',
      status:       ticket.status || '',
      rootCause:    ticket.rootCause || '',
      resolution:   ticket.resolution || '',
      deployDate:   toDateInput(ticket.deployDate),
    })
    setError('')
    setWarnings([])
    setAllowedStatuses(null)
    setStatusNote('')
    setTransitionDetails({})
    setQueuedPaths({})
    setTransitionResolution('')
    if (extra) setExtraDraft(Object.fromEntries(extra.map(f => [f.id, draftFromMeta(f)])))
    setEditing(true)
    setSavedNote('')
    getTicketTransitions(reportId, ticket.key)
      .then(t => {
        const live = t.live || null
        setLiveStatus(live)
        // the user has not touched Status yet -> start from the live status
        if (live) setDraft(d => (d.status === (ticket.status || '') ? { ...d, status: live } : d))
        setIdentity({ jiraAs: t.jiraAs, jiraUser: t.jiraUser, jiraNotice: t.jiraNotice })
        setAllowedStatuses(t.allowed)
        setTransitionDetails(t.details ?? {})
        setQueuedPaths(t.queued ?? {})
        if (t.error) setStatusNote(t.error)
        else if (t.allowed.length === 0) setStatusNote('ไม่มีสถานะอื่นที่ Jira อนุญาตให้เปลี่ยนจากสถานะนี้ (workflow หรือสิทธิ์ของบัญชี)')
      })
      .catch(() => {
        setAllowedStatuses([])
        setStatusNote('ดึงรายการสถานะที่เปลี่ยนได้ไม่สำเร็จ — เปลี่ยนสถานะไม่ได้ในตอนนี้')
      })
  }

  const handleSave = async (andNext = false) => {
    setSaving(true)
    setError('')
    setWarnings([])
    setSavedNote('')
    try {
      const changed: Record<string, string> = {}
      if (draft.businessUnit !== (ticket.businessUnit || '')) changed.businessUnit = draft.businessUnit
      if (draft.typeOfIssue  !== (ticket.typeOfIssue || ''))  changed.typeOfIssue  = draft.typeOfIssue
      if (draft.status       !== (currentStatus || ''))       changed.status       = draft.status
      if (draft.rootCause    !== (ticket.rootCause || ''))    changed.rootCause    = draft.rootCause
      if (draft.resolution   !== (ticket.resolution || ''))   changed.resolution   = draft.resolution
      if (draft.deployDate   !== toDateInput(ticket.deployDate)) changed.deployDate = draft.deployDate // '' = clear in Jira

      const customChanged: Record<string, ExtraFieldInput> = {}
      for (const f of extra ?? []) {
        const c = extraChange(f, extraDraft[f.id] ?? draftFromMeta(f))
        if (c) customChanged[f.id] = c.send
      }

      if (Object.keys(changed).length === 0 && Object.keys(customChanged).length === 0) {
        setEditing(false)
        setSaving(false)
        if (andNext && nav?.onNext) nav.onNext()
        return
      }

      const statusReq = changed.status ? transitionDetails[reqKey(changed.status)] : undefined
      const payload: TicketUpdateInput = { ...changed }
      if (Object.keys(customChanged).length > 0) payload.customFields = customChanged
      if (statusReq?.resolutionOptions?.length) {
        payload.transitionResolution = transitionResolution || statusReq.resolutionDefault || statusReq.resolutionOptions[0]
      }
      const result = await updateTicket(reportId, ticket.key, payload)
      const merged: TicketDetail = { ...ticket, ...result.ticket } as TicketDetail
      if (result.warnings.length > 0) setWarnings(result.warnings)
      if (result.jiraNotice) setWarnings(w => [...w, result.jiraNotice!])
      if (Object.keys(customChanged).length > 0) loadExtra() // refresh "current" values from Jira
      setEditing(false)
      if (result.jiraAs === 'user' && result.jiraUser) setSavedNote(`บันทึกลง Jira ในชื่อ ${result.jiraUser} แล้ว`)
      else setSavedNote('บันทึกลง Jira แล้ว')
      onUpdated(merged)
      // Move on only when everything went through — otherwise stay so the warning can be read
      if (andNext && nav?.onNext && result.warnings.length === 0) nav.onNext()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'บันทึกไม่สำเร็จ'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  // Fill-in queue: open the next ticket directly in edit mode
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoEdit && canEdit && !autoStarted.current) {
      autoStarted.current = true
      startEdit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit, canEdit])

  // Keyboard: ← / → previous/next ticket, Esc close (or leave edit mode), Ctrl/⌘+Enter save
  const keyState = useRef({ editing, saving, nav, onClose })
  keyState.current = { editing, saving, nav, onClose }
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = keyState.current
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (st.editing) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !st.saving) { e.preventDefault(); void saveRef.current(!!st.nav?.onNext) }
        else if (e.key === 'Escape' && !st.saving) { e.preventDefault(); setEditing(false) }
        return
      }
      if (typing) return
      if (e.key === 'Escape') { e.preventDefault(); st.onClose() }
      else if (e.key === 'ArrowLeft' && st.nav?.onPrev) { e.preventDefault(); st.nav.onPrev() }
      else if (e.key === 'ArrowRight' && st.nav?.onNext) { e.preventDefault(); st.nav.onNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const missing = missingFields(ticket)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-line bg-surface p-6 shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <p className="text-xs text-faint">
              Ticket
              {nav && nav.total > 1 && (
                <span className="ml-2 font-medium text-muted">
                  {nav.label ? `${nav.label} · ` : ''}{nav.index + 1} / {nav.total}
                </span>
              )}
            </p>
            <a
              href={jiraBrowseUrl(ticket.key)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lg font-semibold text-accent hover:underline inline-flex items-center gap-1"
            >
              {ticket.key}
              <svg className="h-3.5 w-3.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
            {missing.length > 0 && (
              <p className="mt-1 text-[11px] text-attention">ยังไม่กรอก: {missing.join(', ')}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {nav && nav.total > 1 && (
              <div className="flex items-center rounded-lg border border-line-strong overflow-hidden">
                <button
                  onClick={nav.onPrev}
                  disabled={!nav.onPrev || saving}
                  title="ใบก่อนหน้า (←)"
                  className="px-2 py-1 text-muted hover:bg-sunken disabled:opacity-30 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                </button>
                <button
                  onClick={nav.onNext}
                  disabled={!nav.onNext || saving}
                  title="ใบถัดไป (→)"
                  className="px-2 py-1 border-l border-line-strong text-muted hover:bg-sunken disabled:opacity-30 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
              </div>
            )}
            {!editing && canEdit && (
              <button
                onClick={startEdit}
                className="flex items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-muted hover:bg-sunken transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
                แก้ไข
              </button>
            )}
            <button onClick={onClose} className="text-faint hover:text-ink">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-4 text-sm">
          {ticket.summary && (
            <div>
              <p className="text-xs font-medium text-faint mb-1">Summary</p>
              <p className="text-ink">{ticket.summary}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-faint mb-1">Status</p>
              {editing ? (
                <>
                  <select
                    value={draft.status}
                    onChange={e => {
                      const st = e.target.value
                      setDraft(d => ({ ...d, status: st }))
                      setTransitionResolution(transitionDetails[reqKey(st)]?.resolutionDefault ?? '')
                    }}
                    disabled={allowedStatuses === null}
                    className="field disabled:opacity-60"
                  >
                    {[currentStatus, ...(allowedStatuses ?? []).filter(x => x !== currentStatus)].map(st => (
                      <option key={st} value={st}>{st === currentStatus ? `${st} (ปัจจุบันใน Jira)` : st}</option>
                    ))}
                    {Object.keys(queuedPaths)
                      .filter(st => st !== currentStatus && !(allowedStatuses ?? []).includes(st))
                      .map(st => (
                        <option key={st} value={st}>{`${st} (ผ่านคิว ${queuedPaths[st].length} ขั้น)`}</option>
                      ))}
                  </select>
                  {allowedStatuses === null && <p className="mt-1 text-[11px] text-faint">กำลังดึงสถานะที่เปลี่ยนได้จาก Jira...</p>}
                  {statusNote && <p className="mt-1 text-[11px] text-attention">{statusNote}</p>}
                  {liveStatus && liveStatus !== ticket.status && (
                    <p className="mt-1 text-[11px] text-accent">
                      ใน Jira ตอนนี้เป็น &quot;{liveStatus}&quot; (report นี้บันทึกไว้ว่า &quot;{ticket.status}&quot;) — กด &quot;รีเฟรชจาก Jira&quot; ด้านบนเพื่ออัปเดตทั้ง report
                    </p>
                  )}
                  {queuedPaths[draft.status] && draft.status !== currentStatus && (
                    <div className="mt-2 rounded-lg border border-line bg-accent-soft px-2.5 py-2">
                      <p className="text-[11px] font-medium text-accent">
                        ระบบจะเปลี่ยนสถานะต่อเนื่องตามคิว: {[currentStatus, ...queuedPaths[draft.status]].join(' → ')}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        แต่ละขั้นเขียนลง Jira จริงตามลำดับ ถ้าขั้นใดไม่ผ่าน (เช่น บัญชีไม่มีสิทธิ์) คิวจะหยุดที่ขั้นนั้นและ Dashboard จะแสดงสถานะที่ไปถึงจริง
                      </p>
                    </div>
                  )}
                  {draft.status !== currentStatus && transitionDetails[reqKey(draft.status)]?.resolutionOptions && (
                    <div className="mt-2">
                      <p className="text-[11px] font-medium text-faint mb-1">Resolution ที่ Jira ต้องการสำหรับสถานะนี้</p>
                      <select
                        value={transitionResolution || transitionDetails[reqKey(draft.status)].resolutionDefault || ''}
                        onChange={e => setTransitionResolution(e.target.value)}
                        className="field"
                      >
                        {transitionDetails[reqKey(draft.status)].resolutionOptions!.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                  {draft.status !== currentStatus && transitionDetails[reqKey(draft.status)]?.needs && (
                    <p className="mt-1.5 text-[11px] text-attention">
                      Jira ต้องการข้อมูลเพิ่มสำหรับสถานะนี้: {transitionDetails[reqKey(draft.status)].needs!.join(', ')} — ถ้าบันทึกไม่ผ่าน ให้กรอกใน Jira โดยตรง
                    </p>
                  )}
                </>
              ) : (
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(ticket.status)}`}>
                  {ticket.status}
                </span>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-faint mb-1">System</p>
              <p className="text-ink">{ticket.system}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-faint mb-1">Business Unit</p>
              {editing ? (
                <input
                  type="text"
                  value={draft.businessUnit}
                  onChange={e => setDraft(d => ({ ...d, businessUnit: e.target.value }))}
                  className="field"
                />
              ) : (
                <p className="text-ink">{ticket.businessUnit || '—'}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-faint mb-1">Type of Issue</p>
              {editing ? (
                <select
                  value={draft.typeOfIssue}
                  onChange={e => setDraft(d => ({ ...d, typeOfIssue: e.target.value }))}
                  className="field"
                >
                  {TYPE_OF_ISSUE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <p className="text-ink">{ticket.typeOfIssue || '—'}</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-faint mb-1">Deploy Date</p>
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={draft.deployDate}
                    onChange={e => setDraft(d => ({ ...d, deployDate: e.target.value }))}
                    className="field min-w-0 flex-1"
                  />
                  {draft.deployDate && (
                    <button
                      type="button"
                      onClick={() => setDraft(d => ({ ...d, deployDate: '' }))}
                      className="shrink-0 rounded-lg border border-line-strong px-2 py-1.5 text-xs text-muted hover:bg-sunken transition-colors"
                      title="ล้างวันที่ deploy"
                    >
                      ล้าง
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-ink">
                  {ticket.deployDate
                    ? <span className="inline-flex items-center gap-1 text-accent font-medium">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {formatDate(ticket.deployDate)}
                      </span>
                    : <span className="text-faint">ยังไม่ deploy</span>}
                </p>
              )}
            </div>
          </div>

          {canEdit && (extra === null || extra.length > 0 || extraMissing.length > 0 || extraError) && (
            <div className="rounded-lg border border-line p-3 space-y-3">
              <p className="text-xs font-semibold text-muted">ข้อมูลใน Jira ที่บาง workflow บังคับให้กรอกก่อนเปลี่ยนสถานะ</p>
              {extra === null && <div className="h-10 animate-pulse rounded-lg bg-sunken" />}
              {extraError && <p className="text-[11px] text-attention">{extraError}</p>}
              <div className="grid grid-cols-2 gap-3">
                {(extra ?? []).map(f => {
                  const d = extraDraft[f.id] ?? draftFromMeta(f)
                  const setD = (patch: Partial<ExtraDraft>) => setExtraDraft(prev => ({ ...prev, [f.id]: { ...(prev[f.id] ?? draftFromMeta(f)), ...patch } }))
                  const selCls = 'field'
                  const parent = f.options.find(o => o.id === d.id)
                  return (
                    <div key={f.id} className={f.kind === 'multi-option' ? 'col-span-2' : ''}>
                      <p className="text-xs font-medium text-faint mb-1">{f.name}{f.required && <span className="text-danger"> *</span>}</p>
                      {!editing ? (
                        f.currentLabel
                          ? <p className="text-sm text-ink">{f.currentLabel}</p>
                          : <p className="text-sm text-attention">ยังไม่ได้ระบุ</p>
                      ) : f.kind === 'text' ? (
                        <input
                          type="text"
                          value={d.text}
                          maxLength={255}
                          onChange={e => setD({ text: e.target.value })}
                          className={selCls}
                        />
                      ) : f.kind === 'multi-option' ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {f.options.map(o => (
                            <label key={o.id} className="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
                              <input
                                type="checkbox"
                                checked={d.ids.includes(o.id)}
                                onChange={e => setD({ ids: e.target.checked ? [...d.ids, o.id] : d.ids.filter(x => x !== o.id) })}
                                className="h-3.5 w-3.5 rounded border-line-strong"
                              />
                              {o.value}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <select value={d.id} onChange={e => setD({ id: e.target.value, childId: '' })} className={selCls}>
                            <option value="">— ไม่ระบุ —</option>
                            {f.options.map(o => <option key={o.id} value={o.id}>{o.value}</option>)}
                          </select>
                          {f.kind === 'option-with-child' && parent?.children && parent.children.length > 0 && (
                            <select value={d.childId} onChange={e => setD({ childId: e.target.value })} className={selCls}>
                              <option value="">— ไม่ระบุ —</option>
                              {parent.children.map(c => <option key={c.id} value={c.id}>{c.value}</option>)}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {extraMissing.length > 0 && (
                <p className="text-[11px] text-faint">ไม่พบ field ในหน้าแก้ไขของ Jira (หรือไม่รองรับชนิดนี้): {extraMissing.join(', ')}</p>
              )}
            </div>
          )}

          {([
            ['rootCause', 'Root Cause', 'สาเหตุของปัญหา'],
            ['resolution', 'Resolution', 'แก้ไขอย่างไร'],
          ] as const).map(([field, label, hint]) => (
            <div key={field} className="border-t border-line pt-4">
              <label htmlFor={`f-${field}`} className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold text-ink">
                {label}
                {editing && <span className="text-[12px] font-normal text-faint">{hint}</span>}
              </label>
              {editing ? (
                <textarea
                  id={`f-${field}`}
                  value={draft[field]}
                  onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
                  rows={4}
                  className="field resize-y leading-relaxed"
                />
              ) : (
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">
                  {ticket[field] || <span className="text-attention">ยังไม่ได้กรอก</span>}
                </p>
              )}
            </div>
          ))}

          <TicketActivityPanel reportId={reportId} ticketKey={ticket.key} />

          {error && (
            <div className="rounded-lg bg-sunken border border-line px-3 py-2">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="rounded-lg bg-attention-soft border border-line px-3 py-2 space-y-1">
              {warnings.map((w, i) => (
                <p key={i} className="text-xs text-attention whitespace-pre-line break-words">{w}</p>
              ))}
            </div>
          )}

          {savedNote && !editing && warnings.length === 0 && (
            <p className="text-xs text-ok">✓ {savedNote}</p>
          )}

          {editing && identity && (
            <p className="text-[11px] text-faint">
              {identity.jiraAs === 'user' && identity.jiraUser
                ? <>จะบันทึกลง Jira ในชื่อ <strong className="text-muted">{identity.jiraUser}</strong> (บัญชี Jira ของคุณ)</>
                : <>จะบันทึกลง Jira ด้วยบัญชีกลางของระบบ — เชื่อมบัญชี Jira ของคุณเองได้ที่หน้า &quot;บัญชีของฉัน&quot;</>}
              {identity.jiraNotice && <span className="block text-attention">{identity.jiraNotice}</span>}
            </p>
          )}

          {editing && (
            <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-6 py-3">
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="btn-primary py-2"
              >
                {saving ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    กำลังบันทึกลง Jira...
                  </>
                ) : 'บันทึกลง Jira'}
              </button>
              {nav?.onNext && (
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  title="Ctrl/⌘ + Enter"
                  className="btn py-2"
                >
                  บันทึกแล้วไปใบถัดไป
                </button>
              )}
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="btn-quiet ml-auto"
              >
                ยกเลิก
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}