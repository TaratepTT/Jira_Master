import { Router, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { recordAudit } from '../lib/audit.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { fetchTicketForPlaybook } from '../lib/jira.js'
import {
  AUTO_MIN_SCORE, composeComment, composeConfluenceComment, decisionText, isConfluenceDelivery, loadPlaybooks, matchPlaybooks,
  processTicket, sendConfluencePages, sendPlaybook, type PlaybookRow,
} from '../lib/playbooks.js'
import { confluenceCandidates, confluenceConfigured, confluenceSite, readConfluenceSettings, resolveRootPage, testConfluenceConnection, type ConfluencePage, type RootPage } from '../lib/confluence.js'
import { runWatchOnce, watchState } from '../lib/watcher.js'
import { findSimilar, knownTickets } from '../lib/similar.js'

// คู่มือ L1 (playbooks). Mounted behind requireAuth + withUserJira at /api/playbooks.
//   GET    /                       list + stats              (any user)
//   POST   /                       create                    (editor/admin)
//   PUT    /:id                    update                    (editor/admin)
//   DELETE /:id                    delete                    (editor/admin)
//   POST   /test                   { summary, description?, typeOfIssue?, system? } -> matches + comment preview
//   GET    /ticket/:key            matches for one ticket + deliveries already sent
//   POST   /ticket/:key/send       { playbookId }  -> internal comment in Jira (editor/admin)
//   GET    /deliveries/:id         one delivery (feedback landing page)
//   PATCH  /deliveries/:id         { feedback: 'helpful' | 'wrong' | null }
//   GET    /confluence/settings    Confluence search settings + whether the server has credentials
//   PUT    /confluence/settings    { autoSend, minScore, maxLinks, spaces }   (admin)
//   POST   /confluence/check       try the Confluence credentials             (admin)
//   POST   /ticket/:key/confluence { pageId } -> internal comment with that page (editor/admin)
//   GET    /checks                 new tickets the watcher looked at + watcher status
//   POST   /checks/run             pull new tickets from Jira now (editor/admin)
//   POST   /checks/:key/recheck    look at one ticket again, without sending (editor/admin)
const router = Router()

const canEdit = (req: AuthedRequest) => req.user?.role === 'editor' || req.user?.role === 'admin'
const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/
const SYSTEMS = ['CMP', 'VMP', 'CP TMS']

type DeliveryRow = { playbookId: string; pages?: unknown }
function deliveryTitle(d: DeliveryRow, books: PlaybookRow[]): string {
  if (isConfluenceDelivery(d.playbookId)) {
    const pages = Array.isArray(d.pages) ? (d.pages as Array<{ title?: string }>) : []
    return `Confluence: ${pages.map(x => x.title).filter(Boolean).join(', ') || 'หน้าที่ค้นเจอ'}`
  }
  return books.find(b => b.id === d.playbookId)?.title ?? '(ลบแล้ว)'
}

/** Confluence results for a ticket; never throws (search errors become a message) */
async function confluenceFor(summary: string, description: string): Promise<{ configured: boolean; pages: ConfluencePage[]; error?: string; minScore: number; autoSend: boolean }> {
  const cs = await readConfluenceSettings()
  if (!confluenceConfigured()) return { configured: false, pages: [], minScore: cs.minScore, autoSend: cs.autoSend }
  try {
    return { configured: true, pages: await confluenceCandidates(summary, description, cs.spaces), minScore: cs.minScore, autoSend: cs.autoSend }
  } catch (err) {
    const st = (err as { response?: { status?: number } })?.response?.status
    return { configured: true, pages: [], error: `ค้น Confluence ไม่สำเร็จ${st ? ` (HTTP ${st})` : ''}`, minScore: cs.minScore, autoSend: cs.autoSend }
  }
}

function clean(body: unknown): { ok: true; data: Omit<PlaybookRow, 'id'> } | { ok: false; message: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const title = s(b.title, 200)
  if (!title) return { ok: false, message: 'ใส่ชื่อคู่มือ' }
  const steps = s(b.steps, 8000)
  const keywords = s(b.keywords, 1000)
  const confluenceUrl = s(b.confluenceUrl, 1000) || null
  if (confluenceUrl && !/^https:\/\//i.test(confluenceUrl)) return { ok: false, message: 'ลิงก์ Confluence ต้องขึ้นต้นด้วย https://' }
  if (!steps && !confluenceUrl) return { ok: false, message: 'ใส่ขั้นตอน หรือ ลิงก์ Confluence อย่างน้อยหนึ่งอย่าง' }
  const system = s(b.system, 40) || null
  if (system && !SYSTEMS.includes(system)) return { ok: false, message: 'ระบบไม่ถูกต้อง' }
  return {
    ok: true,
    data: {
      title, steps, keywords, confluenceUrl, system,
      typeOfIssue: s(b.typeOfIssue, 100) || null,
      enabled: b.enabled !== false,
      autoSend: b.autoSend === true,
    },
  }
}

const errMsg = (err: unknown) => {
  const code = (err as { code?: string })?.code
  return code === 'P2021' || code === 'P2022' ? 'ยังไม่ได้สร้างตารางคู่มือในฐานข้อมูล (รัน npx prisma db push)' : null
}

router.get('/', async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const books = await loadPlaybooks()
    const deliveries = await prisma.playbookDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: 2000 })
    const keys = Array.from(new Set(deliveries.map(d => d.ticketKey)))
    const tickets = keys.length
      ? await prisma.ticket.findMany({ where: { key: { in: keys } }, select: { key: true, escalation: true, status: true }, orderBy: { id: 'desc' } })
      : []
    const latest = new Map<string, { escalation: string | null; status: string }>()
    for (const t of tickets) if (!latest.has(t.key)) latest.set(t.key, { escalation: t.escalation ?? null, status: t.status })
    const stats = books.map(b => {
      const ds = deliveries.filter(d => d.playbookId === b.id)
      const known = ds.map(d => latest.get(d.ticketKey)?.escalation).filter((x): x is string => !!x)
      return {
        id: b.id,
        sent: ds.length,
        auto: ds.filter(d => d.mode === 'auto').length,
        helpful: ds.filter(d => d.feedback === 'helpful').length,
        wrong: ds.filter(d => d.feedback === 'wrong').length,
        knownLevel: known.length,
        stayedL1: known.filter(l => l === 'L1').length,
        lastSentAt: ds[0]?.createdAt ?? null,
      }
    })
    const cds = deliveries.filter(d => isConfluenceDelivery(d.playbookId))
    const cKnown = cds.map(d => latest.get(d.ticketKey)?.escalation).filter((x): x is string => !!x)
    const confluenceStats = {
      sent: cds.length, auto: cds.filter(d => d.mode === 'auto').length,
      helpful: cds.filter(d => d.feedback === 'helpful').length, wrong: cds.filter(d => d.feedback === 'wrong').length,
      knownLevel: cKnown.length, stayedL1: cKnown.filter(l => l === 'L1').length,
    }
    const cs = await readConfluenceSettings()
    const recent = deliveries.slice(0, 30).map(d => ({
      ...d, title: deliveryTitle(d, books),
      escalation: latest.get(d.ticketKey)?.escalation ?? null,
    }))
    res.json({
      playbooks: books, stats, recent, autoMinScore: AUTO_MIN_SCORE, webhookEnabled: !!process.env.JIRA_WEBHOOK_SECRET, watch: watchState(),
      confluence: { configured: confluenceConfigured(), site: confluenceSite() || null, settings: cs, stats: confluenceStats },
    })
  } catch (err) {
    const m = errMsg(err); if (m) { res.status(503).json({ message: m }); return }
    next(err)
  }
})

