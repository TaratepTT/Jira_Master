'use client'

import { useRef, useState, useCallback, DragEvent, ChangeEvent } from 'react'
import type { UploadStatus } from '@/types/ticket'

interface Props {
  onStatusChange: (s: UploadStatus) => void
  status: UploadStatus
}

const ACCEPTED = ['.csv', '.xlsx', '.xls']
const ACCEPT_MIME =
  'text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

export default function UploadZone({ onStatusChange, status }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isDragging = status.state === 'dragging'

  const validate = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED.includes(ext)) return `ไฟล์ ${ext} ไม่รองรับ — ใช้ .csv, .xlsx หรือ .xls`
    if (file.size > 20 * 1024 * 1024) return 'ไฟล์ใหญ่เกิน 20 MB'
    return null
  }

  const handle = useCallback(
    (file: File) => {
      const err = validate(file)
      if (err) { onStatusChange({ state: 'error', message: err }); return }
      onStatusChange({ state: 'parsing', fileName: file.name })
    },
    [onStatusChange]
  )

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (status.state === 'idle' || status.state === 'error')
      onStatusChange({ state: 'dragging' })
  }
  const onDragLeave = () => {
    if (status.state === 'dragging') onStatusChange({ state: 'idle' })
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handle(file)
    else onStatusChange({ state: 'idle' })
  }
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handle(file)
    e.target.value = ''
  }

  const isActive = ['idle', 'dragging', 'error'].includes(status.state)

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => isActive && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && isActive && inputRef.current?.click()}
      aria-label="อัปโหลดไฟล์ CSV หรือ Excel"
      className={[
        'relative flex flex-col items-center justify-center gap-4',
        'rounded-2xl border-2 border-dashed px-8 py-16 text-center',
        'transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        isActive ? 'cursor-pointer' : 'cursor-default',
        isDragging
          ? 'border-blue-500 bg-blue-50'
          : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_MIME}
        className="sr-only"
        onChange={onChange}
        tabIndex={-1}
      />

      {/* Icon */}
      <div
        className={[
          'flex h-16 w-16 items-center justify-center rounded-2xl',
          isDragging ? 'bg-blue-100' : 'bg-slate-100',
          'transition-colors duration-150',
        ].join(' ')}
      >
        <svg
          className={['h-8 w-8', isDragging ? 'text-blue-600' : 'text-slate-400'].join(' ')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
      </div>

      {/* Copy */}
      <div className="space-y-1">
        <p className="text-base font-medium text-slate-700">
          {isDragging ? 'วางไฟล์ที่นี่' : 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือก'}
        </p>
        <p className="text-sm text-slate-400">.csv · .xlsx · .xls · ไม่เกิน 20 MB</p>
      </div>

      {/* Columns hint */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-left">
        <p className="mb-1 text-xs font-medium text-slate-500">คอลัมน์ที่ต้องมีในไฟล์</p>
        <p className="font-mono text-xs text-slate-600 leading-5">
          Issue Key · System · Status · Business Unit
          <br />
          Type of Issue · Recurring Issue Category
        </p>
      </div>
    </div>
  )
}
