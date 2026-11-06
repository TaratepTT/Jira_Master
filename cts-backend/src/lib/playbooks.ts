import prisma from './prisma.js'
import { normalizeText, textGrams, similarity, knownTickets, findSimilar } from './similar.js'
import { addInternalComment, fetchTicketForPlaybook, type PlaybookTicket } from './jira.js'
import { recordAudit, type AuditActor } from './audit.js'
import { confluenceCandidates, confluenceConfigured, readConfluenceSettings, type ConfluencePage } from './confluence.js'
import { aiAssistAvailable, aiCheckPages } from './aiAssist.js'
import { alert } from './alerts.js'

// ══════════════════════════════════════════════════════════════
// Playbooks (คู่มือ L1): match a ticket to a manual, post it as an internal comment
// ══════════════════════════════════════════════════════════════

// auto-send only when the match is this confident (0..1). One keyword in the summary = 0.6, so a
// keyword hit in the summary is enough; a hit only in the description needs more support.
export const AUTO_MIN_SCORE = 0.6

export interface PlaybookRow {
  id: string; title: string; confluenceUrl: string | null; steps: string; keywords: string
  typeOfIssue: string | null; system: string | null; enabled: boolean; autoSend: boolean
}

export function keywordList(k: string): string[] {
  return k.split(/[,\n]/).map(x => normalizeText(x)).filter(x => x.length >= 2)
}

function normSystem(raw: string): string {
  const u = (raw ?? '').toUpperCase()
  if (u.includes('CMP')) return 'CMP'
  if (u.includes('VMP')) return 'VMP'
  if (u.includes('TMS')) return 'CP TMS'
  return raw ?? ''
}

export interface PlaybookMatch { playbook: PlaybookRow; score: number; reasons: string[] }

/**
 * Score 0..1. A playbook needs at least one keyword in the summary/description to match
 * (or, if it has no keywords, a strong title similarity). Type of Issue / System are extra
 * conditions: when set on the playbook and different on the ticket, the playbook is skipped.
 */
export function matchPlaybooks(t: Pick<PlaybookTicket, 'summary' | 'description' | 'typeOfIssue' | 'system'>, books: PlaybookRow[]): PlaybookMatch[] {
  const summary = normalizeText(t.summary)
  const text = `${summary} ${normalizeText(t.description)}`
  const flatSummary = summary.replace(/ /g, '')
  const flatText = text.replace(/ /g, '')
  const g = textGrams(t.summary)
  const out: PlaybookMatch[] = []
  for (const b of books) {
    if (!b.enabled) continue
    if (b.typeOfIssue && t.typeOfIssue && b.typeOfIssue !== t.typeOfIssue) continue
    if (b.system && normSystem(t.system) !== b.system) continue
    const reasons: string[] = []
    const kws = keywordList(b.keywords)
    // Thai has no spaces, so compare with spaces removed
    const inSummary = kws.filter(k => flatSummary.includes(k.replace(/ /g, '')))
    const inText = kws.filter(k => !inSummary.includes(k) && flatText.includes(k.replace(/ /g, '')))
    const titleSim = similarity(g, textGrams(b.title))
    if (kws.length && !inSummary.length && !inText.length) continue
    if (!kws.length && titleSim < 0.35) continue
    let score = 0
    if (inSummary.length) { score += Math.min(0.8, 0.6 + 0.1 * (inSummary.length - 1)); reasons.push(`summary มีคำ: ${inSummary.join(', ')}`) }
    if (inText.length) { score += Math.min(0.45, 0.35 + 0.05 * (inText.length - 1)); reasons.push(`รายละเอียดมีคำ: ${inText.join(', ')}`) }
    if (titleSim >= 0.2) { score += Math.min(0.2, titleSim * 0.4); reasons.push(`summary คล้ายชื่อคู่มือ ${Math.round(titleSim * 100)}%`) }
    if (b.typeOfIssue && b.typeOfIssue === t.typeOfIssue) { score += 0.1; reasons.push(`Type of Issue ตรง (${b.typeOfIssue})`) }
    if (b.system) { score += 0.05; reasons.push(`ระบบตรง (${b.system})`) }
    out.push({ playbook: b, score: Math.min(1, score), reasons })
  }
  return out.sort((a, b) => b.score - a.score)
}

