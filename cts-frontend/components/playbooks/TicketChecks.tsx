'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { jiraBrowseUrl } from '@/components/dashboard/utils'
import Spinner from '@/components/ui/Spinner'
import {
  listChecks, recheckTicket, runChecks, sendTicketConfluence, sendTicketPlaybook,
  type CheckCandidate, type CheckDecision, type TicketCheck, type WatchState,
} from '@/lib/api'
import { useDialog } from '@/components/ui/Dialog'

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
const fmtTime = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const TONE: Record<CheckDecision, string> = {
  sent_playbook: 'text-ok', sent_confluence: 'text-ok', already_sent: 'text-ok',
  suggested: 'text-accent', low_confidence: 'text-attention', no_match: 'text-faint', error: 'text-danger',
}
type Filter = 'all' | 'sent' | 'waiting' | 'none'
const FILTERS: Array<[Filter, string, (c: TicketCheck) => boolean]> = [
  ['all', 'ทั้งหมด', () => true],
  ['sent', 'ส่งแล้ว', c => c.sent.length > 0],
  ['waiting', 'ตรงแต่ยังไม่ส่ง', c => c.sent.length === 0 && c.decision === 'suggested'],
  ['none', 'ไม่ตรง / ใกล้เคียง', c => c.sent.length === 0 && ['low_confidence', 'no_match', 'error'].includes(c.decision)],
]

