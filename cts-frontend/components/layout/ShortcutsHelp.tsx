'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Press "?" anywhere (outside a text field) to see the keyboard shortcuts.
const GROUPS: Array<{ title: string; keys: Array<[string[], string]> }> = [
  { title: 'ทั่วไป', keys: [
    [['Ctrl', 'K'], 'ค้นหา ticket, report หรือไปหน้าอื่น'],
    [['?'], 'เปิดหน้านี้'],
    [['Esc'], 'ปิดหน้าต่างที่เปิดอยู่'],
  ] },
  { title: 'หน้า Dashboard', keys: [
    [['/'], 'ค้นหาในตาราง ticket'],
    [['←', '→'], 'เลื่อนแท็บ (เมื่อเลือกแถบแท็บอยู่)'],
  ] },
  { title: 'แผงรายละเอียด ticket', keys: [
    [['J'], 'ใบถัดไป (หรือ →)'],
    [['K'], 'ใบก่อนหน้า (หรือ ←)'],
    [['E'], 'แก้ไขใบนี้'],
    [['Ctrl', 'Enter'], 'บันทึกลง Jira แล้วไปใบถัดไป'],
  ] },
]

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable)
}

export default function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setOpen(o => !o) }
      else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="dialog-backdrop absolute inset-0 bg-black/45" onClick={() => setOpen(false)} aria-hidden />
      <div role="dialog" aria-modal="true" aria-labelledby="kbd-title" className="dialog-panel pop relative w-full max-w-[460px] rounded-[14px] border border-line bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="kbd-title" className="text-[16px] font-semibold text-ink">คีย์ลัด</h2>
          <button type="button" onClick={() => setOpen(false)} className="btn-quiet" autoFocus>ปิด</button>
        </div>
        <div className="space-y-5">
          {GROUPS.map(g => (
            <section key={g.title}>
              <h3 className="mb-1.5 text-[12px] font-medium text-faint">{g.title}</h3>
              <ul className="divide-y divide-line">
                {g.keys.map(([keys, what]) => (
                  <li key={what} className="flex items-center justify-between gap-4 py-2 text-[13.5px]">
                    <span className="text-ink">{what}</span>
                    <span className="flex shrink-0 gap-1">{keys.map(k => <kbd key={k} className="key min-w-[1.6rem] rounded border border-line-strong bg-sunken px-1.5 py-0.5 text-center text-[12px] text-muted">{k}</kbd>)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
