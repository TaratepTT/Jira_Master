'use client'

import { useRef, type ReactNode } from 'react'

// Underlined tab row (WAI-ARIA tabs: arrow keys move between tabs). The panels are rendered by the
// caller; give each panel id={`${idPrefix}-panel-${tab.id}`} role="tabpanel".
export interface TabDef { id: string; label: ReactNode; count?: number | null; tone?: 'attention' | 'danger' }

export default function Tabs({
  tabs, active, onChange, idPrefix, sticky = false, className = '',
}: {
  tabs: TabDef[]
  active: string
  onChange: (id: string) => void
  idPrefix: string
  sticky?: boolean
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : n ? (i + n + tabs.length) % tabs.length : -1
    if (to < 0) return
    e.preventDefault()
    onChange(tabs[to].id)
    refs.current[tabs[to].id]?.focus()
  }
  return (
    <div className={`${sticky ? 'sticky top-12 z-20 lg:top-0' : ''} -mx-4 border-b border-line bg-paper px-4 sm:-mx-8 sm:px-8 ${className}`}>
      <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t, i) => {
          const on = t.id === active
          return (
            <button
              key={t.id}
              ref={el => { refs.current[t.id] = el }}
              role="tab"
              type="button"
              id={`${idPrefix}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`${idPrefix}-panel-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={e => onKey(e, i)}
              className={`relative flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13.5px] font-medium transition-colors ${
                on ? 'text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className={`rounded-full px-1.5 text-[11.5px] num ${
                  t.tone === 'danger' ? 'bg-danger-soft text-danger' : t.tone === 'attention' ? 'bg-attention-soft text-attention' : 'bg-sunken text-muted'
                }`}>{t.count}</span>
              )}
              {on && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" aria-hidden />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