const p = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [] })

/** The internal comment: steps, Confluence link, similar solved tickets, feedback link */
export function composeComment(b: PlaybookRow, similar: Array<{ key: string; resolution: string }>, feedbackUrl: string | null): unknown {
  const steps = b.steps.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  const content: unknown[] = [
    { type: 'paragraph', content: [{ type: 'text', text: `คู่มือที่น่าจะเกี่ยวข้อง: ${b.title}`, marks: [{ type: 'strong' }] }] },
  ]
  if (steps.length) {
    content.push({
      type: 'orderedList',
      content: steps.map(s => ({ type: 'listItem', content: [p(s.replace(/^\d+[.)]\s*/, ''))] })),
    })
  }
  if (b.confluenceUrl) {
    content.push({ type: 'paragraph', content: [
      { type: 'text', text: 'คู่มือฉบับเต็ม: ' },
      { type: 'text', text: b.confluenceUrl, marks: [{ type: 'link', attrs: { href: b.confluenceUrl } }] },
    ] })
  }
  const withRes = similar.filter(s => s.resolution).slice(0, 3)
  if (withRes.length) {
    content.push(p('ticket คล้ายกันที่เคยแก้แล้ว:'))
    content.push({ type: 'bulletList', content: withRes.map(s => ({ type: 'listItem', content: [p(`${s.key}: ${s.resolution.slice(0, 200)}`)] })) })
  }
  const foot: unknown[] = [{ type: 'text', text: 'ส่งจาก CTS Dashboard (comment ภายใน ลูกค้าไม่เห็น)', marks: [{ type: 'em' }] }]
  if (feedbackUrl) {
    foot.push({ type: 'text', text: ' · ' })
    foot.push({ type: 'text', text: 'คู่มือไม่ตรงเรื่อง? แจ้งที่นี่', marks: [{ type: 'em' }, { type: 'link', attrs: { href: feedbackUrl } }] })
  }
  content.push({ type: 'paragraph', content: foot })
  return { type: 'doc', version: 1, content }
}

/** Internal comment with the Confluence pages the search found */
/**
 * Internal comment with the Confluence pages found. The first (best) page gets its steps written out:
 * steps the AI condensed from it when the AI check is on, otherwise the numbered steps in the page itself.
 */
