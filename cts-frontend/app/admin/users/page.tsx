'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import { listUsers, updateUser, type AppUser, type UserRole, type UserStatus } from '@/lib/api'
import AppShell, { PageHeader } from '@/components/layout/AppShell'

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'viewer', label: 'Viewer (ดูอย่างเดียว)' },
  { value: 'editor', label: 'Editor (sync/แก้ไข/comment)' },
  { value: 'admin', label: 'Admin' },
]

const STATUS_BADGE: Record<UserStatus, { label: string; cls: string }> = {
  pending:  { label: 'รออนุมัติ', cls: 'bg-attention-soft text-attention' },
  active:   { label: 'ใช้งานอยู่', cls: 'bg-ok-soft text-ok' },
  disabled: { label: 'ถูกระงับ',  cls: 'bg-sunken text-muted' },
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
    'rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent disabled:opacity-50'

  return (
    <AppShell>
      <PageHeader title="ผู้ใช้" description="อนุมัติบัญชีที่ขอเข้ามา กำหนดสิทธิ์ และระงับการใช้งาน" />
      <div className="space-y-6">
        {!isChecking && !isAdmin ? (
          <div className="rounded-lg border border-dashed border-line-strong py-16 text-center">
            <p className="text-muted">หน้านี้สำหรับ Admin เท่านั้น</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-lg font-semibold text-ink">
                ผู้ใช้ทั้งหมด {!loading && <span className="text-sm font-normal text-faint">({users.length})</span>}
                {pendingCount > 0 && (
                  <span className="ml-2 rounded-full bg-attention-soft px-2 py-0.5 text-xs font-medium text-attention">
                    รออนุมัติ {pendingCount}
                  </span>
                )}
              </h1>
              <button onClick={load} className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-muted hover:bg-sunken transition-colors">
                รีเฟรช
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-line bg-sunken px-4 py-3">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-sunken" />)}</div>
            ) : (
              <div className="rounded-lg border border-line bg-surface overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
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
                        <tr key={u.id} className={`border-b border-line ${u.status === 'pending' ? 'bg-orange-50/40' : ''}`}>
                          <td className="py-3 px-4">
                            <p className="font-medium text-ink">{u.name}{isMe && <span className="ml-1.5 text-[11px] text-faint">(คุณ)</span>}</p>
                            <p className="text-xs text-faint break-all">{u.email}</p>
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
                          <td className="py-3 px-3 text-xs text-muted whitespace-nowrap">{fmt(u.createdAt)}</td>
                          <td className="py-3 px-3 text-xs text-muted whitespace-nowrap">{fmt(u.lastLoginAt)}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                              {u.status === 'pending' && (
                                <>
                                  <button
                                    disabled={busy}
                                    onClick={() => patch(u, { status: 'active', role: pendingRole[u.id] ?? u.role })}
                                    className="btn-primary py-1"
                                  >
                                    อนุมัติ
                                  </button>
                                  <button
                                    disabled={busy}
                                    onClick={() => { if (confirm(`ปฏิเสธคำขอของ ${u.email}?`)) patch(u, { status: 'disabled' }) }}
                                    className="rounded-lg border border-line-strong px-3 py-1 text-xs font-medium text-muted hover:bg-sunken disabled:opacity-50 transition-colors"
                                  >
                                    ปฏิเสธ
                                  </button>
                                </>
                              )}
                              {u.status === 'active' && !isMe && (
                                <button
                                  disabled={busy}
                                  onClick={() => { if (confirm(`ระงับบัญชี ${u.email}? เขาจะถูกออกจากระบบทันที`)) patch(u, { status: 'disabled' }) }}
                                  className="rounded-lg border border-line px-3 py-1 text-xs font-medium text-danger hover:bg-danger-soft disabled:opacity-50 transition-colors"
                                >
                                  ระงับ
                                </button>
                              )}
                              {u.status === 'disabled' && (
                                <button
                                  disabled={busy}
                                  onClick={() => patch(u, { status: 'active' })}
                                  className="rounded-lg border border-line-strong px-3 py-1 text-xs font-medium text-muted hover:bg-sunken disabled:opacity-50 transition-colors"
                                >
                                  เปิดใช้งานอีกครั้ง
                                </button>
                              )}
                              {u.status !== 'pending' && (
                                <button
                                  disabled={busy}
                                  onClick={() => { setResetFor(u); setNewPassword(generatePassword()); setResetError('') }}
                                  className="rounded-lg border border-line-strong px-3 py-1 text-xs font-medium text-muted hover:bg-sunken disabled:opacity-50 transition-colors"
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
                      <tr><td colSpan={6} className="py-10 text-center text-sm text-faint">ยังไม่มีผู้ใช้</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setResetFor(null)}>
          <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="text-sm font-semibold text-ink">รีเซ็ตรหัสผ่าน</h2>
              <p className="text-xs text-faint mt-0.5 break-all">{resetFor.name}, {resetFor.email}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">รหัสผ่านใหม่ (ส่งให้ผู้ใช้ทางช่องทางที่ปลอดภัย)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
                />
                <button onClick={() => setNewPassword(generatePassword())} className="rounded-lg border border-line-strong px-3 text-xs font-medium text-muted hover:bg-sunken transition-colors">
                  สุ่มใหม่
                </button>
              </div>
              <p className="text-[11px] text-faint">ผู้ใช้เปลี่ยนรหัสผ่านเองได้ที่หน้า &quot;บัญชีของฉัน&quot; หลังเข้าสู่ระบบ</p>
            </div>
            {resetError && <p className="text-xs text-danger">{resetError}</p>}
            <div className="flex items-center gap-2">
              <button onClick={submitReset} disabled={busyId === resetFor.id} className="flex-1 rounded-lg bg-accent py-2 text-sm font-medium text-on-accent hover:bg-accent-strong disabled:opacity-50 transition-colors">
                ตั้งรหัสผ่านใหม่
              </button>
              <button onClick={() => setResetFor(null)} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-sunken transition-colors">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
