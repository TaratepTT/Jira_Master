'use client'

import { useCallback, useEffect, useState } from 'react'
import { listRemovedTickets, restoreRemovedTickets, type RemovedTicketInfo } from '@/lib/api'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { statusBadge } from './utils'

// Tickets an admin took out of this report. Shown only when there are some; each can be put back.
export default function RemovedTickets({ reportId, version, onRestored }: { reportId: string; version: number; onRestored: () => void }) {
  const [items, setItems] = useState<RemovedTicketInfo[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const { notify } = useDialog()

  const load = useCallback(async () => {
    try { setItems(await listRemovedTickets(reportId)) } catch { /* keep what we had */ }
  }, [reportId])
  useEffect(() => { void load() }, [load, version])

  const restore = async (keys?: string[]) => {
    setBusy(keys?.[0] ?? 'all')
    try {
      const r = await restoreRemovedTickets(reportId, keys)
      toast.show({ text: `กู้คืน ${r.restored.length} ticket กลับเข้า report แล้ว`, tone: 'ok' })
      await load(); onRestored()
    } catch (e) {
      await notify({ title: 'กู้คืนไม่สำเร็จ', message: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'ลองใหม่อีกครั้ง', tone: 'danger' })
    } finally { setBusy(null) }
  }

  if (!items.length) return null
  const fmt = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="mt-4 rounded-md border border-line" data-testid="removed-tickets">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13.5px] hover:bg-sunken">
        <span><span className="font-medium text-ink">ticket ที่ลบออกจาก report นี้</span> <span className="text-muted num">({items.length})</span>
          <span className="ml-2 text-[12.5px] text-faint">ไม่ถูกนับในทุกแท็บ ข้อมูลใน Jira ยังอยู่ครบ</span></span>
        <span className="text-muted" aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="border-t border-line">
          <div className="flex justify-end px-4 py-2">
            <button className="btn" onClick={() => restore()} disabled={busy !== null} aria-busy={busy === 'all'}>{busy === 'all' ? 'กำลังกู้คืน...' : `กู้คืนทั้งหมด ${items.length} ใบ`}</button>
          </div>
          <ul className="divide-y divide-line">
            {items.map(t => (
              <li key={t.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[13px]">
                <span className="key w-24 shrink-0 text-accent">{t.key}</span>
                <span className="min-w-0 flex-1 basis-48 break-words text-ink">{t.summary || '—'}</span>
                <span className={`chip ${statusBadge(t.status)}`}>{t.status}</span>
                <span className="text-[12px] text-muted">ลบโดย {t.removedBy} · {fmt(t.removedAt)}</span>
                <button className="btn-quiet" onClick={() => restore([t.key])} disabled={busy !== null} aria-busy={busy === t.key} aria-label={`กู้คืน ${t.key}`}>{busy === t.key ? 'กำลังกู้...' : 'กู้คืน'}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