router.post('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!canEdit(req)) { res.status(403).json({ message: 'ไม่มีสิทธิ์แก้คู่มือ' }); return }
    const c = clean(req.body)
    if (!c.ok) { res.status(400).json({ message: c.message }); return }
    const row = await prisma.playbook.create({ data: { ...c.data, createdBy: req.user!.name } })
    await recordAudit(req.user, { action: 'playbook.create', summary: `สร้างคู่มือ "${row.title}"`, details: { id: row.id } })
    res.status(201).json(row)
  } catch (err) { next(err) }
})

router.post('/test', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>
    const t = {
      summary: String(b.summary ?? '').slice(0, 500), description: String(b.description ?? '').slice(0, 4000),
      typeOfIssue: String(b.typeOfIssue ?? ''), system: String(b.system ?? ''),
    }
    if (!t.summary.trim()) { res.status(400).json({ message: 'ใส่ summary ที่จะทดสอบ' }); return }
    const matches = matchPlaybooks(t, await loadPlaybooks())
    let similar: Array<{ key: string; resolution: string }> = []
    try { similar = findSimilar({ key: '', summary: t.summary, typeOfIssue: t.typeOfIssue }, await knownTickets(), 3) } catch { /* optional */ }
    const autoBook = matches.find(m => m.playbook.autoSend && m.score >= AUTO_MIN_SCORE)
    const cf = await confluenceFor(t.summary, t.description)
    const cs = await readConfluenceSettings()
    const cfAuto = cf.pages.filter(x => x.score >= cf.minScore).slice(0, cs.maxLinks)
    // what the automatic run would do: playbook first, then Confluence
    const wouldSend = autoBook ? 'playbook' : cf.autoSend && cfAuto.length ? 'confluence' : null
    res.json({
      matches: matches.slice(0, 5).map(m => ({ playbookId: m.playbook.id, title: m.playbook.title, score: m.score, reasons: m.reasons, autoSend: m.playbook.autoSend })),
      confluence: cf,
      preview: autoBook ? composeComment(autoBook.playbook, similar, null)
        : cfAuto.length ? composeConfluenceComment(cfAuto, similar, null)
        : matches[0] ? composeComment(matches[0].playbook, similar, null)
        : cf.pages[0] ? composeConfluenceComment([cf.pages[0]], similar, null) : null,
      wouldAutoSend: !!wouldSend,
      wouldSend,
    })
  } catch (err) { next(err) }
})

