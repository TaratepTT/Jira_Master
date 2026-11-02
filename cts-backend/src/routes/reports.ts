import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import {
  pushTicketUpdateToJira, fetchAllowedStatuses, normalizeDeployDate, fetchLiveStatus, fetchIssuesByKeys,
  fetchExtraFields, prepareExtraFieldUpdate, EXTRA_FIELD_NAMES,
  type JiraUpdateInput, type ExtraFieldInput,
} from '../lib/jira.js'
import { recordAudit, diffFields, clip, type AuditEntry } from '../lib/audit.js'
import { randomUUID } from 'node:crypto'
import { fetchJiraComments, fetchJiraChangelog, addJiraComment } from '../lib/jira.js'
import { fetchJiraAttachments, downloadJiraAttachment } from '../lib/jira.js'
import { buildAggregations } from '../lib/aggregate.js'
import { requireRole, type AuthedRequest } from '../middleware/requireAuth.js'
import { currentJiraActor } from '../lib/jiraContext.js'
import { knownTickets, findSimilar, topTexts, invalidateKnownTickets } from '../lib/similar.js'

const router = Router()

// Who the current request writes to Jira as — returned to the UI and kept in the audit log.
function jiraIdentity(): { jiraAs: 'user' | 'shared'; jiraUser?: string; jiraNotice?: string } {
  const a = currentJiraActor()
  return {
    jiraAs: a?.mode ?? 'shared',
    ...(a?.displayName ? { jiraUser: a.displayName } : {}),
    ...(a?.fallbackReason ? { jiraNotice: a.fallbackReason } : {}),
  }
}

// Jira date string -> Date (null when empty or unparseable)
function toDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// ── GET /api/reports  ─────────────────────────────────────────
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id:           true,
        name:         true,
        totalTickets: true,
        createdAt:    true,
      },
    })

    res.json(reports)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/backlog ──────────────────────────────────────
// One row per report (oldest -> newest): how many tickets were still open when it was
// synced / last refreshed. Each report is a snapshot of its own JQL, so this shows the
// trend of what the team was carrying week by week.
const BACKLOG_REPORTS = 26
const finished = (s: string) => /closed|done|resolved|cancel|reject/i.test(s)
const isL3 = (s: string) => /l3|investigate/i.test(s)

router.get('/backlog', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: BACKLOG_REPORTS,
      select: { id: true, name: true, createdAt: true, refreshedAt: true },
    })
    const ids = reports.map(r => r.id)
    const tickets = ids.length
      ? await prisma.ticket.findMany({ where: { reportId: { in: ids } }, select: { reportId: true, status: true, ticketCreatedAt: true } })
      : []
    const byReport = new Map<string, typeof tickets>()
    for (const t of tickets) {
      const l = byReport.get(t.reportId)
      if (l) l.push(t)
      else byReport.set(t.reportId, [t])
    }
    const DAY = 864e5
    const rows = reports.map(r => {
      const list = byReport.get(r.id) ?? []
      const asOf = (r.refreshedAt ?? r.createdAt).getTime()
      const open = list.filter(t => !finished(t.status))
      return {
        id: r.id,
        name: r.name,
        date: (r.refreshedAt ?? r.createdAt).toISOString(),
        total: list.length,
        open: open.length,
        closed: list.length - open.length,
        l3: list.filter(t => isL3(t.status)).length,
        over14: open.filter(t => t.ticketCreatedAt && (asOf - t.ticketCreatedAt.getTime()) / DAY > 14).length,
      }
    }).reverse()
    res.json({ reports: rows })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/search?q= ───────────────────────────────────
