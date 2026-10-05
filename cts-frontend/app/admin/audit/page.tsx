'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import ThemeToggle from '@/components/theme/ThemeToggle'
import LogoutButton from '@/components/auth/LogoutButton'
import { getAuditLog, type AuditLogEntry, type AuditLogPage } from '@/lib/api'

const ACTIONS: Array<{ value: string; label: string; cls: string }> = [
  { value: 'ticket.update',      label: 'แก้ไข ticket',     cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { value: 'ticket.bulk_update', label: 'แก้ไขหลาย ticket', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  { value: 'ticket.comment',     label: 'Comment',          cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  { value: 'report.create',      label: 'สร้าง report',     cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  { value: 'report.delete',      label: 'ลบ report',        cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { value: 'user.update',        label: 'จัดการผู้ใช้',      cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
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
        <p key={field} className="text-slate-600 dark:text-slate-300 break-words">
          <span className="font-medium">{FIELD_LABEL[field] ?? field}:</span>{' '}
          <span className="text-red-500 line-through">{c.from || '(ว่าง)'}</span>{' → '}
          <span className="text-green-600 dark:text-green-400">{c.to || '(ว่าง)'}</span>
        </p>
      ))}
      {d.text && <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words"><span className="font-medium">ข้อความ:</span> {d.text}</p>}
      {d.warnings && d.warnings.length > 0 && d.warnings.map((w, i) => <p key={i} className="text-orange-600 dark:text-orange-400 break-words">⚠ {w}</p>)}
      {d.error && <p className="text-red-600 dark:text-red-400 break-words">⚠ {d.error}</p>}
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
            </Link>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">ประวัติการใช้งาน (Audit log)</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/users" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">จัดการผู้ใช้</Link>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-4">
        {!isChecking && !isAdmin ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
            <p className="text-slate-500 dark:text-slate-400">หน้านี้สำหรับ Admin เท่านั้น</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={action}
                onChange={e => { setAction(e.target.value); setPage(1) }}
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none"
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
                className="flex-1 min-w-[220px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500"
              />
              <button onClick={load} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">รีเฟรช</button>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-4 py-3">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">ถ้าเพิ่งอัปเดตระบบ ให้ตรวจว่ารัน <code>npx prisma db push</code> แล้ว</p>
              </div>
            )}

            {loading ? (
              <div className="space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />)}</div>
            ) : data && data.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
                <p className="text-slate-500 dark:text-slate-400">ยังไม่มีรายการ</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-slate-100 dark:divide-slate-700/50">
                {data?.items.map(it => {
                  const a = ACTION_BY_VALUE[it.action]
                  const hasDetails = !!it.details && (!!it.details.changes || !!it.details.text || !!it.details.warnings?.length || !!it.details.error)
                  const open = openId === it.id
                  return (
                    <div key={it.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="w-32 shrink-0 text-xs text-slate-400 tabular-nums">{fmt(it.createdAt)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${a?.cls ?? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{a?.label ?? it.action}</span>
                            {!it.success && <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">ไม่สำเร็จ/มีคำเตือน</span>}
                            <span className="text-sm text-slate-800 dark:text-slate-100 break-words">{it.summary}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            โดย <span className="font-medium text-slate-600 dark:text-slate-300">{it.userName}</span>
                            {it.userRole && <> ({it.userRole})</>}
                            {it.userEmail && <> · {it.userEmail}</>}
                          </p>
                          {hasDetails && (
                            <button onClick={() => setOpenId(open ? null : it.id)} className="mt-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline">
                              {open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด'}
                            </button>
                          )}
                          {open && it.details && <Details d={it.details} />}
                        </div>
                        {it.ticketKey && (
                          <a
                            href={`https://ascendcommerce-support.atlassian.net/browse/${it.ticketKey}`}
                            target="_blank" rel="noopener noreferrer"
                            className="shrink-0 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
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
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>ทั้งหมด {data.total} รายการ · หน้า {data.page}/{totalPages}</span>
                <div className="flex items-center gap-2">
                  <button disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ก่อนหน้า</button>
                  <button disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 font-medium disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ถัดไป</button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
