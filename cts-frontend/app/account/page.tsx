'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import ThemeToggle from '@/components/theme/ThemeToggle'
import LogoutButton from '@/components/auth/LogoutButton'
import { changePassword } from '@/lib/api'

const inputCls =
  'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 transition-colors'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin — จัดการได้ทุกอย่าง',
  editor: 'Editor — sync / แก้ไข ticket / comment ได้',
  viewer: 'Viewer — ดูข้อมูลอย่างเดียว',
}

export default function AccountPage() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (next.length < 8) return setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร')
    if (new TextEncoder().encode(next).length > 72) return setError('รหัสผ่านใหม่ยาวเกินไป (ไม่เกิน 72 ไบต์)')
    if (next !== confirm) return setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน')

    setSaving(true)
    try {
      await changePassword(current, next)
      setSuccess('เปลี่ยนรหัสผ่านสำเร็จ')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
            </Link>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">บัญชีของฉัน</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 sm:px-6 py-8 space-y-6">
        <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">ข้อมูลบัญชี</h2>
          <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
            <dt className="text-slate-400">ชื่อ</dt><dd className="text-slate-800 dark:text-slate-100">{user?.name ?? '—'}</dd>
            <dt className="text-slate-400">อีเมล</dt><dd className="text-slate-800 dark:text-slate-100 break-all">{user?.email ?? '—'}</dd>
            <dt className="text-slate-400">สิทธิ์</dt><dd className="text-slate-800 dark:text-slate-100">{user ? ROLE_LABEL[user.role] : '—'}</dd>
          </dl>
        </section>

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">เปลี่ยนรหัสผ่าน</h2>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">รหัสผ่านปัจจุบัน</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">รหัสผ่านใหม่</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={8} autoComplete="new-password" className={inputCls} placeholder="อย่างน้อย 8 ตัวอักษร" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">ยืนยันรหัสผ่านใหม่</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" className={inputCls} />
          </div>

          {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 px-3 py-2"><p className="text-xs text-red-600 dark:text-red-400">{error}</p></div>}
          {success && <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900/50 px-3 py-2"><p className="text-xs text-green-700 dark:text-green-400">{success}</p></div>}

          <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </form>
      </main>
    </div>
  )
}