export function composeConfluenceComment(
  pages: Array<Pick<ConfluencePage, 'title' | 'url' | 'excerpt' | 'steps'>>,
  similar: Array<{ key: string; resolution: string }>,
  feedbackUrl: string | null,
  opts: { aiSteps?: string[] } = {},
): unknown {
  const content: unknown[] = [
    { type: 'paragraph', content: [{ type: 'text', text: pages.length > 1 ? 'คู่มือใน Confluence ที่น่าจะเกี่ยวข้อง:' : 'คู่มือใน Confluence ที่น่าจะเกี่ยวข้อง', marks: [{ type: 'strong' }] }] },
  ]
  pages.forEach((pg, idx) => {
    content.push({ type: 'paragraph', content: [
      { type: 'text', text: pages.length > 1 ? `${idx + 1}. ` : '' },
      { type: 'text', text: pg.title, marks: [{ type: 'link', attrs: { href: pg.url } }] },
    ].filter(n => (n as { text: string }).text) })
    const steps = idx === 0 ? (opts.aiSteps?.length ? opts.aiSteps : pg.steps ?? []) : []
    if (steps.length) {
      content.push(p(opts.aiSteps?.length && idx === 0 ? 'ขั้นตอน (AI สรุปจากหน้านี้ ตรวจกับคู่มือก่อนทำ):' : 'ขั้นตอนจากคู่มือ:'))
      content.push({ type: 'orderedList', content: steps.map(st => ({ type: 'listItem', content: [p(st.replace(/^\d+[.)]\s*/, ''))] })) })
    } else if (pg.excerpt) {
      content.push(p(pg.excerpt.slice(0, 180) + (pg.excerpt.length > 180 ? '…' : '')))
    }
  })
  const withRes = similar.filter(x => x.resolution).slice(0, 3)
  if (withRes.length) {
    content.push(p('ticket คล้ายกันที่เคยแก้แล้ว:'))
    content.push({ type: 'bulletList', content: withRes.map(x => ({ type: 'listItem', content: [p(`${x.key}: ${x.resolution.slice(0, 200)}`)] })) })
  }
  const foot: unknown[] = [{ type: 'text', text: 'ค้นจาก Confluence อัตโนมัติโดย CTS Dashboard ตรวจว่าตรงเรื่องก่อนทำตาม (comment ภายใน ลูกค้าไม่เห็น)', marks: [{ type: 'em' }] }]
  if (feedbackUrl) {
    foot.push({ type: 'text', text: ' · ' })
    foot.push({ type: 'text', text: 'ไม่ตรงเรื่อง? แจ้งที่นี่', marks: [{ type: 'em' }, { type: 'link', attrs: { href: feedbackUrl } }] })
  }
  content.push({ type: 'paragraph', content: foot })
  return { type: 'doc', version: 1, content }
}

export const isConfluenceDelivery = (playbookId: string) => playbookId.startsWith('confluence:')

/** Post Confluence page links to a ticket. Never posts the same page twice to a ticket. */
export async function sendConfluencePages(
  ticket: PlaybookTicket, pages: ConfluencePage[], mode: 'auto' | 'manual', actor: AuditActor | undefined,
  opts: { aiSteps?: string[]; aiReason?: string } = {},
): Promise<SendResult> {
  if (!pages.length) return { ok: false, reason: 'no_match', message: 'ไม่มีหน้า Confluence ที่จะส่ง' }
  const playbookId = `confluence:${pages[0].id}`
  const title = pages.map(x => x.title).join(', ')
  let delivery
  try {
    delivery = await prisma.playbookDelivery.create({
      data: {
        playbookId, ticketKey: ticket.key, mode, score: pages[0].score, sentBy: actor?.name ?? 'อัตโนมัติ',
        pages: pages.map(x => ({ id: x.id, title: x.title, url: x.url })),
      },
    })
  } catch {
    return { ok: false, reason: 'already_sent', message: `ส่งหน้า "${pages[0].title}" ให้ ${ticket.key} ไปแล้ว` }
  }
  let similar: Array<{ key: string; resolution: string }> = []
  try { similar = findSimilar({ key: ticket.key, summary: ticket.summary, typeOfIssue: ticket.typeOfIssue }, await knownTickets(), 3) } catch { /* bonus */ }
  try {
    await addInternalComment(ticket.key, composeConfluenceComment(pages, similar, feedbackLink(delivery.id), opts))
  } catch (err) {
    await prisma.playbookDelivery.delete({ where: { id: delivery.id } }).catch(() => undefined)
    const st = (err as { response?: { status?: number } })?.response?.status
    console.error(`[playbook] confluence comment failed for ${ticket.key} (HTTP ${st ?? '-'})`)
    return { ok: false, reason: 'jira_error', message: `ใส่ comment ใน Jira ไม่สำเร็จ${st ? ` (HTTP ${st})` : ''}` }
  }
  await recordAudit(actor, {
    action: 'playbook.confluence', ticketKey: ticket.key,
    summary: `${mode === 'auto' ? 'ส่งลิงก์ Confluence อัตโนมัติ' : 'ส่งลิงก์ Confluence'} "${title}" ให้ ${ticket.key}`,
    details: { pages: pages.map(x => ({ id: x.id, title: x.title, score: Math.round(x.score * 100) / 100 })), mode, ai: !!opts.aiSteps?.length, aiReason: opts.aiReason ?? null },
  })
  return { ok: true, deliveryId: delivery.id, playbookId, title }
}

