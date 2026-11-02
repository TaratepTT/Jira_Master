'use client'

import { useState, useEffect, useCallback, useRef, DragEvent, ChangeEvent } from 'react'
import Link from 'next/link'

import ReportNameInput from '@/components/upload/ReportNameInput'
import UploadProgress from '@/components/upload/UploadProgress'
import UploadSuccess from '@/components/upload/UploadSuccess'
import UploadError from '@/components/upload/UploadError'
import { uploadReport } from '@/lib/api'
import type { UploadStatus } from '@/types/ticket'
import AppShell, { PageHeader } from '@/components/layout/AppShell'

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
        'flex flex-col items-center justify-center gap-5 rounded-lg border-2 border-dashed',
        'px-8 py-14 text-center cursor-pointer outline-none transition-colors duration-150',
        'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        isDragging
          ? 'border-accent bg-accent-soft'
          : 'border-line-strong bg-surface hover:border-accent hover:bg-sunken',
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
        'flex h-16 w-16 items-center justify-center rounded-lg transition-colors',
        isDragging ? 'bg-accent-soft' : 'bg-sunken',
      ].join(' ')}>
        <svg className={['h-8 w-8 transition-colors', isDragging ? 'text-accent' : 'text-faint'].join(' ')}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>

      <div className="space-y-1">
        <p className="text-base font-medium text-ink">
          {isDragging ? 'วางไฟล์ที่นี่' : 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือก'}
        </p>
        <p className="text-sm text-faint">.csv · .xlsx · .xls · ไม่เกิน 20 MB</p>
      </div>

      <div className="rounded-lg border border-line bg-sunken px-4 py-3 text-left max-w-xs w-full">
        <p className="mb-1 text-xs font-medium text-muted">คอลัมน์ที่ต้องมีในไฟล์</p>
        <p className="font-mono text-xs text-muted leading-5">
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
    <AppShell width="narrow">
      <PageHeader title="นำเข้าจากไฟล์" description="ทางสำรองเมื่อ sync จาก Jira ไม่ได้: อัปโหลดไฟล์ CSV หรือ Excel ที่ export จาก Jira" />
      <div className="space-y-6">
        <div>
          {/* Left column */}
          <div className="space-y-5">
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

        </div>
      </div>
    </AppShell>
  )
}
