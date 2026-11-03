'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { getReports, searchTickets, type TicketHit } from '@/lib/api'
import { useAuth } from '@/components/auth/AuthContext'
import { useTheme } from '@/components/theme/ThemeProvider'
import Spinner from '@/components/ui/Spinner'

// ── Ctrl+K / ⌘K : jump to a ticket, a report, a page, or run a command ──
// Typing a key like "CTS-17110" (or just "17110") finds that ticket in its latest report.

interface ReportItem { id: string; name: string; totalTickets: number; createdAt: string }
type Item =
  | { kind: 'ticket'; id: string; title: string; sub: string; run: () => void }
  | { kind: 'report'; id: string; title: string; sub: string; run: () => void }
  | { kind: 'page'; id: string; title: string; sub: string; run: () => void }

const KIND_LABEL: Record<Item['kind'], string> = { ticket: 'ticket', report: 'รายงาน', page: 'ไปที่ / คำสั่ง' }

export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { canEdit, isAdmin } = useAuth()
  const { toggleTheme } = useTheme()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [reports, setReports] = useState<ReportItem[] | null>(null)
  const [hits, setHits] = useState<TicketHit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setQ(''); setActive(0); setHits([])
    setTimeout(() => inputRef.current?.focus(), 0)
    if (reports === null) getReports().then((r: ReportItem[]) => setReports(r)).catch(() => setReports([]))
  }, [open, reports])

  // Ticket search (debounced). A bare number is treated as a CTS key.
  useEffect(() => {
    if (!open) return
    const raw = q.trim()
    const term = /^\d+$/.test(raw) ? `CTS-${raw}` : raw
    if (term.length < 2) { setHits([]); return }
    const mine = ++seq.current
    setSearching(true)
    const t = setTimeout(() => {
      searchTickets(term)
        .then(r => { if (mine === seq.current) setHits(r) })
        .catch(() => { if (mine === seq.current) setHits([]) })
        .finally(() => { if (mine === seq.current) setSearching(false) })
    }, 180)
    return () => clearTimeout(t)
  }, [q, open])

  const go = useCallback((href: string) => { onClose(); router.push(href) }, [onClose, router])

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase()
    const pages: Item[] = [
      { kind: 'page', id: 'p-reports', title: 'รายงาน', sub: 'report ทั้งหมด', run: () => go('/') },
      ...(canEdit ? [{ kind: 'page' as const, id: 'p-sync', title: 'ดึงข้อมูลจาก Jira', sub: 'สร้าง report ใหม่', run: () => go('/jira') }] : []),
      { kind: 'page', id: 'p-compare', title: 'เปรียบเทียบ report', sub: 'สัปดาห์นี้เทียบสัปดาห์ก่อน', run: () => go('/compare') },
      { kind: 'page', id: 'p-playbooks', title: 'คู่มือ L1', sub: 'คู่มือที่ส่งให้ L1 ใน Jira อัตโนมัติ', run: () => go('/playbooks') },
      { kind: 'page', id: 'p-account', title: 'บัญชีของฉัน', sub: 'รหัสผ่าน และการเชื่อมบัญชี Jira', run: () => go('/account') },
      ...(isAdmin ? [
        { kind: 'page' as const, id: 'p-users', title: 'ผู้ใช้', sub: 'อนุมัติและกำหนดสิทธิ์', run: () => go('/admin/users') },
        { kind: 'page' as const, id: 'p-audit', title: 'ประวัติการใช้งาน', sub: 'audit log', run: () => go('/admin/audit') },
      ] : []),
      { kind: 'page', id: 'p-theme', title: 'สลับโหมดสว่าง / มืด', sub: 'คำสั่ง', run: () => { toggleTheme(); onClose() } },
    ]
    const reportItems: Item[] = (reports ?? []).map(r => ({
      kind: 'report' as const, id: `r-${r.id}`, title: r.name,
      sub: `${r.totalTickets} ticket, ${new Date(r.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      run: () => go(`/dashboard/${r.id}`),
    }))
    const ticketItems: Item[] = hits.map(h => ({
      kind: 'ticket' as const, id: `t-${h.key}`, title: `${h.key}  ${h.summary}`,
      sub: `${h.status}, ใน report "${h.reportName}"`,
      run: () => go(`/dashboard/${h.reportId}?t=${encodeURIComponent(h.key)}`),
    }))
    const match = (i: Item) => !term || i.title.toLowerCase().includes(term) || i.sub.toLowerCase().includes(term)
    if (!term) return [...pages, ...reportItems.slice(0, 5)]
    return [...ticketItems, ...reportItems.filter(match).slice(0, 6), ...pages.filter(match)]
  }, [q, hits, reports, canEdit, isAdmin, go, toggleTheme, onClose])

  useEffect(() => { setActive(0) }, [items.length, q])

  if (!open || typeof document === 'undefined') return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run() }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  let lastKind: Item['kind'] | null = null
  // Portal to <body>: the nav is a sticky stacking context, the palette must sit above any open modal
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 px-4 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ค้นหาและคำสั่ง"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg className="h-4 w-4 shrink-0 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="พิมพ์ ticket key (เช่น 17110), summary, ชื่อ report หรือคำสั่ง"
            aria-label="ค้นหา"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            className="h-12 w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
          />
          {searching && <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-faint"><Spinner />กำลังค้นหา</span>}
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-muted">{q.trim().length >= 2 && !searching ? 'ไม่พบ ticket, report หรือคำสั่งที่ตรงกับคำนี้' : 'พิมพ์อย่างน้อย 2 ตัวอักษร'}</li>
          )}
          {items.map((it, i) => {
            const header = it.kind !== lastKind ? KIND_LABEL[it.kind] : null
            lastKind = it.kind
            return (
              <li key={it.id} role="option" aria-selected={i === active}>
                {header && <p className="px-4 pb-1 pt-2.5 text-[12px] font-medium text-faint">{header}</p>}
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => it.run()}
                  className={`flex w-full flex-col px-4 py-2 text-left ${i === active ? 'bg-accent-soft' : ''}`}
                >
                  <span className={`truncate text-[14px] ${it.kind === 'ticket' ? 'text-ink' : 'text-ink'}`}>
                    {it.kind === 'ticket' ? <><span className="key text-accent">{it.title.split('  ')[0]}</span> {it.title.split('  ').slice(1).join('  ')}</> : it.title}
                  </span>
                  <span className="truncate text-[12px] text-muted">{it.sub}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[12px] text-faint">
          <span><kbd className="key">↑↓</kbd> เลื่อน</span>
          <span><kbd className="key">Enter</kbd> เปิด</span>
          <span><kbd className="key">Esc</kbd> ปิด</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
