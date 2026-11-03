'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getTicketPlaybooks, sendTicketConfluence, sendTicketPlaybook, type ConfluencePage, type PlaybookDelivery, type PlaybookMatch } from '@/lib/api'

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback

// "คู่มือที่แนะนำ" in the ticket window: what was already sent, and a button to send a match
// as an INTERNAL Jira comment (customers on the portal never see it).
export default function TicketPlaybooks({ ticketKey, canSend }: { ticketKey: string; canSend: boolean }) {
  const [matches, setMatches] = useState<PlaybookMatch[] | null>(null)
  const [sent, setSent] = useState<PlaybookDelivery[]>([])
  const [pages, setPages] = useState<ConfluencePage[]>([])
  const [hasPlaybooks, setHasPlaybooks] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let live = true
    setMatches(null); setMsg(null)
    getTicketPlaybooks(ticketKey)
      .then(r => { if (!live) return; setMatches(r.matches); setPages(r.confluence?.pages ?? []); setSent(r.sent); setHasPlaybooks(r.hasPlaybooks) })
      .catch(() => { if (live) { setMatches([]); setHasPlaybooks(false) } })
    return () => { live = false }
  }, [ticketKey])

  const send = async (m: { id: string; title: string; confluence?: boolean }) => {
    if (!confirm(`ใส่${m.confluence ? 'ลิงก์ Confluence' : 'คู่มือ'} "${m.title}" เป็น comment ภายในของ ${ticketKey}?`)) return
    setBusy(m.id); setMsg(null)
    try {
      if (m.confluence) await sendTicketConfluence(ticketKey, m.id)
      else await sendTicketPlaybook(ticketKey, m.id)
      const r = await getTicketPlaybooks(ticketKey)
      setSent(r.sent)
      setMsg({ ok: true, text: 'ใส่ comment ภายในใน Jira แล้ว' })
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, 'ส่งไม่สำเร็จ') })
    } finally { setBusy(null) }
  }

  if (matches === null) return <div className="h-10 animate-pulse rounded-md bg-sunken" />
  if (!hasPlaybooks && sent.length === 0) return null
  const sentIds = new Set(sent.map(s => s.playbookId))
  const unsent = matches.filter(m => !sentIds.has(m.playbookId))
  const sentPages = new Set(sent.flatMap(d => (Array.isArray(d.pages) ? d.pages.map(x => x.id) : [])))
  const unsentPages = pages.filter(pg => !sentPages.has(pg.id))
  if (sent.length === 0 && unsent.length === 0 && unsentPages.length === 0) return null

  return (
    <section className="border-t border-line pt-4" aria-labelledby="pb-title" data-testid="ticket-playbooks">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 id="pb-title" className="text-[13px] font-semibold text-ink">คู่มือ L1</h3>
        <Link href="/playbooks" className="text-[12px] text-faint hover:text-accent">จัดการคู่มือ</Link>
      </div>
      {sent.length > 0 && (
        <ul className="mb-2 space-y-1">
          {sent.map(s => (
            <li key={s.id} className="text-[13px] text-muted">
              <span className="text-ok">ส่งแล้ว</span> {s.title}, {s.mode === 'auto' ? 'อัตโนมัติ' : `โดย ${s.sentBy}`}{' '}
              {new Date(s.createdAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              {s.feedback && <span className={s.feedback === 'helpful' ? 'text-ok' : 'text-danger'}> · L1 บอกว่า{s.feedback === 'helpful' ? 'ตรง' : 'ไม่ตรง'}</span>}
            </li>
          ))}
        </ul>
      )}
      {unsent.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {unsent.map(m => (
            <li key={m.playbookId} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-10 shrink-0 text-right text-[12px] text-faint num" title="ความตรงของคู่มือ">{Math.round(m.score * 100)}%</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink">{m.title}</span>
                <span className="block truncate text-[12px] text-muted">{m.reasons.join(' · ')}</span>
              </span>
              {m.confluenceUrl && <a href={m.confluenceUrl} target="_blank" rel="noreferrer" className="btn-quiet shrink-0">เปิด</a>}
              {canSend && (
                <button onClick={() => send({ id: m.playbookId, title: m.title })} disabled={busy !== null} aria-busy={busy === m.playbookId} className="btn shrink-0 py-1">
                  {busy === m.playbookId ? 'กำลังส่ง...' : 'ส่งให้ L1 ใน Jira'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {unsentPages.length > 0 && (
        <div className="mt-2" data-testid="ticket-confluence">
          <p className="mb-1 text-[12px] text-muted">ค้นเจอใน Confluence</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {unsentPages.map(pg => (
              <li key={pg.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-10 shrink-0 text-right text-[12px] text-faint num" title="ความตรงของหน้า">{Math.round(pg.score * 100)}%</span>
                <span className="min-w-0 flex-1">
                  <a href={pg.url} target="_blank" rel="noreferrer" className="block truncate text-[13px] text-accent hover:underline">{pg.title}</a>
                  {pg.excerpt && <span className="block truncate text-[12px] text-muted">{pg.excerpt}</span>}
                </span>
                {canSend && (
                  <button onClick={() => send({ id: pg.id, title: pg.title, confluence: true })} disabled={busy !== null} aria-busy={busy === pg.id} className="btn shrink-0 py-1">
                    {busy === pg.id ? 'กำลังส่ง...' : 'ส่งลิงก์ให้ L1'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-1.5 text-[12px] text-faint">ส่งเป็น comment ภายใน ลูกค้าไม่เห็น</p>
      {msg && <p className={`mt-1 text-[12px] ${msg.ok ? 'text-ok' : 'text-danger'}`} role={msg.ok ? undefined : 'alert'}>{msg.text}</p>}
    </section>
  )
}
