'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getReports, deleteReport } from '@/lib/api'
import { useAuth } from '@/components/auth/AuthContext'
import AppShell, { PageHeader } from '@/components/layout/AppShell'

interface Report { id: string; name: string; totalTickets: number; createdAt: string }

export default function HistoryPage() {
  const [reports, setReports] = useState<Report[]>([])
  const { isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    getReports().then(setReports).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('ลบ report นี้?')) return
    setDeletingId(id)
    try { await deleteReport(id); setReports(p => p.filter(r => r.id !== id)) }
    catch { alert('ลบไม่สำเร็จ') }
    finally { setDeletingId(null) }
  }

  return (
    <AppShell width="narrow">
      <PageHeader title="ประวัติ report" description="report ทั้งหมดที่เคยสร้าง" />
      <div className="space-y-6">
        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-16 rounded-lg bg-sunken animate-pulse"/>)}</div>
        ) : !reports.length ? (
          <div className="text-center py-16">
            <p className="text-faint mb-4">ยังไม่มี report</p>
            <Link href="/" className="text-sm text-accent hover:underline">อัปโหลดไฟล์แรก</Link>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface overflow-hidden">
            {reports.map(r => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-4 hover:bg-sunken transition-colors">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft">
                  <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                  <p className="text-xs text-faint">{r.totalTickets} tickets · {new Date(r.createdAt).toLocaleDateString('th-TH', {day:'numeric',month:'short',year:'numeric'})}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/dashboard/${r.id}`} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-strong transition-colors">ดู Dashboard</Link>
                  {isAdmin && (
                  <button onClick={() => handleDelete(r.id)} disabled={deletingId === r.id} aria-busy={deletingId === r.id}
                    className="rounded-lg border border-line p-1.5 text-faint hover:bg-danger-soft hover:text-danger transition-colors disabled:opacity-40">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
                  </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
