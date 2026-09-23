'use client'

import { useState, useEffect, useCallback, useRef, DragEvent, ChangeEvent } from 'react'
import Link from 'next/link'

import ReportNameInput from '@/components/upload/ReportNameInput'
import UploadProgress from '@/components/upload/UploadProgress'
import UploadSuccess from '@/components/upload/UploadSuccess'
import UploadError from '@/components/upload/UploadError'
import RecentReports from '@/components/upload/RecentReports'
import ThemeToggle from '@/components/theme/ThemeToggle'
import LogoutButton from '@/components/auth/LogoutButton'
import { uploadReport } from '@/lib/api'
import type { UploadStatus } from '@/types/ticket'

// ── helpers ──────────────────────────────────────────────────
function defaultReportName() {
  return `CTS Report — ${new Date().toLocaleDateString('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric',
  })}`
}

const ACCEPTED_EXT = ['.csv', '.xlsx', '.xls']
const ACCEPT_MIME =
  'text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

function validateFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
  if (!ACCEPTED_EXT.includes(ext)) return `ไฟล์ ${ext} ไม่รองรับ — ใช้ .csv, .xlsx หรือ .xls`
  if (file.size > 20 * 1024 * 1024) return 'ไฟล์ใหญ่เกิน 20 MB'
  return null
}

// ── Upload Zone ───────────────────────────────────────────────
interface ZoneProps {
  isDragging: boolean
  onDragOver: (e: DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent) => void
  onClick: () => void
  inputRef: React.RefObject<HTMLInputElement>
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}

function UploadZone({ isDragging, onDragOver, onDragLeave, onDrop, onClick, inputRef, onChange }: ZoneProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-label="อัปโหลดไฟล์ CSV หรือ Excel"
      className={[
        'flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed',
        'px-8 py-14 text-center cursor-pointer outline-none transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        isDragging
          ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
          : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-blue-500 dark:hover:bg-slate-700/50',
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

      <div className={[
        'flex h-16 w-16 items-center justify-center rounded-2xl transition-colors',
        isDragging ? 'bg-blue-100 dark:bg-blue-900/50' : 'bg-slate-100 dark:bg-slate-700',
      ].join(' ')}>
        <svg className={['h-8 w-8 transition-colors', isDragging ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'].join(' ')}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>

      <div className="space-y-1">
        <p className="text-base font-medium text-slate-700 dark:text-slate-200">
          {isDragging ? 'วางไฟล์ที่นี่' : 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือก'}
        </p>
        <p className="text-sm text-slate-400 dark:text-slate-500">.csv · .xlsx · .xls · ไม่เกิน 20 MB</p>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-4 py-3 text-left max-w-xs w-full">
        <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">คอลัมน์ที่ต้องมีในไฟล์</p>
        <p className="font-mono text-xs text-slate-600 dark:text-slate-300 leading-5">
          Issue Key · System · Status<br />
          Business Unit · Type of Issue<br />
          Recurring Issue Category
        </p>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function UploadPage() {
  const [status, setStatus] = useState<UploadStatus>({ state: 'idle' })
  const [reportName, setReportName] = useState(defaultReportName)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isBusy = status.state === 'parsing' || status.state === 'uploading'
  const isSuccess = status.state === 'success'
  const isDragging = status.state === 'dragging'

  // Kick off upload when file is ready
  useEffect(() => {
    if (status.state !== 'parsing' || !pendingFile) return
    const run = async () => {
      try {
        setStatus({ state: 'uploading', fileName: pendingFile.name, progress: 0 })
        const result = await uploadReport(pendingFile, reportName, (pct) =>
          setStatus((prev) =>
            prev.state === 'uploading' ? { ...prev, progress: pct } : prev
          )
        )
        setStatus({ state: 'success', reportId: result.reportId, totalTickets: result.totalTickets })
        setPendingFile(null)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'เชื่อมต่อ server ไม่ได้ ลองใหม่อีกครั้ง'
        setStatus({ state: 'error', message: msg })
      }
    }
    run()
  }, [status.state, pendingFile, reportName])

  const handleFile = useCallback((file: File) => {
    const err = validateFile(file)
    if (err) { setStatus({ state: 'error', message: err }); return }
    setPendingFile(file)
    setStatus({ state: 'parsing', fileName: file.name })
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (!isBusy && !isSuccess) setStatus({ state: 'dragging' })
  }, [isBusy, isSuccess])

  const onDragLeave = useCallback(() => {
    if (status.state === 'dragging') setStatus({ state: 'idle' })
  }, [status.state])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
    else setStatus({ state: 'idle' })
  }, [handleFile])

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }, [handleFile])

  const reset = () => {
    setStatus({ state: 'idle' })
    setPendingFile(null)
    setReportName(defaultReportName())
  }

  const showZone = !isBusy && !isSuccess

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      {/* Top bar */}
      <header className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-colors">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors mr-1">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
            </Link>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
              <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">CTS Report</span>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <LogoutButton />
            <Link
              href="/jira"
              className="flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Sync จาก Jira
            </Link>
            <Link href="/history" className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
              ประวัติ report
            </Link>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">

          {/* Left column */}
          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">อัปโหลด Jira / CTS Export</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                นำเข้าไฟล์ CSV หรือ Excel แล้วรับ dashboard พร้อม Executive Summary ทันที
              </p>
            </div>

            {!isSuccess && (
              <ReportNameInput value={reportName} onChange={setReportName} disabled={isBusy} />
            )}

            {status.state === 'error' && (
              <UploadError message={status.message} onRetry={reset} />
            )}

            {(status.state === 'parsing' || status.state === 'uploading') && (
              <UploadProgress
                fileName={'fileName' in status ? status.fileName : ''}
                progress={status.state === 'uploading' ? status.progress : 0}
                state={status.state}
              />
            )}

            {isSuccess && (
              <UploadSuccess
                reportId={status.reportId}
                totalTickets={status.totalTickets}
                onReset={reset}
              />
            )}

            {showZone && (
              <UploadZone
                isDragging={isDragging}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                inputRef={inputRef}
                onChange={onChange}
              />
            )}
          </div>

          {/* Right column */}
          <aside className="space-y-3">
            <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">Reports ที่ผ่านมา</h2>
            <RecentReports />
          </aside>
        </div>
      </main>
    </div>
  )
}
