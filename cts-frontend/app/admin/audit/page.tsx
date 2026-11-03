'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import { getAuditLog, type AuditLogEntry, type AuditLogPage } from '@/lib/api'
import AppShell, { PageHeader } from '@/components/layout/AppShell'

// Neutral chips: only deleting gets a colour, so it stands out when scanning the log
const ACTIONS: Array<{ value: string; label: string; cls: string }> = [
  { value: 'ticket.update',        label: 'แก้ไข ticket',          cls: 'bg-sunken text-ink' },
  { value: 'ticket.bulk_update',   label: 'แก้ไขหลาย ticket',      cls: 'bg-sunken text-ink' },
  { value: 'ticket.comment',       label: 'Comment',               cls: 'bg-sunken text-ink' },
  { value: 'report.create',        label: 'สร้าง report',          cls: 'bg-sunken text-ink' },
  { value: 'report.refresh',       label: 'รีเฟรชจาก Jira',        cls: 'bg-sunken text-ink' },
  { value: 'report.delete',        label: 'ลบ report',             cls: 'bg-danger-soft text-danger' },
  { value: 'user.update',          label: 'จัดการผู้ใช้',           cls: 'bg-sunken text-ink' },
  { value: 'user.jira_connect',    label: 'เชื่อมบัญชี Jira',       cls: 'bg-sunken text-ink' },
  { value: 'user.jira_disconnect', label: 'ยกเลิกเชื่อมบัญชี Jira', cls: 'bg-sunken text-ink' },
]
const ACTION_BY_VALUE = Object.fromEntries(ACTIONS.map(a => [a.value, a]))

const FIELD_LABEL: Record<string, string> = {
  businessUnit: 'Business Unit', typeOfIssue: 'Type of Issue', status: 'Status',
  rootCause: 'Root Cause', resolution: 'Resolution', deployDate: 'Deploy Date',
  role: 'สิทธิ์', password: 'รหัสผ่าน',
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
  return m ?? fallback
}

function Details({ d }: { d: NonNullable<AuditLogEntry['details']> }) {
  const changes = d.changes ? Object.entries(d.changes) : []
  return (
    <div className="mt-2 space-y-1.5 text-xs">
      {changes.map(([field, c]) => (
        <p key={field} className="text-muted break-words">
          <span className="font-medium">{FIELD_LABEL[field] ?? field}:</span>{' '}
          <span className="text-danger line-through">{c.from || '(ว่าง)'}</span>{' → '}
          <span className="text-ok">{c.to || '(ว่าง)'}</span>
        </p>
      ))}
      {d.text && <p className="text-muted whitespace-pre-wrap break-words"><span className="font-medium">ข้อความ:</span> {d.text}</p>}
      {d.warnings && d.warnings.length > 0 && d.warnings.map((w, i) => <p key={i} className="text-attention break-words">⚠ {w}</p>)}
      {d.error && <p className="text-danger break-words">⚠ {d.error}</p>}
    </div>
  )
}

export default function AdminAuditPage() {
  const { isAdmin, isChecking } = useAuth()
  const [data, setData] = useState<AuditLogPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await getAuditLog({ page, action: action || undefined, q: q || undefined }))
    } catch (e) {
      setError(errMsg(e, 'โหลดประวัติไม่สำเร็จ'))
    } finally {
      setLoading(false)
    }
  }, [page, action, q])

  useEffect(() => {
    if (isChecking) return
    if (isAdmin) load()
    else setLoading(false)
  }, [isAdmin, isChecking, load])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <AppShell>
      <PageHeader title="ประวัติการใช้งาน" description="ใครทำอะไรในระบบ เมื่อไร รวมถึงการแก้ ticket ที่เขียนกลับเข้า Jira" />
      <div className="space-y-6">
        {!isChecking && !isAdmin ? (
          <div className="rounded-lg border border-dashed border-line-strong py-16 text-center">
            <p className="text-muted">หน้านี้สำหรับ Admin เท่านั้น</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={action}
                onChange={e => { setAction(e.target.value); setPage(1) }}
                className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink outline-none"
              >
                <option value="">ทุกประเภท</option>
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              <input
                type="text"
                value={qInput}
                onChange={e => setQInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { setQ(qInput.trim()); setPage(1) } }}
                placeholder="ค้นหา ticket key / ชื่อ / อีเมล แล้วกด Enter"
                className="flex-1 min-w-[220px] rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
              />
              <button onClick={load} disabled={loading} aria-busy={loading} className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-muted hover:bg-sunken transition-colors">รีเฟรช</button>
            </div>

            {error && (
              <div className="rounded-lg border border-line bg-sunken px-4 py-3">
                <p className="text-sm text-danger">{error}</p>
                <p className="mt-1 text-xs text-danger">ถ้าเพิ่งอัปเดตระบบ ให้ตรวจว่ารัน <code>npx prisma db push</code> แล้ว</p>
              </div>
            )}

            {loading ? (
              <div className="space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-sunken" />)}</div>
            ) : data && data.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line-strong py-16 text-center">
                <p className="text-muted">ยังไม่มีรายการ</p>
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-surface divide-y divide-line">
                {data?.items.map(it => {
                  const a = ACTION_BY_VALUE[it.action]
                  const hasDetails = !!it.details && (!!it.details.changes || !!it.details.text || !!it.details.warnings?.length || !!it.details.error)
                  const open = openId === it.id
                  return (
                    <div key={it.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="w-32 shrink-0 text-xs text-faint tabular-nums">{fmt(it.createdAt)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${a?.cls ?? 'bg-sunken text-muted'}`}>{a?.label ?? it.action}</span>
                            {!it.success && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">ไม่สำเร็จ/มีคำเตือน</span>}
                            <span className="text-sm text-ink break-words">{it.summary}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-faint">
                            โดย <span className="font-medium text-muted">{it.userName}</span>
                            {it.userRole && <> ({it.userRole})</>}
                            {it.userEmail && <>, {it.userEmail}</>}
                          </p>
                          {hasDetails && (
                            <button onClick={() => setOpenId(open ? null : it.id)} className="mt-1 text-[11px] font-medium text-accent hover:underline">
                              {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
                            </button>
                          )}
                          {open && it.details && <Details d={it.details} />}
                        </div>
                        {it.ticketKey && (
                          <a
                            href={`https://ascendcommerce-support.atlassian.net/browse/${it.ticketKey}`}
                            target="_blank" rel="noopener noreferrer"
                            className="shrink-0 text-xs font-medium text-accent hover:underline"
                          >
                            {it.ticketKey}
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {data && data.total > 0 && (
              <div className="flex items-center justify-between text-xs text-muted">
                <span>ทั้งหมด {data.total} รายการ หน้า {data.page} จาก {totalPages}</span>
                <div className="flex items-center gap-2">
                  <button disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-lg border border-line-strong px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-sunken transition-colors">ก่อนหน้า</button>
                  <button disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-line-strong px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-sunken transition-colors">ถัดไป</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