// "ticket ใหม่ที่ระบบตรวจแล้ว": the watcher pulls new tickets from Jira, rechecks Confluence pages
// against each one, and this list shows what it found and what it did.
export default function TicketChecks({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [checks, setChecks] = useState<TicketCheck[] | null>(null)
  const [watch, setWatch] = useState<WatchState | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const { confirm } = useDialog()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try { const r = await listChecks(); setChecks(r.checks); setWatch(r.watch) } catch { setChecks([]) }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(t)
  }, [load])

  const pull = async () => {
    setBusy('pull'); setMsg(null)
    try {
      const r = await runChecks(); setWatch(r.watch); await load(); onChanged()
      setMsg(r.watch.lastError ? { ok: false, text: r.watch.lastError } : { ok: true, text: `เจอ ticket ใหม่ ${r.watch.lastFound} ใบ ตรวจเพิ่ม ${r.watch.lastChecked} ใบ` })
    } catch (e) { setMsg({ ok: false, text: errMsg(e, 'ดึงไม่สำเร็จ') }) } finally { setBusy(null) }
  }
  const recheck = async (key: string) => {
    setBusy(`re-${key}`); setMsg(null)
    try { const r = await recheckTicket(key); await load(); setMsg({ ok: true, text: `${key}: ${r.decisionText}` }) }
    catch (e) { setMsg({ ok: false, text: errMsg(e, 'ตรวจไม่สำเร็จ') }) } finally { setBusy(null) }
  }
  const send = async (key: string, c: CheckCandidate) => {
    if (!(await confirm({ title: `ส่ง${c.kind === 'confluence' ? 'ลิงก์ Confluence' : 'คู่มือ'}ให้ L1?`, message: `ระบบจะใส่เป็น comment ภายในของ ${key} ลูกค้าไม่เห็น`, detail: c.title, confirmLabel: 'ส่งให้ L1' }))) return
    setBusy(`send-${key}-${c.id}`); setMsg(null)
    try {
      if (c.kind === 'confluence') await sendTicketConfluence(key, c.id); else await sendTicketPlaybook(key, c.id)
      await load(); onChanged(); setMsg({ ok: true, text: `ส่งให้ ${key} แล้ว` })
    } catch (e) { setMsg({ ok: false, text: errMsg(e, 'ส่งไม่สำเร็จ') }) } finally { setBusy(null) }
  }

  const shown = (checks ?? []).filter(FILTERS.find(f => f[0] === filter)![2])
  const isSent = (c: TicketCheck, cand: CheckCandidate) =>
    c.sent.some(s => s.playbookId === cand.id || s.playbookId === `confluence:${cand.id}` || (s.pages ?? []).some(pg => pg.id === cand.id))

  return (
    <div className="panel mb-6" data-testid="ticket-checks">
      <div className="panel-pad flex flex-wrap items-start justify-between gap-3 border-b border-line">
        <div className="min-w-0">
          <h2 className="section-title">ticket ใหม่ที่ระบบตรวจแล้ว</h2>
          <p className="section-note mt-0.5">
            {!watch ? <><Spinner /> กำลังโหลด</> : !watch.enabled ? 'ตัวดึง ticket ปิดอยู่ (ต้องมี JIRA_API_TOKEN บน server และไม่ได้ตั้ง PLAYBOOK_WATCH=off)'
              : <>ระบบดึง ticket ใหม่จาก Jira เองทุก {Math.max(1, Math.round(watch.intervalMs / 60000))} นาที แล้วเปิดหน้า Confluence ที่ค้นเจอมาเทียบกับเนื้อหา ticket
                {watch.lastRunAt && <> · ตรวจล่าสุด {fmtTime(watch.lastRunAt)}</>}</>}
          </p>
          {watch?.lastError && <p className="mt-1 text-[13px] text-danger">{watch.lastError}</p>}
        </div>
        {canEdit && watch?.enabled && (
          <button onClick={pull} disabled={busy !== null} aria-busy={busy === 'pull'} className="btn shrink-0">{busy === 'pull' ? 'กำลังดึง...' : 'ดึง ticket ใหม่ตอนนี้'}</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        {FILTERS.map(([k, label, fn]) => (
          <button key={k} onClick={() => setFilter(k)} className={filter === k ? 'btn-primary py-1' : 'btn-quiet py-1'} aria-pressed={filter === k}>
            {label} <span className="num opacity-70">{(checks ?? []).filter(fn).length}</span>
          </button>
        ))}
        {msg && <span className={`ml-2 text-[13px] ${msg.ok ? 'text-ok' : 'text-danger'}`} role={msg.ok ? undefined : 'alert'}>{msg.text}</span>}
      </div>

      <div className="overflow-x-auto p-4 pt-2">
        {checks === null ? <div className="h-16 animate-pulse rounded bg-sunken" />
          : shown.length === 0 ? (
            checks.length ? <p className="py-3 text-[13px] text-muted">ไม่มี ticket ในกลุ่มนี้ <button onClick={() => setFilter('all')} className="link">ดูทั้งหมด</button></p>
              : (
                <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="text-[14px] font-medium text-ink">ยังไม่มี ticket ใหม่ที่ตรวจ</p>
                    <p className="text-[13px] text-muted">ระบบดึงเองทุก {Math.max(1, Math.round((watch?.intervalMs ?? 300000) / 60000))} นาที หรือกด "ดึง ticket ใหม่ตอนนี้" ด้านบนเพื่อดูผลทันที</p>
                  </div>
                </div>
              ))
          : (
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="py-2 pr-3 font-medium">สร้างเมื่อ</th>
                  <th className="py-2 pr-3 font-medium">Ticket</th>
                  <th className="py-2 pr-3 font-medium">ผลตรวจ</th>
                  <th className="py-2 pr-3 font-medium">ตรงที่สุด</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map(c => {
                  const cands = c.candidates ?? []
                  const top = [...cands].sort((a, b) => b.score - a.score)[0]
                  const expanded = open === c.ticketKey
                  const sentNow = c.sent.length > 0
                  return (
                    <Fragment key={c.ticketKey}>
                      <tr className="border-b border-line align-top">
                        <td className="whitespace-nowrap py-2.5 pr-3 text-faint num">{fmtTime(c.ticketCreatedAt ?? c.checkedAt)}</td>
                        <td className="py-2.5 pr-3">
                          <a href={jiraBrowseUrl(c.ticketKey)} target="_blank" rel="noreferrer" className="key text-accent hover:underline">{c.ticketKey}</a>
                          <p className="max-w-[22rem] truncate text-ink" title={c.summary}>{c.summary || '—'}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={sentNow ? 'text-ok' : TONE[c.decision]}>{sentNow ? `ส่งแล้ว${c.sent.some(s => s.mode === 'auto') ? ' (อัตโนมัติ)' : ''}` : c.decisionText}</span>
                          {c.trigger === 'webhook' && <span className="ml-1.5 text-[12px] text-faint">ผ่าน webhook</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          {top ? (
                            <span className="flex items-baseline gap-2">
                              <span className="w-9 shrink-0 text-right num text-muted">{Math.round(top.score * 100)}%</span>
                              <span className="min-w-0 max-w-[18rem] truncate">{top.kind === 'confluence' ? 'Confluence: ' : 'คู่มือ: '}{top.title}</span>
                            </span>
                          ) : <span className="text-faint">—</span>}
                        </td>
                        <td className="whitespace-nowrap py-2.5 text-right">
                          {cands.length > 0 && (
                            <button onClick={() => setOpen(expanded ? null : c.ticketKey)} aria-expanded={expanded} className="btn-quiet">{expanded ? 'ซ่อน' : 'ดูผล'}</button>
                          )}
                          {canEdit && <button onClick={() => recheck(c.ticketKey)} disabled={busy !== null} aria-busy={busy === `re-${c.ticketKey}`} className="btn-quiet">{busy === `re-${c.ticketKey}` ? 'กำลังตรวจ...' : 'ตรวจใหม่'}</button>}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-line bg-sunken">
                          <td colSpan={5} className="px-3 py-3">
                            <ul className="space-y-2">
                              {[...cands].sort((a, b) => b.score - a.score).map(cand => (
                                <li key={`${cand.kind}-${cand.id}`} className="flex items-start gap-3">
                                  <span className="w-10 shrink-0 text-right num text-muted">{Math.round(cand.score * 100)}%</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-ink">
                                      <span className="text-muted">{cand.kind === 'confluence' ? 'Confluence' : 'คู่มือ'} · </span>
                                      {cand.url ? <a href={cand.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{cand.title}</a> : cand.title}
                                    </span>
                                    {cand.reasons.length > 0 && <span className="block text-[12px] text-muted">{cand.reasons.join(' · ')}</span>}
                                  </span>
                                  {isSent(c, cand) ? <span className="shrink-0 text-[12px] text-ok">ส่งแล้ว</span>
                                    : canEdit && (
                                      <button onClick={() => send(c.ticketKey, cand)} disabled={busy !== null} aria-busy={busy === `send-${c.ticketKey}-${cand.id}`} className="btn shrink-0 py-1">
                                        {busy === `send-${c.ticketKey}-${cand.id}` ? 'กำลังส่ง...' : 'ส่งให้ L1'}
                                      </button>
                                    )}
                                </li>
                              ))}
                            </ul>
                            {c.detail && <p className="mt-2 text-[12px] text-faint">{c.detail} · ตรวจเมื่อ {fmtTime(c.checkedAt)}</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}
