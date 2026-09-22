'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getReports, deleteReport } from '@/lib/api'

interface Report {
  id: string
  name: string
  totalTickets: number
  createdAt: string
}

export default function RecentReports() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = async () => {
    try {
      const data = await getReports()
      setReports(data)
    } catch {
      // fail silently — recent reports are non-critical
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
      setReports((prev) => prev.filter((r) => r.id !== id))
    } catch {
      alert('ลบไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    )
  }

  if (!reports.length) {
    return (
      <p className="py-4 text-center text-sm text-slate-400">
        ยังไม่มี report ที่ผ่านมา
      </p>
    )
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden">
      {reports.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
          {/* Icon */}
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
            <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-700">{r.name}</p>
            <p className="text-xs text-slate-400">
              {r.totalTickets} tickets ·{' '}
              {new Date(r.createdAt).toLocaleDateString('th-TH', {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <Link
              href={`/dashboard/${r.id}`}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              ดู
            </Link>
            <button
              onClick={() => handleDelete(r.id)}
              disabled={deletingId === r.id}
              aria-label={`ลบ ${r.name}`}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              {deletingId === r.id ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              )}
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