// For the Ctrl+K palette: tickets whose key or summary matches, newest report first,
// one row per ticket key (its latest report).
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : ''
    if (q.length < 2) { res.json({ tickets: [] }); return }
    const rows = await prisma.ticket.findMany({
      where: { OR: [{ key: { contains: q, mode: 'insensitive' } }, { summary: { contains: q, mode: 'insensitive' } }] },
      select: { key: true, summary: true, status: true, reportId: true, report: { select: { name: true, createdAt: true } } },
      take: 300,
    })
    rows.sort((a, b) => b.report.createdAt.getTime() - a.report.createdAt.getTime())
    const seen = new Set<string>()
    const qUpper = q.toUpperCase()
    const out = []
    for (const r of rows) {
      if (seen.has(r.key)) continue
      seen.add(r.key)
      out.push({ key: r.key, summary: r.summary ?? '', status: r.status, reportId: r.reportId, reportName: r.report.name, exact: r.key.toUpperCase() === qUpper })
    }
    out.sort((a, b) => Number(b.exact) - Number(a.exact))
    res.json({ tickets: out.slice(0, 12) })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/:id  ─────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const report = await prisma.report.findUnique({
      where: { id },
      include: { tickets: true },
    })

    if (!report) {
      res.status(404).json({ message: 'ไม่พบ report นี้' })
      return
    }

    const tickets = report.tickets

    // Single-pass aggregation (see lib/aggregate.ts). The old buRecurringMatrix /
    // buIssueMatrix were never used by the frontend and were removed.
    const ag = buildAggregations(tickets)

    res.json({
      id:           report.id,
      name:         report.name,
      totalTickets: report.totalTickets,
      createdAt:    report.createdAt,
      refreshedAt:  report.refreshedAt,

      // raw tickets — includes rootCause, resolution, deployDate, assignee, priority
      tickets: tickets.map((t) => ({
        key:                t.key,
        system:             t.system,
        status:             t.status,
        businessUnit:       t.businessUnit,
        typeOfIssue:        t.typeOfIssue,
        recurringCategory:  t.recurringCategory,
        standaloneCategory: t.standaloneCategory,
        summary:            t.summary,
        rootCause:          t.rootCause,
        resolution:         t.resolution,
        deployDate:         t.deployDate,
        assignee:           t.assignee,
        priority:           t.priority,
        ticketCreatedAt:    t.ticketCreatedAt?.toISOString() ?? null,
        resolvedAt:         t.resolvedAt?.toISOString() ?? null,
        escalation:         t.escalation,
      })),

      aggregations: ag,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/:id/tickets/:key/transitions ────────────────
// Statuses Jira lets this ticket move to right now (workflow + token permissions).
// The edit modal fills its Status dropdown from this, so users never pick a status
// that Jira would reject.
router.get('/:id/tickets/:key/transitions', requireRole('editor', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params
    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }
    // `live` = the status in Jira right now. The report stores a snapshot, which may be older:
    // the edit modal labels `live` as the current status so the dropdown matches what Jira offers.
    const [tr, live] = await Promise.allSettled([fetchAllowedStatuses(key), fetchLiveStatus(key)])
    const liveStatus = live.status === 'fulfilled' ? live.value : null
    if (tr.status === 'fulfilled') {
      const { allowed, details, queued } = tr.value
      res.json({ current: ticket.status, live: liveStatus, allowed, details, queued, ...jiraIdentity() })
    } else {
      const err = tr.reason
      console.error(`[jira] transitions failed for ${key}:`, err instanceof Error ? err.message : err)
      res.json({ current: ticket.status, live: liveStatus, allowed: [], error: 'ดึงรายการสถานะที่เปลี่ยนได้จาก Jira ไม่สำเร็จ', ...jiraIdentity() })
    }
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/:id/tickets/:key/assist ──────────────────────
// Help for filling Root Cause / Resolution, from the app's own history (no AI, no cost):
//   similar     : earlier tickets whose summary looks like this one, with what was written for them
//   suggestions : the most used Root Cause / Resolution texts for the same Type of Issue
router.get('/:id/tickets/:key/assist', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params
    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) { res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' }); return }
    const known = await knownTickets()
    const type = typeof req.query.typeOfIssue === 'string' && req.query.typeOfIssue ? req.query.typeOfIssue : ticket.typeOfIssue
    res.json({
      similar: findSimilar({ key, summary: ticket.summary ?? '', typeOfIssue: ticket.typeOfIssue, system: ticket.system }, known),
      suggestions: {
        typeOfIssue: type || null,
        rootCause: topTexts(known, 'rootCause', type || undefined),
        resolution: topTexts(known, 'resolution', type || undefined),
      },
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/:id/tickets/:key/custom-fields ──────────────
// Action Card / Type / Task Type with the options Jira allows and the ticket's current value.
router.get('/:id/tickets/:key/custom-fields', requireRole('editor', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params
    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }
    try {
      const fields = await fetchExtraFields(key)
      const found = new Set(fields.map(f => f.name.toLowerCase()))
      res.json({ fields, missing: EXTRA_FIELD_NAMES.filter(n => !found.has(n.toLowerCase())) })
    } catch (err) {
      console.error(`[jira] editmeta failed for ${key}:`, err instanceof Error ? err.message : err)
      res.json({ fields: [], missing: [], error: 'ดึงข้อมูล Action Card / Type / Task Type จาก Jira ไม่สำเร็จ' })
    }
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/reports/:id/tickets/:key ─────────────────────────
// แก้ไข ticket แล้ว sync กลับไป Jira ทันที + อัปเดต local DB
router.patch('/:id/tickets/:key', requireRole('editor', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params
    const input = req.body as JiraUpdateInput
    const actor = (req as AuthedRequest).user

    const ticket = await prisma.ticket.findFirst({
      where: { reportId: id, key },
    })

    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }

    // Extra dropdown fields (Action Card / Type / Task Type): validate against Jira's own
    // metadata BEFORE anything is written, so a bad request changes nothing.
    // Never forward the raw body to Jira — only what prepareExtraFieldUpdate() built.
    const rawCustom = (req.body as { customFields?: unknown } | undefined)?.customFields
    let extraPayload: Record<string, unknown> | undefined
    let extraChanges: Record<string, { from: string; to: string }> = {}
    if (rawCustom && typeof rawCustom === 'object' && Object.keys(rawCustom as object).length > 0) {
      const prep = await prepareExtraFieldUpdate(key, rawCustom as Record<string, ExtraFieldInput>)
      if (!prep.ok) {
        res.status(400).json({ message: prep.message })
        return
      }
      extraPayload = prep.payload
      extraChanges = prep.changes
    }
    delete (input as { customFields?: unknown }).customFields

    // 1) Push changes to Jira first — this is the source of truth
    const { ok, warnings, finalStatus, statusPath } = await pushTicketUpdateToJira(key, input, extraPayload)

    // 2) Update local DB regardless, so the Dashboard reflects the edit
    //    immediately even if some Jira fields failed (warnings shown to user)
    const dbUpdate: Record<string, unknown> = {}
    if (input.businessUnit !== undefined) dbUpdate.businessUnit = input.businessUnit
    if (input.typeOfIssue  !== undefined) dbUpdate.typeOfIssue  = input.typeOfIssue
    if (input.rootCause    !== undefined) dbUpdate.rootCause    = input.rootCause
    if (input.resolution   !== undefined) dbUpdate.resolution   = input.resolution
    if (input.deployDate   !== undefined) {
      const dd = input.deployDate ? String(input.deployDate).trim() : ''
      if (!dd) dbUpdate.deployDate = null
      else if (/^\d{4}-\d{2}-\d{2}/.test(dd)) dbUpdate.deployDate = dd.slice(0, 10)
    }
    // Status: store what Jira REALLY ended on — if a queued move stopped midway, that is the intermediate status
    if (finalStatus) dbUpdate.status = finalStatus
    // "Type of System" is also stored locally (standaloneCategory, shown in the CSV export)
    if (ok && extraChanges['Type of System'] !== undefined) dbUpdate.standaloneCategory = extraChanges['Type of System'].to || null

    const requested: Record<string, unknown> = { ...dbUpdate }
    const changes: Record<string, { from: string; to: string }> = diffFields(
      {
        businessUnit: ticket.businessUnit, typeOfIssue: ticket.typeOfIssue, rootCause: ticket.rootCause,
        resolution: ticket.resolution, deployDate: ticket.deployDate, status: ticket.status,
      },
      requested,
    )

    if (ok) Object.assign(changes, extraChanges) // dropdown fields are not stored locally — audit only

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: dbUpdate,
    })
    if (dbUpdate.rootCause !== undefined || dbUpdate.resolution !== undefined) invalidateKnownTickets()

    await recordAudit(actor, {
      action: 'ticket.update',
      reportId: id,
      ticketKey: key,
      summary: `แก้ไข ${key}: ${Object.keys(changes).join(', ') || 'ไม่มีการเปลี่ยนแปลง'}${ok ? '' : ' (Jira มีคำเตือน)'}`,
      details: {
        changes, warnings, jiraOk: ok, ...jiraIdentity(),
        ...(input.transitionResolution ? { transitionResolution: input.transitionResolution } : {}),
        ...(input.status ? { statusRequested: input.status, statusPath } : {}),
      },
      success: ok,
    })

    res.json({
      message: ok ? 'อัปเดตและ sync ไป Jira สำเร็จ' : 'อัปเดตบางส่วนสำเร็จ — มีคำเตือน',
      warnings,
      ...jiraIdentity(),
      ticket: {
        key:                updated.key,
        system:             updated.system,
        status:             updated.status,
        businessUnit:       updated.businessUnit,
        typeOfIssue:        updated.typeOfIssue,
        recurringCategory:  updated.recurringCategory,
        standaloneCategory: updated.standaloneCategory,
        summary:            updated.summary,
        rootCause:          updated.rootCause,
        resolution:         updated.resolution,
        deployDate:         updated.deployDate,
        assignee:           updated.assignee,
        priority:           updated.priority,
        ticketCreatedAt:    updated.ticketCreatedAt?.toISOString() ?? null,
        resolvedAt:         updated.resolvedAt?.toISOString() ?? null,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/reports/:id/refresh ─────────────────────────────────
// "รีเฟรชจาก Jira": pull the CURRENT status / assignee / priority / resolved date of every
// ticket in this report, without creating a new report.
//   - status, assignee, priority, resolved date: always taken from Jira (they change over time)
//   - BU / Type of Issue / Root Cause / Resolution / Deploy Date: only FILLED IN from Jira when
//     the report has them empty — values typed into the report are never overwritten.
// Tickets that no longer exist in Jira (deleted / moved) are left untouched and reported back.
const REFRESH_MAX = 5000

router.post('/:id/refresh', requireRole('editor', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const report = await prisma.report.findUnique({ where: { id }, include: { tickets: true } })
    if (!report) { res.status(404).json({ message: 'ไม่พบ report นี้' }); return }
    if (report.tickets.length > REFRESH_MAX) {
      res.status(400).json({ message: `report ใหญ่เกิน ${REFRESH_MAX} tickets — รีเฟรชไม่ได้` }); return
    }

    let fetched: Awaited<ReturnType<typeof fetchIssuesByKeys>>
    try {
      fetched = await fetchIssuesByKeys(report.tickets.map(t => t.key))
    } catch (err) {
      const e = err as { response?: { status?: number } }
      console.error('[refresh] Jira fetch failed:', err instanceof Error ? err.message : err)
      res.status(502).json({ message: `ดึงข้อมูลจาก Jira ไม่สำเร็จ${e?.response?.status ? ` (HTTP ${e.response.status})` : ''} — ลองใหม่อีกครั้ง` })
      return
    }
    const live = new Map(fetched.issues.map(i => [i.key, i]))

    const statusChanges: Array<{ key: string; from: string; to: string }> = []
    const updates: Array<{ id: string; data: Record<string, unknown> }> = []
    let filled = 0

    for (const t of report.tickets) {
      const j = live.get(t.key)
      if (!j) continue
      const data: Record<string, unknown> = {}
      if (j.status && j.status !== t.status) { data.status = j.status; statusChanges.push({ key: t.key, from: t.status, to: j.status }) }
      if ((j.assignee || null) !== (t.assignee || null)) data.assignee = j.assignee || null
      if ((j.priority || null) !== (t.priority || null)) data.priority = j.priority || null
      const resolvedAt = toDate(j.resolved)
      if ((resolvedAt?.getTime() ?? null) !== (t.resolvedAt?.getTime() ?? null)) data.resolvedAt = resolvedAt
      if (!t.ticketCreatedAt && j.created) data.ticketCreatedAt = toDate(j.created)
      if (j.escalation && j.escalation !== t.escalation) data.escalation = j.escalation

      // fill-only fields
      const fill = (field: 'businessUnit' | 'typeOfIssue' | 'rootCause' | 'resolution' | 'deployDate', v: string) => {
        const cur = t[field]
        if ((cur === null || cur === undefined || String(cur).trim() === '') && v && v.trim()) { data[field] = v.trim(); filled++ }
      }
      fill('businessUnit', j.businessUnit)
      fill('typeOfIssue', j.typeOfIssue)
      fill('rootCause', j.rootCause)
      fill('resolution', j.resolution)
      fill('deployDate', j.deployDate)

      if (Object.keys(data).length) updates.push({ id: t.id, data })
    }

    // Small transactions so a big report does not hold one long transaction open
    const CHUNK = 50
    for (let i = 0; i < updates.length; i += CHUNK) {
      await prisma.$transaction(updates.slice(i, i + CHUNK).map(u => prisma.ticket.update({ where: { id: u.id }, data: u.data })))
    }
    if (filled) invalidateKnownTickets()
    const refreshedAt = new Date()
    await prisma.report.update({ where: { id }, data: { refreshedAt } })

    await recordAudit((req as AuthedRequest).user, {
      action: 'report.refresh', reportId: id,
      summary: `รีเฟรช "${report.name}" จาก Jira: อัปเดต ${updates.length} tickets, เปลี่ยนสถานะ ${statusChanges.length}`,
      details: {
        updated: updates.length, statusChanges: statusChanges.slice(0, 200), filledFields: filled,
        missing: fetched.missing.slice(0, 200), ...jiraIdentity(),
      },
    })

    res.json({
      message: updates.length ? `อัปเดตจาก Jira แล้ว ${updates.length} tickets` : 'ข้อมูลตรงกับ Jira อยู่แล้ว',
      refreshedAt,
      checked: report.tickets.length,
      updated: updates.length,
      statusChanged: statusChanges.length,
      statusChanges: statusChanges.slice(0, 100),
      filledFields: filled,
      missing: fetched.missing,
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/reports/:id/bulk-update ────────────────────────────
// Body: { keys: string[], changes: { businessUnit?, typeOfIssue?, deployDate? (null = clear) } }
// Edits many tickets at once and writes each one back to Jira. Only the three "safe"
// fields are allowed in bulk: Status needs a per-ticket workflow transition, and
// Root Cause / Resolution are free text that should be written per ticket.
// A ticket's local copy is updated ONLY when Jira accepted the change, so the Dashboard
// never claims something that Jira rejected.
const BULK_MAX = 100
const BULK_CONCURRENCY = 3

type BulkStatus = 'updated' | 'skipped' | 'failed' | 'not_found'
interface BulkResult {
  key: string
  status: BulkStatus
  message?: string
  ticket?: { businessUnit: string; typeOfIssue: string; deployDate: string | null }
}

async function runPool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

router.post('/:id/bulk-update', requireRole('editor', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const actor = (req as AuthedRequest).user
    const body = (req.body ?? {}) as { keys?: unknown; changes?: Record<string, unknown> }

    const keys = Array.isArray(body.keys)
      ? Array.from(new Set(body.keys.filter((k): k is string => typeof k === 'string').map(k => k.trim()).filter(Boolean)))
      : []
    if (!keys.length) { res.status(400).json({ message: 'ยังไม่ได้เลือก ticket' }); return }
    if (keys.length > BULK_MAX) {
      res.status(400).json({ message: `แก้ไขพร้อมกันได้สูงสุด ${BULK_MAX} ticket ต่อครั้ง (เลือกมา ${keys.length})` }); return
    }

    const raw = body.changes ?? {}
    const changes: { businessUnit?: string; typeOfIssue?: string; deployDate?: string | null } = {}
    if (raw.businessUnit !== undefined) {
      const v = typeof raw.businessUnit === 'string' ? raw.businessUnit.trim() : ''
      if (!v) { res.status(400).json({ message: 'Business Unit ต้องไม่ว่าง' }); return }
      changes.businessUnit = v
    }
    if (raw.typeOfIssue !== undefined) {
      const v = typeof raw.typeOfIssue === 'string' ? raw.typeOfIssue.trim() : ''
      if (!v) { res.status(400).json({ message: 'Type of Issue ต้องไม่ว่าง' }); return }
      changes.typeOfIssue = v
    }
    if (raw.deployDate !== undefined) {
      const d = normalizeDeployDate(raw.deployDate as string | null)
      if (d === undefined) { res.status(400).json({ message: 'รูปแบบ Deploy Date ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)' }); return }
      changes.deployDate = d // null = clear
    }
    if (Object.keys(changes).length === 0) {
      res.status(400).json({ message: 'ยังไม่ได้เลือก field ที่จะแก้ไข' }); return
    }

    const tickets = await prisma.ticket.findMany({ where: { reportId: id, key: { in: keys } } })
    const byKey = new Map<string, (typeof tickets)[number]>()
    for (const t of tickets) if (!byKey.has(t.key)) byKey.set(t.key, t)

    const batchId = randomUUID()
    const results: BulkResult[] = new Array(keys.length)
    const auditList: AuditEntry[] = []

    await runPool(keys, BULK_CONCURRENCY, async (key, idx) => {
      const t = byKey.get(key)
      if (!t) { results[idx] = { key, status: 'not_found', message: 'ไม่พบ ticket นี้ใน report' }; return }

      // Only send fields whose value really differs from what we have
      const effective: JiraUpdateInput = {}
      if (changes.businessUnit !== undefined && changes.businessUnit !== (t.businessUnit || '')) effective.businessUnit = changes.businessUnit
      if (changes.typeOfIssue  !== undefined && changes.typeOfIssue  !== (t.typeOfIssue  || '')) effective.typeOfIssue  = changes.typeOfIssue
      if (changes.deployDate   !== undefined) {
        const cur = t.deployDate ? t.deployDate.slice(0, 10) : ''
        if ((changes.deployDate ?? '') !== cur) effective.deployDate = changes.deployDate
      }
      if (Object.keys(effective).length === 0) {
        results[idx] = { key, status: 'skipped', message: 'ค่าตรงกับที่มีอยู่แล้ว' }
        return
      }

      const after: Record<string, unknown> = {}
      if (effective.businessUnit !== undefined) after.businessUnit = effective.businessUnit
      if (effective.typeOfIssue  !== undefined) after.typeOfIssue  = effective.typeOfIssue
      if (effective.deployDate   !== undefined) after.deployDate   = effective.deployDate ?? ''
      const diff = diffFields(
        { businessUnit: t.businessUnit, typeOfIssue: t.typeOfIssue, deployDate: t.deployDate ? t.deployDate.slice(0, 10) : '' },
        after,
      )

      try {
        const { ok, warnings } = await pushTicketUpdateToJira(key, effective)
        if (!ok) {
          results[idx] = { key, status: 'failed', message: clip(warnings.join(' | '), 300) || 'Jira ไม่รับการเปลี่ยนแปลง' }
          auditList.push({ action: 'ticket.bulk_update', reportId: id, ticketKey: key, summary: `แก้หลาย ticket ไม่สำเร็จ: ${key}`, details: { batchId, changes: diff, warnings }, success: false })
          return
        }
        const data: Record<string, unknown> = {}
        if (effective.businessUnit !== undefined) data.businessUnit = effective.businessUnit
        if (effective.typeOfIssue  !== undefined) data.typeOfIssue  = effective.typeOfIssue
        if (effective.deployDate   !== undefined) data.deployDate   = effective.deployDate // null clears
        const updated = await prisma.ticket.update({ where: { id: t.id }, data })
        results[idx] = {
          key, status: 'updated',
          ticket: { businessUnit: updated.businessUnit, typeOfIssue: updated.typeOfIssue, deployDate: updated.deployDate },
        }
        auditList.push({ action: 'ticket.bulk_update', reportId: id, ticketKey: key, summary: `แก้หลาย ticket: ${key} (${Object.keys(diff).join(', ')})`, details: { batchId, changes: diff }, success: true })
      } catch (err) {
        results[idx] = { key, status: 'failed', message: err instanceof Error ? clip(err.message, 300) : 'เกิดข้อผิดพลาด' }
        auditList.push({ action: 'ticket.bulk_update', reportId: id, ticketKey: key, summary: `แก้หลาย ticket ไม่สำเร็จ: ${key}`, details: { batchId, changes: diff, error: err instanceof Error ? err.message : String(err) }, success: false })
      }
    })

    await recordAudit(actor, auditList)

    const count = (st: BulkStatus) => results.filter(r => r.status === st).length
    res.json({
      total: keys.length,
      updated: count('updated'),
      skipped: count('skipped'),
      failed: count('failed'),
      notFound: count('not_found'),
      results,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/:id/tickets/:key/activity ───────────────────
// ดึง Comments + Changelog มาพร้อมกัน แสดงใน Ticket Modal
router.get('/:id/tickets/:key/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params

    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }

    const [comments, changelog] = await Promise.all([
      fetchJiraComments(key),
      fetchJiraChangelog(key),
    ])

    res.json({ comments, changelog })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/reports/:id/tickets/:key/comment ────────────────────
// เพิ่ม comment ใหม่จาก Dashboard เข้า Jira โดยตรง
router.post('/:id/tickets/:key/comment', requireRole('editor', 'admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params
    const { text } = req.body as { text?: string }

    if (!text || !text.trim()) {
      res.status(400).json({ message: 'กรุณากรอกข้อความ comment' })
      return
    }

    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }

    const actor = (req as AuthedRequest).user
    await addJiraComment(key, text.trim(), actor?.name)
    await recordAudit(actor, {
      action: 'ticket.comment', reportId: id, ticketKey: key,
      summary: `เพิ่ม comment ที่ ${key}`,
      details: { text: clip(text.trim(), 500), ...jiraIdentity() },
    })

    const comments = await fetchJiraComments(key)
    res.json({ message: 'เพิ่ม comment สำเร็จ', comments })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/:id/tickets/:key/attachments ─────────────────
// รายการไฟล์แนบทั้งหมดของ ticket
router.get('/:id/tickets/:key/attachments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params

    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }

    const attachments = await fetchJiraAttachments(key)
    res.json({ attachments })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/reports/:id/tickets/:key/attachments/:attachmentId ───
// Proxy ดาวน์โหลดไฟล์แนบจริงจาก Jira (ต้องผ่าน backend เพราะ Jira ต้องการ auth)
router.get('/:id/tickets/:key/attachments/:attachmentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key, attachmentId } = req.params

    const ticket = await prisma.ticket.findFirst({ where: { reportId: id, key } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }
    // Only files that belong to THIS ticket — otherwise any signed-in user could download
    // any attachment in Jira by guessing its id.
    const attachments = await fetchJiraAttachments(key)
    if (!attachments.some(a => a.id === attachmentId)) {
      res.status(404).json({ message: 'ไม่พบไฟล์แนบนี้ใน ticket' })
      return
    }

    const { buffer, mimeType, filename } = await downloadJiraAttachment(attachmentId)

    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/reports/:id  ──────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const exists = await prisma.report.findUnique({ where: { id }, select: { id: true, name: true, totalTickets: true } })
    if (!exists) {
      res.status(404).json({ message: 'ไม่พบ report นี้' })
      return
    }

    await prisma.report.delete({ where: { id } })
    invalidateKnownTickets()
    await recordAudit((req as AuthedRequest).user, {
      action: 'report.delete', reportId: id,
      summary: `ลบ report "${exists.name}" (${exists.totalTickets} tickets)`,
      details: { name: exists.name, totalTickets: exists.totalTickets },
    })

    res.json({ message: 'ลบ report เรียบร้อย' })
  } catch (err) {
    next(err)
  }
})



export default router
