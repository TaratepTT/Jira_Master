'use client'

import { useEffect, useRef, useState } from 'react'
import { createView, deleteView, listViews, type SavedView } from '@/lib/api'

// "มุมมอง" — saved sets of table filters. A view stores only filters (not the report),
// so the same view works on every week's report.
export default function ViewsMenu({
  currentQuery, onApply,
}: {
  currentQuery: string            // dashboard filters as a query string, without the open ticket
  onApply: (query: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<SavedView[] | null>(null)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && views === null) listViews().then(setViews).catch(() => setViews([]))
  }, [open, views])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      const v = await createView(name.trim(), currentQuery, shared)
      setViews(list => [...(list ?? []), v])
      setName('')
      setShared(false)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (v: SavedView) => {
    if (!confirm(`ลบมุมมอง "${v.name}"?`)) return
    try {
      await deleteView(v.id)
      setViews(list => (list ?? []).filter(x => x.id !== v.id))
    } catch {
      setError('ลบไม่สำเร็จ')
    }
  }

  const mine = (views ?? []).filter(v => v.mine)
  const others = (views ?? []).filter(v => !v.mine)

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="btn">
        มุมมอง
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-80 rounded-lg border border-line bg-surface p-2 shadow-lg">
          {views === null ? (
            <div className="m-2 h-8 animate-pulse rounded bg-sunken" />
          ) : (
            <>
              {[['ของฉัน', mine], ['ทีมแชร์ไว้', others]].map(([title, list]) => (list as SavedView[]).length > 0 && (
                <div key={title as string} className="mb-1">
                  <p className="px-2 pb-1 pt-1.5 text-[12px] text-faint">{title as string}</p>
                  <ul>
                    {(list as SavedView[]).map(v => (
                      <li key={v.id} className="group flex items-center gap-1 rounded hover:bg-sunken">
                        <button type="button" onClick={() => { onApply(v.query); setOpen(false) }} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[13px] text-ink">
                          {v.name}
                          {!v.mine && <span className="ml-1.5 text-[12px] text-faint">{v.owner}</span>}
                          {v.mine && v.shared && <span className="ml-1.5 text-[12px] text-faint">แชร์</span>}
                        </button>
                        {v.mine && (
                          <button type="button" onClick={() => remove(v)} className="btn-quiet px-1.5 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`ลบ ${v.name}`}>ลบ</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {mine.length + others.length === 0 && <p className="px-2 py-2 text-[13px] text-muted">ยังไม่มีมุมมองที่บันทึกไว้</p>}

              <div className="mt-1 border-t border-line px-2 pt-2.5">
                <p className="mb-1.5 text-[12px] text-muted">บันทึกตัวกรองตอนนี้เป็นมุมมอง</p>
                {currentQuery ? (
                  <>
                    <div className="flex gap-1.5">
                      <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save() }}
                        placeholder="เช่น Makro ที่ยังเปิด"
                        aria-label="ชื่อมุมมอง"
                        maxLength={60}
                        className="field"
                      />
                      <button type="button" onClick={save} disabled={!name.trim() || saving} className="btn-primary shrink-0">บันทึก</button>
                    </div>
                    <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
                      <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="accent-[var(--accent)]" />
                      ให้ทุกคนในทีมเห็นมุมมองนี้
                    </label>
                  </>
                ) : (
                  <p className="text-[12px] text-faint">เลือกตัวกรองในตารางก่อน แล้วค่อยบันทึก</p>
                )}
                {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
