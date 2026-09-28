'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import ThemeToggle from '@/components/theme/ThemeToggle'
import LogoutButton from '@/components/auth/LogoutButton'
import { listUsers, updateUser, type AppUser, type UserRole, type UserStatus } from '@/lib/api'

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'viewer', label: 'Viewer (ดูอย่างเดียว)' },
  { value: 'editor', label: 'Editor (sync/แก้ไข/comment)' },
  { value: 'admin', label: 'Admin' },
]

const STATUS_BADGE: Record<UserStatus, { label: string; cls: string }> = {
  pending:  { label: 'รออนุมัติ', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  active:   { label: 'ใช้งานอยู่', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  disabled: { label: 'ถูกระงับ',  cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
}

// 12 chars, no look-alike characters (0/O, 1/l/I)
function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

export default function AdminUsersPage() {
  const { user: me, isAdmin, isChecking } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // role chosen in the dropdown of a PENDING row, before pressing "อนุมัติ"
  const [pendingRole, setPendingRole] = useState<Record<string, UserRole>>({})
  const [resetFor, setResetFor] = useState<AppUser | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [resetError, setResetError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setUsers(await listUsers())
    } catch (e) {
      setError(errMsg(e, 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) load()
    else if (!isChecking) setLoading(false)
  }, [isAdmin, isChecking, load])

  const patch = async (u: AppUser, change: { role?: UserRole; status?: UserStatus }) => {
    setBusyId(u.id)
    setError('')
    try {
      const updated = await updateUser(u.id, change)
      setUsers(prev => prev.map(x => (x.id === u.id ? updated : x)))
    } catch (e) {
      setError(errMsg(e, 'บันทึกไม่สำเร็จ'))
    } finally {
      setBusyId(null)
    }
  }

  const submitReset = async () => {
    if (!resetFor) return
    setResetError('')
    setBusyId(resetFor.id)
    try {
      await updateUser(resetFor.id, { password: newPassword })
      setResetFor(null)
      setNewPassword('')
    } catch (e) {
      setResetError(errMsg(e, 'รีเซ็ตรหัสผ่านไม่สำเร็จ'))
    } finally {
      setBusyId(null)
    }
  }

  const pendingCount = users.filter(u => u.status === 'pending').length
  const selectCls =
    'rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 disabled:opacity-50'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
            </Link>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">จัดการผู้ใช้</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-5">
        {!isChecking && !isAdmin ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
            <p className="text-slate-500 dark:text-slate-400">หน้านี้สำหรับ Admin เท่านั้น</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                ผู้ใช้ทั้งหมด {!loading && <span className="text-sm font-normal text-slate-400">({users.length})</span>}
                {pendingCount > 0 && (
                  <span className="ml-2 rounded-full bg-orange-100 dark:bg-orange-900/40 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">
                    รออนุมัติ {pendingCount}
                  </span>
                )}
              </h1>
              <button onClick={load} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                รีเฟรช
              </button>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-4 py-3">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />)}</div>
            ) : (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                      <th className="text-left font-medium py-2.5 px-4">ผู้ใช้</th>
                      <th className="text-left font-medium py-2.5 px-3">สถานะ</th>
                      <th className="text-left font-medium py-2.5 px-3">สิทธิ์</th>
                      <th className="text-left font-medium py-2.5 px-3">สมัครเมื่อ</th>
                      <th className="text-left font-medium py-2.5 px-3">เข้าใช้ล่าสุด</th>
                      <th className="text-right font-medium py-2.5 px-4">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const isMe = u.id === me?.id
                      const busy = busyId === u.id
                      return (
                        <tr key={u.id} className={`border-b border-slate-100 dark:border-slate-700/50 ${u.status === 'pending' ? 'bg-orange-50/40 dark:bg-orange-950/10' : ''}`}>
                          <td className="py-3 px-4">
                            <p className="font-medium text-slate-800 dark:text-slate-100">{u.name}{isMe && <span className="ml-1.5 text-[11px] text-slate-400">(คุณ)</span>}</p>
                            <p className="text-xs text-slate-400 break-all">{u.email}</p>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_BADGE[u.status].cls}`}>{STATUS_BADGE[u.status].label}</span>
                          </td>
                          <td className="py-3 px-3">
                            {u.status === 'pending' ? (
                              <select
                                value={pendingRole[u.id] ?? u.role}
                                onChange={e => setPendingRole(p => ({ ...p, [u.id]: e.target.value as UserRole }))}
                                className={selectCls}
                              >
                                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            ) : (
                              <select
                                value={u.role}
                                disabled={busy || isMe}
                                title={isMe ? 'ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้' : undefined}
                                onChange={e => patch(u, { role: e.target.value as UserRole })}
                                className={selectCls}
                              >
                                {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmt(u.createdAt)}</td>
                          <td className="py-3 px-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">{fmt(u.lastLoginAt)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                              {u.status === 'pending' && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() => patch(u, { status: 'active', role: pendingRole[u.id] ?? u.role })}
                                    className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                                  >
                                    อนุมัติ
                                  </button>
                                  <button
                                    disabled={busy}
                                    onClick={() => { if (confirm(`ปฏิเสธคำขอของ ${u.email}?`)) patch(u, { status: 'disabled' }) }}
                                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                                  >
                                    ปฏิเสธ
                                  </button>
                                </>
                              )}
                              {u.status === 'active' && !isMe && (
                                <button
                                  disabled={busy}
                                  onClick={() => { if (confirm(`ระงับบัญชี ${u.email}? เขาจะถูกออกจากระบบทันที`)) patch(u, { status: 'disabled' }) }}
                                  className="rounded-lg border border-red-200 dark:border-red-900/50 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
                                >
                                  ระงับ
                                </button>
                              )}
                              {u.status === 'disabled' && (
                                <button
                                  disabled={busy}
                                  onClick={() => patch(u, { status: 'active' })}
                                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                                >
                                  เปิดใช้งานอีกครั้ง
                                </button>
                              )}
                              {u.status !== 'pending' && (
                                <button
                                  disabled={busy}
                                  onClick={() => { setResetFor(u); setNewPassword(generatePassword()); setResetError('') }}
                                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                                >
                                  รีเซ็ตรหัสผ่าน
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!users.length && (
                      <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">ยังไม่มีผู้ใช้</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setResetFor(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">รีเซ็ตรหัสผ่าน</h2>
              <p className="text-xs text-slate-400 mt-0.5 break-all">{resetFor.name} · {resetFor.email}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">รหัสผ่านใหม่ (ส่งให้ผู้ใช้ทางช่องทางที่ปลอดภัย)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 font-mono text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                />
                <button onClick={() => setNewPassword(generatePassword())} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  สุ่มใหม่
                </button>
              </div>
              <p className="text-[11px] text-slate-400">ผู้ใช้เปลี่ยนรหัสผ่านเองได้ที่หน้า &quot;บัญชีของฉัน&quot; หลังเข้าสู่ระบบ</p>
            </div>
            {resetError && <p className="text-xs text-red-600 dark:text-red-400">{resetError}</p>}
            <div className="flex items-center gap-2">
              <button onClick={submitReset} disabled={busyId === resetFor.id} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                ตั้งรหัสผ่านใหม่
              </button>
              <button onClick={() => setResetFor(null)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
