'use client'

import { useState } from 'react'

interface Props {
  keys: string[]
}

// Shows a truncated preview of ticket keys with a toggle to expand the full,
// wrapped list — used anywhere a "Ticket Keys" column would otherwise clip.
export default function ExpandableKeys({ keys }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (!keys.length) return <span className="text-slate-300 dark:text-slate-600">-</span>

  const PREVIEW_COUNT = 6
  const preview = keys.slice(0, PREVIEW_COUNT).join(', ')
  const hasMore = keys.length > PREVIEW_COUNT

  if (!expanded) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-blue-600 dark:text-blue-400 max-w-xs truncate">
          {preview}{hasMore ? ', ...' : ''}
        </span>
        {(hasMore || keys.length > 0) && (
          <button
            onClick={() => setExpanded(true)}
            className="flex-shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400 underline hover:text-slate-700 dark:hover:text-slate-200 whitespace-nowrap"
          >
            ดูทั้งหมด ({keys.length})
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-md">
      <div className="flex flex-wrap gap-1">
        {keys.map(k => (
          <span key={k} className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded px-1.5 py-0.5">
            {k}
          </span>
        ))}
      </div>
      <button
        onClick={() => setExpanded(false)}
        className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 underline hover:text-slate-700 dark:hover:text-slate-200"
      >
        ย่อกลับ
      </button>
    </div>
  )
}
