'use client'

import Link from 'next/link'

interface Props {
  reportId: string
  totalTickets: number
  onReset: () => void
}

export default function UploadSuccess({ reportId, totalTickets, onReset }: Props) {
  return (
    <div className="rounded-lg border border-line bg-sunken px-6 py-8 text-center space-y-5">
      {/* Check icon */}
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ok-soft">
        <svg className="h-7 w-7 text-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div className="space-y-1">
        <p className="text-base font-semibold text-ok">อัปโหลดสำเร็จ</p>
        <p className="text-sm text-ok">{totalTickets} tickets พร้อมแสดงผล</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          href={`/dashboard/${reportId}`}
          className="btn-primary px-4 py-2"
        >
          ดู Dashboard
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
        <button
          onClick={onReset}
          className="inline-flex items-center justify-center rounded-lg border border-line-strong bg-surface px-5 py-2.5 text-sm font-medium text-ok hover:bg-green-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
        >
          อัปโหลดไฟล์ใหม่
        </button>
      </div>
    </div>
  )
}
