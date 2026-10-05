import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import {
  pushTicketUpdateToJira, fetchAllowedStatuses, normalizeDeployDate,
  fetchExtraFields, prepareExtraFieldUpdate, EXTRA_FIELD_NAMES,
  type JiraUpdateInput, type ExtraFieldInput,
} from '../lib/jira.js'
import { recordAudit, diffFields, clip, type AuditEntry } from '../lib/audit.js'
import { randomUUID } from 'node:crypto'
import { fetchJiraComments, fetchJiraChangelog, addJiraComment } from '../lib/jira.js'
import { fetchJiraAttachments, downloadJiraAttachment } from '../lib/jira.js'
import { buildAggregations } from '../lib/aggregate.js'
import { requireRole, type AuthedRequest } from '../middleware/requireAuth.js'

const router = Router()

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
    try {
      const { allowed, details, queued } = await fetchAllowedStatuses(key)
      res.json({ current: ticket.status, allowed, details, queued })
    } catch (err) {
      console.error(`[jira] transitions failed for ${key}:`, err instanceof Error ? err.message : err)
      res.json({ current: ticket.status, allowed: [], error: 'ดึงรายการสถานะที่เปลี่ยนได้จาก Jira ไม่สำเร็จ' })
    }
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

    await recordAudit(actor, {
      action: 'ticket.update',
      reportId: id,
      ticketKey: key,
      summary: `แก้ไข ${key}: ${Object.keys(changes).join(', ') || 'ไม่มีการเปลี่ยนแปลง'}${ok ? '' : ' (Jira มีคำเตือน)'}`,
      details: {
        changes, warnings, jiraOk: ok,
        ...(input.transitionResolution ? { transitionResolution: input.transitionResolution } : {}),
        ...(input.status ? { statusRequested: input.status, statusPath } : {}),
      },
      success: ok,
    })

    res.json({
      message: ok ? 'อัปเดตและ sync ไป Jira สำเร็จ' : 'อัปเดตบางส่วนสำเร็จ — มีคำเตือน',
      warnings,
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
      },
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
      details: { text: clip(text.trim(), 500) },
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
    const { id, attachmentId } = req.params

    const ticket = await prisma.ticket.findFirst({ where: { reportId: id } })
    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ report นี้' })
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