router.get('/ticket/:key', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const key = String(req.params.key).toUpperCase()
    if (!KEY_RE.test(key)) { res.status(400).json({ message: 'ticket key ไม่ถูกต้อง' }); return }
    const books = await loadPlaybooks()
    const sent = await prisma.playbookDelivery.findMany({ where: { ticketKey: key }, orderBy: { createdAt: 'desc' } })
    // prefer the live ticket (description helps matching); fall back to what the report has
    let t: { summary: string; description: string; typeOfIssue: string; system: string } | null = null
    try { t = await fetchTicketForPlaybook(key) } catch { /* Jira down -> stored data */ }
    if (!t) {
      const row = await prisma.ticket.findFirst({ where: { key }, orderBy: { id: 'desc' } })
      if (row) t = { summary: row.summary ?? '', description: '', typeOfIssue: row.typeOfIssue ?? '', system: row.system ?? '' }
    }
    const matches = t ? matchPlaybooks(t, books) : []
    const cf = t ? await confluenceFor(t.summary, t.description) : { configured: confluenceConfigured(), pages: [] }
    res.json({
      matches: matches.slice(0, 3).map(m => ({ playbookId: m.playbook.id, title: m.playbook.title, score: m.score, reasons: m.reasons, confluenceUrl: m.playbook.confluenceUrl })),
      confluence: { ...cf, pages: cf.pages.slice(0, 3) },
      sent: sent.map(d => ({ ...d, title: deliveryTitle(d, books) })),
      hasPlaybooks: books.some(b => b.enabled) || cf.configured,
    })
  } catch (err) {
    const m = errMsg(err); if (m) { res.json({ matches: [], sent: [], hasPlaybooks: false, confluence: { configured: false, pages: [] }, setupNeeded: m }); return }
    next(err)
  }
})