export async function loadPlaybooks(): Promise<PlaybookRow[]> {
  return prisma.playbook.findMany({ orderBy: { createdAt: 'asc' } })
}

function feedbackLink(deliveryId: string): string | null {
  const base = (process.env.FRONTEND_URL ?? (process.env.ALLOWED_ORIGINS ?? '').split(',')[0] ?? '').trim().replace(/\/+$/, '')
  return base ? `${base}/playbooks?delivery=${encodeURIComponent(deliveryId)}` : null
}

export type SendResult =
  | { ok: true; deliveryId: string; playbookId: string; title: string }
  | { ok: false; reason: 'already_sent' | 'not_found' | 'no_match' | 'low_score' | 'jira_error'; message: string }

/** Post one playbook to one ticket. Never posts the same playbook twice to a ticket. */
export async function sendPlaybook(
  ticket: PlaybookTicket, book: PlaybookRow, score: number, mode: 'auto' | 'manual', actor: AuditActor | undefined,
): Promise<SendResult> {
  const existing = await prisma.playbookDelivery.findUnique({ where: { playbookId_ticketKey: { playbookId: book.id, ticketKey: ticket.key } } })
  if (existing) return { ok: false, reason: 'already_sent', message: `ส่งคู่มือ "${book.title}" ให้ ${ticket.key} ไปแล้ว` }
  // reserve first (unique index) so two webhooks for the same ticket cannot both post
  let delivery
  try {
    delivery = await prisma.playbookDelivery.create({
      data: { playbookId: book.id, ticketKey: ticket.key, mode, score, sentBy: actor?.name ?? 'อัตโนมัติ' },
    })
  } catch {
    return { ok: false, reason: 'already_sent', message: `ส่งคู่มือ "${book.title}" ให้ ${ticket.key} ไปแล้ว` }
  }
  let similar: Array<{ key: string; resolution: string }> = []
  try {
    similar = findSimilar({ key: ticket.key, summary: ticket.summary, typeOfIssue: ticket.typeOfIssue }, await knownTickets(), 3)
  } catch { /* similar tickets are a bonus */ }
  try {
    await addInternalComment(ticket.key, composeComment(book, similar, feedbackLink(delivery.id)))
  } catch (err) {
    await prisma.playbookDelivery.delete({ where: { id: delivery.id } }).catch(() => undefined)
    const st = (err as { response?: { status?: number } })?.response?.status
    console.error(`[playbook] comment failed for ${ticket.key} (HTTP ${st ?? '-'})`)
    return { ok: false, reason: 'jira_error', message: `ใส่ comment ใน Jira ไม่สำเร็จ${st ? ` (HTTP ${st})` : ''}` }
  }
  await recordAudit(actor, {
    action: 'playbook.send', ticketKey: ticket.key,
    summary: `${mode === 'auto' ? 'ส่งคู่มืออัตโนมัติ' : 'ส่งคู่มือ'} "${book.title}" ให้ ${ticket.key}`,
    details: { playbookId: book.id, score: Math.round(score * 100) / 100, mode },
  })
  return { ok: true, deliveryId: delivery.id, playbookId: book.id, title: book.title }
}

// ══════════════════════════════════════════════════════════════
// One ticket, start to finish: read it from Jira, match playbooks, recheck Confluence pages,
// decide, send if allowed, and record the decision (ticket_checks) for the คู่มือ L1 page.
// ══════════════════════════════════════════════════════════════

