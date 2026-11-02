'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getReports, deleteReport } from '@/lib/api'
import AppShell, { PageHeader } from '@/components/layout/AppShell'
import BacklogPanel from '@/components/dashboard/BacklogPanel'
import { useAuth } from '@/components/auth/AuthContext'

interface Report {
  id: string
  name: string
  totalTickets: number
  createdAt: string
}

export default function HomePage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const { canEdit, isAdmin } = useAuth()

  const load = async () => {
    try {
      const data = await getReports()
      setReports(data)
    } catch {
      // fail silently
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('ลบ report นี้ออกจากระบบ?')) return
    setDeletingId(id)
    try {
      await deleteReport(id)
      setReports(prev => prev.filter(r => r.id !== id))
    } catch {
      alert('ลบไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = reports.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  )

  const latest = reports[0]
  const fmt = (d: string) => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  const fmtTime = (d: string) => new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

  return (
    <AppShell>
      <PageHeader
        title="Reports"
        description={canEdit
          ? 'แต่ละ report คือชุด ticket ที่ sync จาก Jira ในรอบนั้น ตรวจข้อมูลก่อนบันทึกทุกครั้ง'
          : 'คุณมีสิทธิ์ดูอย่างเดียว เปิด Dashboard ได้ทุก report ถ้าต้อง sync หรือแก้ไขข้อมูล ให้ขอสิทธิ์ Editor จากผู้ดูแลระบบ'}
        actions={canEdit && (
          <>
            <Link href="/upload" className="btn">นำเข้าจากไฟล์</Link>
            <Link href="/jira" className="btn-primary">Sync จาก Jira</Link>
          </>
        )}
      />

      {latest && !search && (
        <Link
          href={`/dashboard/${latest.id}`}
          className="panel mb-8 flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition-colors hover:border-line-strong"
        >
          <div className="min-w-0">
            <p className="text-[13px] text-muted">report ล่าสุด</p>
            <p className="truncate text-[18px] font-semibold">{latest.name}</p>
            <p className="text-[13px] text-muted num">{latest.totalTickets.toLocaleString()} tickets, sync เมื่อ {fmt(latest.createdAt)} {fmtTime(latest.createdAt)}</p>
          </div>
          <span className="btn">เปิด Dashboard</span>
        </Link>
      )}

      {!search && <BacklogPanel />}

      <section aria-labelledby="all-reports">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="all-reports" className="section-title">
            ทั้งหมด {!loading && <span className="font-normal text-muted num">({reports.length})</span>}
          </h2>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ report"
            aria-label="ค้นหาชื่อ report"
            className="field w-64"
          />
        </div>

        {loading ? (
          <div className="panel divide-y divide-line">
            {[1, 2, 3, 4].map(i => <div key={i} className="animate-pulse px-4 py-3.5"><div className="h-4 w-1/3 rounded bg-sunken" /></div>)}
          </div>
        ) : !filtered.length ? (
          <div className="panel px-6 py-14 text-center">
            <p className="text-[14px] text-muted">
              {search ? 'ไม่มี report ที่ชื่อตรงกับคำค้นนี้' : 'ยังไม่มี report — เริ่มจาก sync ข้อมูลจาก Jira'}
            </p>
            {!search && canEdit && <Link href="/jira" className="btn-primary mt-4">Sync จาก Jira</Link>}
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line bg-sunken text-left text-[12px] text-muted">
                  <th className="px-4 py-2 font-medium">ชื่อ report</th>
                  <th className="px-4 py-2 text-right font-medium">Tickets</th>
                  <th className="px-4 py-2 font-medium">sync เมื่อ</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} className="border-b border-line last:border-b-0 transition-colors hover:bg-sunken">
                    <td className="max-w-[420px] px-4 py-2.5">
                      <Link href={`/dashboard/${r.id}`} className="block truncate font-medium text-ink hover:text-accent">{r.name}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-right num">{r.totalTickets.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted num">{fmt(r.createdAt)} {fmtTime(r.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <Link href={`/dashboard/${r.id}`} className="btn-quiet">เปิด</Link>
                      {isAdmin && (
                        <button
                          onClick={() => handleDelete(r.id)}
                          disabled={deletingId === r.id}
                          aria-label={`ลบ ${r.name}`}
                          className="btn-quiet hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                        >
                          {deletingId === r.id ? 'กำลังลบ...' : 'ลบ'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  )
}
