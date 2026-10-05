'use client'

import { useMemo, useState } from 'react'
import {
  bulkUpdateTickets, BULK_MAX_TICKETS,
  type BulkChanges, type BulkUpdateResponse,
} from '@/lib/api'

interface BulkTicket {
  key: string
  summary?: string
  businessUnit: string
  typeOfIssue: string
  deployDate?: string
}

interface Props {
  reportId: string
  tickets: BulkTicket[]               // the currently selected tickets
  typeOptions: string[]
  onClose: () => void
  onDone: (res: BulkUpdateResponse) => void   // called once after a run so the page can refresh
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  updated:   { text: 'สำเร็จ',          cls: 'text-green-600 dark:text-green-400' },
  skipped:   { text: 'ข้าม (ค่าเดิม)',   cls: 'text-slate-400' },
  failed:    { text: 'ไม่สำเร็จ',        cls: 'text-red-600 dark:text-red-400' },
  not_found: { text: 'ไม่พบใน report',   cls: 'text-orange-600 dark:text-orange-400' },
}

function errMsg(e: unknown): string {
  const err = e as { response?: { data?: { message?: string } }; code?: string }
  if (err?.code === 'ECONNABORTED') return 'หมดเวลารอ — บาง ticket อาจถูกแก้ไปแล้ว ให้โหลดหน้าใหม่แล้วตรวจสอบ'
  return err?.response?.data?.message ?? 'แก้ไขไม่สำเร็จ'
}

const inputCls = 'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 disabled:opacity-50'