export type Decision = 'sent_playbook' | 'sent_confluence' | 'suggested' | 'low_confidence' | 'no_match' | 'already_sent' | 'error'
export interface Candidate { kind: 'playbook' | 'confluence'; id: string; title: string; url: string | null; score: number; reasons: string[]; autoSend?: boolean }
export interface CheckResult { key: string; decision: Decision; detail: string; candidates: Candidate[]; send?: SendResult }

const DECISION_TEXT: Record<Decision, string> = {
  sent_playbook: 'ส่งคู่มือแล้ว', sent_confluence: 'ส่งลิงก์ Confluence แล้ว', suggested: 'ตรงพอ แต่ยังไม่ได้เปิดส่งอัตโนมัติ',
  low_confidence: 'มีหน้าที่ใกล้เคียง แต่ไม่ตรงพอจะส่งเอง', no_match: 'ไม่พบคู่มือที่เกี่ยวข้อง', already_sent: 'เคยส่งคู่มือแล้ว', error: 'ตรวจไม่สำเร็จ',
}
export const decisionText = (d: string) => DECISION_TEXT[d as Decision] ?? d

/** Everything that could help with this ticket, best first (no sending) */
export async function evaluateTicket(ticket: PlaybookTicket): Promise<{ candidates: Candidate[]; pages: ConfluencePage[]; best: PlaybookMatch | undefined; cfError?: string }> {
  const books = await loadPlaybooks()
  const matches = matchPlaybooks(ticket, books)
  let pages: ConfluencePage[] = []
  let cfError: string | undefined
  if (confluenceConfigured()) {
    try {
      const cs = await readConfluenceSettings()
      pages = await confluenceCandidates(ticket.summary, ticket.description, cs.spaces)
    } catch (err) {
      const st = (err as { response?: { status?: number } })?.response?.status
      cfError = `ค้น Confluence ไม่สำเร็จ${st ? ` (HTTP ${st})` : ''}`
    }
  }
  if (confluenceConfigured()) await alert.report('confluence', !cfError, cfError)
  const candidates: Candidate[] = [
    ...matches.slice(0, 3).map(m => ({ kind: 'playbook' as const, id: m.playbook.id, title: m.playbook.title, url: m.playbook.confluenceUrl, score: m.score, reasons: m.reasons, autoSend: m.playbook.autoSend })),
    ...pages.map(pg => ({ kind: 'confluence' as const, id: pg.id, title: pg.title, url: pg.url, score: pg.score, reasons: pg.reasons ?? [] })),
  ]
  return { candidates, pages, best: matches[0], cfError }
}

const processing = new Set<string>()

/**
 * mode 'auto'  : send when the rules allow it (watcher, webhook)
 * mode 'check' : only look and record (the "ตรวจใหม่" button)
 */
