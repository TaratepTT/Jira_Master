'use client'

import { useState } from 'react'
import { pct } from './utils'

// A compact ranked list: label, a thin bar, count and share. Rows can act as filters.
export default function BreakdownList({
  title, rows, total, onPick, active = [], limit = 6, emptyText = 'ไม่มีข้อมูล',
}: {
  title: string
  rows: Array<[string, number]>
  total: number
  /** when set, clicking a row filters the ticket table by that value */
  onPick?: (value: string) => void
  active?: string[]
  limit?: number
  emptyText?: string
}) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, limit)
  const max = rows.reduce((m, [, n]) => Math.max(m, n), 0) || 1

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="text-[12px] text-faint num">{rows.length} รายการ</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-[13px] text-faint">{emptyText}</p>
      ) : (
        <ul>
          {shown.map(([label, n]) => {
            const isActive = active.includes(label)
            const body = (
              <>
                <span className={`min-w-0 flex-1 truncate text-left ${isActive ? 'font-semibold text-accent' : 'text-ink'}`} title={label}>{label}</span>
                <span className="hidden sm:block w-20 shrink-0">
                  <span className="block h-1 rounded-full bg-sunken">
                    <span className="block h-1 rounded-full bg-accent" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                </span>
                <span className="w-8 shrink-0 text-right font-medium text-ink num">{n}</span>
                <span className="w-9 shrink-0 text-right text-faint num">{pct(n, total)}%</span>
              </>
            )
            return (
              <li key={label}>
                {onPick ? (
                  <button
                    onClick={() => onPick(label)}
                    title={isActive ? 'คลิกอีกครั้งเพื่อเอาตัวกรองออก' : `กรองตาราง: ${label}`}
                    className={`-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-3 rounded px-1.5 py-[5px] text-[13px] transition-colors hover:bg-sunken ${isActive ? 'bg-accent-soft' : ''}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 py-[5px] text-[13px]">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {rows.length > limit && (
        <button onClick={() => setAll(a => !a)} className="btn-quiet mt-1 -ml-2">
          {all ? 'แสดงน้อยลง' : `แสดงทั้งหมด ${rows.length}`}
        </button>
      )}
    </div>
  )
}