export default function BulkEditModal({ reportId, tickets, typeOptions, onClose, onDone }: Props) {
  const [bu, setBu] = useState('')
  const [type, setType] = useState('')
  const [deploy, setDeploy] = useState('')
  const [clearDeploy, setClearDeploy] = useState(false)
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BulkUpdateResponse | null>(null)

  const changes = useMemo<BulkChanges>(() => {
    const c: BulkChanges = {}
    if (bu.trim()) c.businessUnit = bu.trim()
    if (type) c.typeOfIssue = type
    if (clearDeploy) c.deployDate = null
    else if (deploy) c.deployDate = deploy
    return c
  }, [bu, type, deploy, clearDeploy])

  const fieldCount = Object.keys(changes).length
  const tooMany = tickets.length > BULK_MAX_TICKETS

  const run = async () => {
    setRunning(true)
    setError('')
    try {
      const res = await bulkUpdateTickets(reportId, tickets.map(t => t.key), changes)
      setResult(res)
      onDone(res)
    } catch (e) {
      setError(errMsg(e))
      setStep('form')
    } finally {
      setRunning(false)
    }
  }

  const summaryLines: string[] = []
  if (changes.businessUnit !== undefined) summaryLines.push(`Business Unit → ${changes.businessUnit}`)
  if (changes.typeOfIssue !== undefined) summaryLines.push(`Type of Issue → ${changes.typeOfIssue}`)
  if (changes.deployDate === null) summaryLines.push('Deploy Date → ล้างค่า')
  else if (changes.deployDate) summaryLines.push(`Deploy Date → ${changes.deployDate}`)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={running ? undefined : onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">แก้ไขพร้อมกัน</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tickets.length} ticket ที่เลือก · เขียนกลับ Jira ทุกรายการ</p>
          </div>
          <button onClick={onClose} disabled={running} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-40" aria-label="ปิด">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              {([
                ['สำเร็จ', result.updated, 'text-green-600 dark:text-green-400'],
                ['ข้าม', result.skipped, 'text-slate-500'],
                ['ไม่สำเร็จ', result.failed, 'text-red-600 dark:text-red-400'],
                ['ไม่พบ', result.notFound, 'text-orange-600 dark:text-orange-400'],
              ] as const).map(([label, n, cls]) => (
                <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-700/50 py-2">
                  <p className={`text-lg font-semibold tabular-nums ${cls}`}>{n}</p>
                  <p className="text-[11px] text-slate-400">{label}</p>
                </div>
              ))}
            </div>
            {result.results.some(r => r.status === 'failed' || r.status === 'not_found') && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-3 space-y-1.5 max-h-52 overflow-y-auto">
                <p className="text-xs font-medium text-red-700 dark:text-red-400">รายการที่ไม่สำเร็จ (ยังไม่ถูกแก้ใน Dashboard)</p>
                {result.results.filter(r => r.status === 'failed' || r.status === 'not_found').map(r => (
                  <p key={r.key} className="text-xs text-slate-600 dark:text-slate-300 break-words">
                    <span className="font-medium">{r.key}</span> — <span className={STATUS_LABEL[r.status].cls}>{STATUS_LABEL[r.status].text}</span>
                    {r.message ? `: ${r.message}` : ''}
                  </p>
                ))}
              </div>
            )}
            <button onClick={onClose} className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">ปิด</button>
          </div>
        ) : step === 'confirm' ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">ยืนยันการแก้ไข {tickets.length} ticket ใน Jira</p>
              <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                {summaryLines.map(l => <li key={l}>{l}</li>)}
              </ul>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">การแก้ไขนี้เขียนลง Jira จริงและย้อนกลับอัตโนมัติไม่ได้ · ระบบบันทึกชื่อคุณใน audit log</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={run} disabled={running} className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {running && (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {running ? 'กำลังแก้ไขและ sync ไป Jira...' : 'ยืนยันและแก้ไข'}
              </button>
              <button onClick={() => setStep('form')} disabled={running} className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">กลับ</button>
            </div>
            {running && <p className="text-[11px] text-slate-400 text-center">อาจใช้เวลาหลายสิบวินาทีถ้าเลือกหลายรายการ — อย่าปิดหน้านี้</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">กรอกเฉพาะ field ที่ต้องการเปลี่ยน — field ที่เว้นว่างไว้จะไม่ถูกแตะต้อง</p>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Business Unit</label>
              <input type="text" value={bu} onChange={e => setBu(e.target.value)} placeholder="เช่น AIS (เว้นว่าง = ไม่เปลี่ยน)" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Type of Issue</label>
              <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
                <option value="">— ไม่เปลี่ยน —</option>
                {typeOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Deploy Date</label>
              <input type="date" value={deploy} onChange={e => { setDeploy(e.target.value); if (e.target.value) setClearDeploy(false) }} disabled={clearDeploy} className={inputCls} />
              <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
                <input type="checkbox" checked={clearDeploy} onChange={e => { setClearDeploy(e.target.checked); if (e.target.checked) setDeploy('') }} className="h-3.5 w-3.5 rounded border-slate-300" />
                ล้างวันที่ deploy ของทุกรายการ
              </label>
            </div>

            <p className="text-[11px] text-slate-400">Status, Root Cause และ Resolution ไม่รองรับการแก้พร้อมกัน — ให้แก้ทีละ ticket ในหน้ารายละเอียด</p>

            <details className="text-xs text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer select-none">ดูรายการที่เลือก ({tickets.length})</summary>
              <ul className="mt-2 max-h-32 overflow-y-auto space-y-0.5">
                {tickets.map(t => <li key={t.key} className="truncate"><span className="font-medium text-slate-600 dark:text-slate-300">{t.key}</span> {t.summary ?? ''}</li>)}
              </ul>
            </details>

            {tooMany && <p className="text-xs text-red-600 dark:text-red-400">เลือกได้สูงสุด {BULK_MAX_TICKETS} ticket ต่อครั้ง (ตอนนี้ {tickets.length}) — ลดจำนวนลงก่อน</p>}
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 px-3 py-2">
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={() => { setError(''); setStep('confirm') }} disabled={fieldCount === 0 || tooMany || tickets.length === 0}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                ถัดไป
              </button>
              <button onClick={onClose} className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ยกเลิก</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