router.post('/ticket/:key/send', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!canEdit(req)) { res.status(403).json({ message: 'ไม่มีสิทธิ์ส่งคู่มือ' }); return }
    const key = String(req.params.key).toUpperCase()
    if (!KEY_RE.test(key)) { res.status(400).json({ message: 'ticket key ไม่ถูกต้อง' }); return }
    const id = String((req.body as { playbookId?: unknown })?.playbookId ?? '')
    const book = await prisma.playbook.findUnique({ where: { id } })
    if (!book) { res.status(404).json({ message: 'ไม่พบคู่มือ' }); return }
    const ticket = await fetchTicketForPlaybook(key)
    if (!ticket) { res.status(404).json({ message: `ไม่พบ ${key} ใน Jira` }); return }
    const score = matchPlaybooks(ticket, [{ ...book, enabled: true }])[0]?.score ?? 0
    const r = await sendPlaybook(ticket, book, score, 'manual', req.user)
    if (!r.ok) { res.status(r.reason === 'already_sent' ? 409 : 502).json({ message: r.message }); return }
    res.status(201).json(r)
  } catch (err) { next(err) }
})

router.get('/deliveries/:id', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const d = await prisma.playbookDelivery.findUnique({ where: { id: String(req.params.id) } })
    if (!d) { res.status(404).json({ message: 'ไม่พบรายการส่งคู่มือนี้' }); return }
    const b = isConfluenceDelivery(d.playbookId) ? null : await prisma.playbook.findUnique({ where: { id: d.playbookId } })
    res.json({ ...d, title: deliveryTitle(d, b ? [b] : []) })
  } catch (err) { next(err) }
})

router.patch('/deliveries/:id', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const raw = (req.body as { feedback?: unknown })?.feedback
    const feedback = raw === 'helpful' || raw === 'wrong' ? raw : null
    if (raw !== null && raw !== undefined && !feedback) { res.status(400).json({ message: 'feedback ต้องเป็น helpful หรือ wrong' }); return }
    const d = await prisma.playbookDelivery.findUnique({ where: { id: String(req.params.id) } })
    if (!d) { res.status(404).json({ message: 'ไม่พบรายการส่งคู่มือนี้' }); return }
    const row = await prisma.playbookDelivery.update({ where: { id: d.id }, data: { feedback, feedbackBy: feedback ? req.user!.name : null } })
    await recordAudit(req.user, { action: 'playbook.feedback', ticketKey: d.ticketKey, summary: `ให้ feedback คู่มือใน ${d.ticketKey}: ${feedback === 'helpful' ? 'ช่วยได้' : feedback === 'wrong' ? 'ไม่ตรงเรื่อง' : 'ล้างค่า'}` })
    res.json(row)
  } catch (err) { next(err) }
})

router.get('/checks', async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const checks = await prisma.ticketCheck.findMany({ orderBy: { checkedAt: 'desc' }, take: 60 })
    const keys = checks.map(c => c.ticketKey)
    const sent = keys.length ? await prisma.playbookDelivery.findMany({ where: { ticketKey: { in: keys } } }) : []
    const books = await loadPlaybooks()
    res.json({
      watch: watchState(),
      webhookEnabled: !!process.env.JIRA_WEBHOOK_SECRET,
      checks: checks.map(c => ({
        ...c, decisionText: decisionText(c.decision),
        sent: sent.filter(d => d.ticketKey === c.ticketKey).map(d => ({ id: d.id, playbookId: d.playbookId, title: deliveryTitle(d, books), mode: d.mode, feedback: d.feedback, pages: d.pages })),
      })),
    })
  } catch (err) {
    const m = errMsg(err); if (m) { res.json({ watch: watchState(), webhookEnabled: !!process.env.JIRA_WEBHOOK_SECRET, checks: [], setupNeeded: m }); return }
    next(err)
  }
})

