'use client'

import { useEffect, useRef, useState } from 'react'
import Spinner from '@/components/ui/Spinner'

export type CellState = { state: 'saving' } | { state: 'saved' } | { state: 'error'; message: string }

// One editable table cell for "แก้ในตาราง" mode. Saves on Enter / leaving the field
// (Esc cancels). Multiline fields save with Ctrl/⌘+Enter or on blur.
export default function InlineCell({
  value, onSave, options, multiline, label, status,
}: {
  value: string
  onSave: (v: string) => void
  options?: string[]          // render a <select> instead of a text field
  multiline?: boolean
  label: string               // for screen readers, e.g. "Business Unit ของ CTS-1"
  status?: CellState
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>(null)
  // last value sent, so Enter followed by blur (or a slow save) does not write the same thing twice
  const sent = useRef(value)
  useEffect(() => { setDraft(value); sent.current = value }, [value])
  // a failed save may be retried with the same text
  useEffect(() => { if (status?.state === 'error') sent.current = value }, [status, value])

  const commit = (v = draft) => {
    const t = v.trim()
    if (t === (value ?? '').trim() || t === (sent.current ?? '').trim()) return
    sent.current = t
    onSave(t)
  }
  const cls = `w-full rounded border bg-surface px-1.5 py-1 text-[13px] text-ink outline-none transition-colors focus:border-accent ${
    status?.state === 'error' ? 'border-danger' : 'border-line-strong'
  }`

  const field = options ? (
    <select
      ref={ref as React.RefObject<HTMLSelectElement>}
      aria-label={label}
      value={draft}
      onChange={e => { setDraft(e.target.value); commit(e.target.value) }}
      disabled={status?.state === 'saving'}
      className={cls}
    >
      {!options.includes(draft) && <option value={draft}>{draft || '— เลือก —'}</option>}
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  ) : multiline ? (
    <textarea
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      aria-label={label}
      value={draft}
      rows={2}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLElement).blur() }
      }}
      disabled={status?.state === 'saving'}
      className={`${cls} resize-y leading-snug`}
    />
  ) : (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      aria-label={label}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLElement).blur() }
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLElement).blur() }
      }}
      disabled={status?.state === 'saving'}
      className={cls}
    />
  )

  return (
    <div onClick={e => e.stopPropagation()}>
      {field}
      {status && (
        <p
          className={`mt-0.5 text-[11px] ${status.state === 'error' ? 'text-danger' : status.state === 'saved' ? 'text-ok' : 'text-faint'}`}
          role={status.state === 'error' ? 'alert' : undefined}
          title={status.state === 'error' ? status.message : undefined}
        >
          {status.state === 'saving' ? <span className="inline-flex items-center gap-1"><Spinner />กำลังบันทึกลง Jira</span> : status.state === 'saved' ? 'บันทึกแล้ว' : 'บันทึกไม่สำเร็จ'}
        </p>
      )}
    </div>
  )
}
