'use client'

import { useEffect, useRef, useState } from 'react'

// ── Multi-select dropdown ──────────────────────────────────────
export interface MultiSelectProps {
  label: string
  options: { value: string; count: number }[]
  selected: string[]
  onChange: (vals: string[]) => void
}
export default function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val))
    else onChange([...selected, val])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          selected.length
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-line-strong bg-surface text-muted hover:bg-sunken'
        }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-on-accent">
            {selected.length}
          </span>
        )}
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1.5 w-64 rounded-lg border border-line bg-surface p-2 shadow-lg">
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-accent hover:bg-accent-soft transition-colors"
            >
              ล้างตัวกรองทั้งหมด
            </button>
          )}
          <div className="max-h-64 overflow-y-auto">
            {options.map(opt => (
              <label
                key={opt.value}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-sunken cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="h-3.5 w-3.5 rounded border-line-strong text-accent focus:ring-accent flex-shrink-0"
                  />
                  <span className="text-xs text-ink truncate">{opt.value}</span>
                </span>
                <span className="text-xs text-faint flex-shrink-0">{opt.count}</span>
              </label>
            ))}
            {!options.length && (
              <p className="px-2 py-3 text-xs text-faint text-center">ไม่มีตัวเลือก</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