router.post('/checks/run', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!canEdit(req)) { res.status(403).json({ message: 'ไม่มีสิทธิ์' }); return }
    if (!watchState().enabled) { res.status(400).json({ message: 'ตัวดึง ticket ปิดอยู่ (PLAYBOOK_WATCH=off หรือยังไม่ได้ตั้ง JIRA_API_TOKEN)' }); return }
    res.json({ watch: await runWatchOnce() })
  } catch (err) { next(err) }
})

router.post('/checks/:key/recheck', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!canEdit(req)) { res.status(403).json({ message: 'ไม่มีสิทธิ์' }); return }
    const key = String(req.params.key).toUpperCase()
    if (!KEY_RE.test(key)) { res.status(400).json({ message: 'ticket key ไม่ถูกต้อง' }); return }
    const r = await processTicket(key, 'manual', 'check')
    res.json({ ...r, decisionText: decisionText(r.decision) })
  } catch (err) { next(err) }
})

router.get('/confluence/settings', async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try { res.json({ configured: confluenceConfigured(), site: confluenceSite() || null, settings: await readConfluenceSettings() }) } catch (err) { next(err) }
})

router.put('/confluence/settings', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'admin') { res.status(403).json({ message: 'ตั้งค่าการค้น Confluence ได้เฉพาะ admin' }); return }
    const b = (req.body ?? {}) as Record<string, unknown>
    const minScore = Number(b.minScore), maxLinks = Number(b.maxLinks)
    if (!Number.isFinite(minScore) || minScore < 0.2 || minScore > 0.95) { res.status(400).json({ message: 'เกณฑ์ความตรงต้องอยู่ระหว่าง 20–95%' }); return }
    if (!Number.isInteger(maxLinks) || maxLinks < 1 || maxLinks > 3) { res.status(400).json({ message: 'จำนวนลิงก์ต้องเป็น 1–3' }); return }
    const spacesRaw = Array.isArray(b.spaces) ? b.spaces : String(b.spaces ?? '').split(',')
    const spaces = spacesRaw.map(x => String(x).trim().toUpperCase()).filter(Boolean)
    if (spaces.some(x => !/^~?[A-Z0-9_]{1,64}$/.test(x))) { res.status(400).json({ message: 'space key ใช้ได้แค่ A–Z, 0–9 และ _' }); return }
    // roots: page links / titles / ids; resolve new ones, keep already-resolved ones as they are
    const before0 = await readConfluenceSettings()
    // roots left out = keep the current ones
    const rawRoots = b.roots === undefined ? before0.roots.map(r => r.id) : Array.isArray(b.roots) ? b.roots : String(b.roots ?? '').split('\n')
    const rootInputs = rawRoots
      .map(x => (x && typeof x === 'object' && 'id' in (x as object) ? String((x as RootPage).id) : String(x ?? '').trim()))
      .filter(Boolean).slice(0, 10)
    const roots: RootPage[] = []
    for (const input of rootInputs) {
      const known = before0.roots.find(r => r.id === input || r.title === input || r.url === input)
      if (known) { if (!roots.some(x => x.id === known.id)) roots.push(known); continue }
      if (!confluenceConfigured()) { res.status(400).json({ message: 'ยังไม่ได้เชื่อม Confluence จึงตรวจหน้าไม่ได้' }); return }
      const r = await resolveRootPage(input, spaces)
      if ('error' in r) { res.status(400).json({ message: r.error }); return }
      if (!roots.some(x => x.id === r.id)) roots.push(r)
    }
    const value = { autoSend: b.autoSend === true, minScore: Math.round(minScore * 100) / 100, maxLinks, spaces, roots: roots.map(r => ({ id: r.id, title: r.title, url: r.url })) }
    const before = await readConfluenceSettings()
    await prisma.appSetting.upsert({
      where: { key: 'confluence' },
      create: { key: 'confluence', value, updatedBy: req.user.name },
      update: { value, updatedBy: req.user.name },
    })
    await recordAudit(req.user, { action: 'settings.confluence', summary: `ตั้งค่าค้น Confluence: ${value.autoSend ? 'ส่งอัตโนมัติ' : 'ไม่ส่งอัตโนมัติ'}, เกณฑ์ ${Math.round(value.minScore * 100)}%${roots.length ? `, เฉพาะใต้ ${roots.map(r => r.title).join(', ')}` : ''}`, details: { before, after: value } })
    res.json({ configured: confluenceConfigured(), site: confluenceSite() || null, settings: await readConfluenceSettings() })
  } catch (err) {
    const m = errMsg(err); if (m) { res.status(503).json({ message: m }); return }
    next(err)
  }
})

