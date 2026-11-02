'use client'

import { useState } from 'react'
import type { SimilarTicket } from '@/lib/api'
import { jiraBrowseUrl } from './utils'

// Earlier tickets whose summary looks like this one, with what was written for them.
// Editors can copy a Root Cause / Resolution straight into the ticket being edited.
export default function SimilarTickets({
  items, loading, canUse, onUse,
}: {
  items: SimilarTicket[]
  loading: boolean
  canUse: boolean
  onUse: (patch: { rootCause?: string; resolution?: string }) => void
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (loading) return <div className="h-10 animate-pulse rounded-md bg-sunken" />
  if (!items.length) return null

  return (
    <section className="border-t border-line pt-4" aria-labelledby="similar-title">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 id="similar-title" className="text-[13px] font-semibold text-ink">ticket คล้ายกันที่เคยแก้แล้ว</h3>
        <span className="text-[12px] text-faint">เทียบจาก summary ของทุก report</span>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map(s => {
          const expanded = open === s.key
          return (
            <li key={s.key} className="px-3 py-2.5">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : s.key)}
                aria-expanded={expanded}
                className="flex w-full items-start gap-3 text-left"
              >
                <span className="w-10 shrink-0 pt-0.5 text-right text-[12px] text-faint num" title="ความใกล้เคียงของ summary">{Math.round(s.score * 100)}%</span>
                <span className="min-w-0 flex-1">
                  <span className="key text-[13px] text-accent">{s.key}</span>
                  <span className="ml-2 text-[13px] text-ink">{s.summary}</span>
                  {!expanded && (s.rootCause || s.resolution) && (
                    <span className="mt-0.5 block truncate text-[12px] text-muted">{s.rootCause || s.resolution}</span>
                  )}
                </span>
              </button>
              {expanded && (
                <div className="ml-[3.25rem] mt-2 space-y-2 text-[13px]">
                  {([['rootCause', 'Root Cause'], ['resolution', 'Resolution']] as const).map(([f, label]) => s[f] && (
                    <div key={f}>
                      <p className="text-[12px] text-muted">{label}</p>
                      <p className="whitespace-pre-wrap text-ink">{s[f]}</p>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {canUse && s.rootCause && <button type="button" onClick={() => onUse({ rootCause: s.rootCause })} className="btn py-1">ใช้ Root Cause นี้</button>}
                    {canUse && s.resolution && <button type="button" onClick={() => onUse({ resolution: s.resolution })} className="btn py-1">ใช้ Resolution นี้</button>}
                    {canUse && s.rootCause && s.resolution && (
                      <button type="button" onClick={() => onUse({ rootCause: s.rootCause, resolution: s.resolution })} className="btn-quiet">ใช้ทั้งสองช่อง</button>
                    )}
                    <a href={jiraBrowseUrl(s.key)} target="_blank" rel="noopener noreferrer" className="btn-quiet ml-auto">เปิดใน Jira</a>
                  </div>
                  <p className="text-[11px] text-faint">จาก report &quot;{s.reportName}&quot;, ประเภท {s.typeOfIssue || 'ไม่ระบุ'}, สถานะ {s.status}</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
