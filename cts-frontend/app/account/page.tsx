'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import { changePassword } from '@/lib/api'
import JiraConnectionCard from '@/components/auth/JiraConnectionCard'
import AppShell, { PageHeader } from '@/components/layout/AppShell'

const inputCls =
  'field py-2 text-[14px]   transition-colors'

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
  // message passed back by /account/jira-callback (?jira=...)
  const [jiraNotice, setJiraNotice] = useState<string | undefined>(undefined)
  const [noticeRead, setNoticeRead] = useState(false)
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('jira')
    if (n) {
      setJiraNotice(n)
      window.history.replaceState(null, '', window.location.pathname)
    }
    setNoticeRead(true)
  }, [])

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
    <AppShell width="narrow">
      <PageHeader title="บัญชีของฉัน" description="ข้อมูลบัญชี การเชื่อมบัญชี Jira และรหัสผ่าน" />
      <div className="space-y-6">
        <section className="panel panel-pad space-y-3">
          <h2 className="text-sm font-semibold text-ink">ข้อมูลบัญชี</h2>
          <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
            <dt className="text-faint">ชื่อ</dt><dd className="text-ink">{user?.name ?? '—'}</dd>
            <dt className="text-faint">อีเมล</dt><dd className="text-ink break-all">{user?.email ?? '—'}</dd>
            <dt className="text-faint">สิทธิ์</dt><dd className="text-ink">{user ? ROLE_LABEL[user.role] : '—'}</dd>
          </dl>
        </section>

        {noticeRead && <JiraConnectionCard notice={jiraNotice} />}

        <form onSubmit={handleSubmit} className="panel panel-pad space-y-4">
          <h2 className="text-sm font-semibold text-ink">เปลี่ยนรหัสผ่าน</h2>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">รหัสผ่านปัจจุบัน</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">รหัสผ่านใหม่</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={8} autoComplete="new-password" className={inputCls} placeholder="อย่างน้อย 8 ตัวอักษร" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">ยืนยันรหัสผ่านใหม่</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" className={inputCls} />
          </div>

          {error && <div className="rounded-lg bg-sunken border border-line px-3 py-2"><p className="text-xs text-danger">{error}</p></div>}
          {success && <div className="rounded-lg bg-sunken border border-line px-3 py-2"><p className="text-xs text-ok">{success}</p></div>}

          <button type="submit" disabled={saving} aria-busy={saving} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50 transition-colors">
            {saving ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </form>
      </div>
    </AppShell>
  )
}