router.post('/confluence/check', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'admin') { res.status(403).json({ message: 'เฉพาะ admin' }); return }
    res.json(await testConfluenceConnection())
  } catch (err) { next(err) }
})

router.post('/ticket/:key/confluence', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!canEdit(req)) { res.status(403).json({ message: 'ไม่มีสิทธิ์ส่งคู่มือ' }); return }
    const key = String(req.params.key).toUpperCase()
    if (!KEY_RE.test(key)) { res.status(400).json({ message: 'ticket key ไม่ถูกต้อง' }); return }
    if (!confluenceConfigured()) { res.status(400).json({ message: 'ยังไม่ได้เชื่อม Confluence' }); return }
    const pageId = String((req.body as { pageId?: unknown })?.pageId ?? '')
    const ticket = await fetchTicketForPlaybook(key)
    if (!ticket) { res.status(404).json({ message: `ไม่พบ ${key} ใน Jira` }); return }
    // only pages the search actually returned for this ticket can be sent (no arbitrary links)
    const page = (await confluenceCandidates(ticket.summary, ticket.description)).find(x => x.id === pageId)
    if (!page) { res.status(404).json({ message: 'ไม่พบหน้านี้ในผลค้นของ ticket นี้' }); return }
    const r = await sendConfluencePages(ticket, [page], 'manual', req.user)
    if (!r.ok) { res.status(r.reason === 'already_sent' ? 409 : 502).json({ message: r.message }); return }
    res.status(201).json(r)
  } catch (err) { next(err) }
})

router.put('/:id', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!canEdit(req)) { res.status(403).json({ message: 'ไม่มีสิทธิ์แก้คู่มือ' }); return }
    const c = clean(req.body)
    if (!c.ok) { res.status(400).json({ message: c.message }); return }
    const existing = await prisma.playbook.findUnique({ where: { id: String(req.params.id) } })
    if (!existing) { res.status(404).json({ message: 'ไม่พบคู่มือ' }); return }
    const row = await prisma.playbook.update({ where: { id: existing.id }, data: c.data })
    await recordAudit(req.user, { action: 'playbook.update', summary: `แก้คู่มือ "${row.title}"`, details: { id: row.id, autoSend: row.autoSend, enabled: row.enabled } })
    res.json(row)
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!canEdit(req)) { res.status(403).json({ message: 'ไม่มีสิทธิ์ลบคู่มือ' }); return }
    const existing = await prisma.playbook.findUnique({ where: { id: String(req.params.id) } })
    if (!existing) { res.status(404).json({ message: 'ไม่พบคู่มือ' }); return }
    await prisma.playbook.delete({ where: { id: existing.id } })
    await recordAudit(req.user, { action: 'playbook.delete', summary: `ลบคู่มือ "${existing.title}"`, details: { id: existing.id } })
    res.status(204).end()
  } catch (err) { next(err) }
})

export default router