export async function processTicket(key: string, trigger: 'watch' | 'webhook' | 'manual', mode: 'auto' | 'check' = 'auto'): Promise<CheckResult> {
  if (processing.has(key)) return { key, decision: 'already_sent', detail: 'กำลังตรวจอยู่', candidates: [] }
  processing.add(key)
  const record = async (r: CheckResult, ticket?: PlaybookTicket) => {
    const created = ticket?.created ? new Date(ticket.created) : null
    const data = {
      summary: (ticket?.summary ?? '').slice(0, 500), decision: r.decision, detail: r.detail.slice(0, 500),
      candidates: r.candidates.slice(0, 6) as unknown as object, trigger,
      ticketCreatedAt: created && !isNaN(created.getTime()) ? created : null, checkedAt: new Date(),
    }
    await prisma.ticketCheck.upsert({ where: { ticketKey: key }, create: { ticketKey: key, ...data }, update: data }).catch(err => {
      console.error('[playbook] could not record check:', (err as Error)?.message)
    })
    return r
  }
  try {
    const ticket = await fetchTicketForPlaybook(key)
    if (!ticket) return await record({ key, decision: 'error', detail: 'ไม่พบ ticket ใน Jira', candidates: [] })
    const { candidates, pages, best, cfError } = await evaluateTicket(ticket)
    const sentBefore = await prisma.playbookDelivery.findFirst({ where: { ticketKey: key } })
    const cs = await readConfluenceSettings()
    const goodPages = pages.filter(x => x.score >= cs.minScore).slice(0, cs.maxLinks)
    const bookOk = !!best && best.score >= AUTO_MIN_SCORE

    if (mode === 'auto' && !sentBefore) {
      // 1) a playbook written for this kind of ticket wins, 2) then the rechecked Confluence pages
      if (bookOk && best!.playbook.autoSend) {
        const send = await sendPlaybook(ticket, best!.playbook, best!.score, 'auto', undefined)
        return await record({ key, decision: send.ok ? 'sent_playbook' : 'error', detail: send.ok ? `ส่ง "${best!.playbook.title}"` : send.message, candidates, send }, ticket)
      }
      if (cs.autoSend && goodPages.length) {
        // optional AI check: confirm which page really fits and condense its steps
        let toSend = goodPages
        let aiSteps: string[] | undefined, aiReason: string | undefined, aiNote = ''
        if (cs.aiAssist && aiAssistAvailable()) {
          const ai = await aiCheckPages(ticket, goodPages)
          if (ai.ok && !ai.verdict.relevant) {
            const c2 = candidates.map(c => (c.kind === 'confluence' ? { ...c, reasons: [...c.reasons, `AI: ${ai.verdict.reason || 'ไม่ตรงกับปัญหา'}`] } : c))
            return await record({ key, decision: 'low_confidence', detail: `AI ตรวจแล้วว่าหน้าที่เจอไม่ตรงกับปัญหา: ${ai.verdict.reason}`, candidates: c2 }, ticket)
          }
          if (ai.ok) {
            const pick = goodPages.find(x => x.id === ai.verdict.pageId)!
            toSend = [pick, ...goodPages.filter(x => x.id !== pick.id)].slice(0, cs.maxLinks)
            aiSteps = ai.verdict.steps; aiReason = ai.verdict.reason; aiNote = ' (AI ยืนยันแล้ว)'
          } else {
            aiNote = ` (AI ใช้ไม่ได้: ${ai.error} ใช้ผลจากระบบแทน)`
          }
        }
        const send = await sendConfluencePages(ticket, toSend, 'auto', undefined, { aiSteps, aiReason })
        return await record({ key, decision: send.ok ? 'sent_confluence' : 'error', detail: send.ok ? `ส่ง ${toSend.map(x => `"${x.title}"`).join(', ')}${aiNote}` : send.message, candidates, send }, ticket)
      }
    }
    if (sentBefore) return await record({ key, decision: 'already_sent', detail: 'ticket นี้ได้คู่มือไปแล้ว', candidates }, ticket)
    if (bookOk || goodPages.length) {
      const what = bookOk ? `คู่มือ "${best!.playbook.title}"` : `หน้า "${goodPages[0].title}"`
      return await record({ key, decision: 'suggested', detail: `${what} ตรงพอ${mode === 'check' ? '' : ' แต่ยังไม่ได้เปิดส่งอัตโนมัติ'}`, candidates }, ticket)
    }
    if (candidates.length) return await record({ key, decision: 'low_confidence', detail: `ใกล้สุด ${Math.round(Math.max(...candidates.map(c => c.score)) * 100)}% ต่ำกว่าเกณฑ์`, candidates }, ticket)
    return await record({ key, decision: cfError ? 'error' : 'no_match', detail: cfError ?? 'ไม่พบคู่มือหรือหน้า Confluence ที่เกี่ยวข้อง', candidates }, ticket)
  } catch (err) {
    const st = (err as { response?: { status?: number } })?.response?.status
    return await record({ key, decision: 'error', detail: `อ่าน ticket จาก Jira ไม่สำเร็จ${st ? ` (HTTP ${st})` : ''}`, candidates: [] })
  } finally {
    processing.delete(key)
  }
}
