import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { pushTicketUpdateToJira, type JiraUpdateInput } from '../lib/jira.js'
import { fetchJiraComments, fetchJiraChangelog, addJiraComment } from '../lib/jira.js'
import { fetchJiraAttachments, downloadJiraAttachment } from '../lib/jira.js'
import { buildAggregations } from '../lib/aggregate.js'

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

// ── PATCH /api/reports/:id/tickets/:key ─────────────────────────
// แก้ไข ticket แล้ว sync กลับไป Jira ทันที + อัปเดต local DB
router.patch('/:id/tickets/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, key } = req.params
    const input = req.body as JiraUpdateInput

    const ticket = await prisma.ticket.findFirst({
      where: { reportId: id, key },
    })

    if (!ticket) {
      res.status(404).json({ message: 'ไม่พบ ticket นี้ใน report' })
      return
    }

    // 1) Push changes to Jira first — this is the source of truth
    const { ok, warnings } = await pushTicketUpdateToJira(key, input)

    // 2) Update local DB regardless, so the Dashboard reflects the edit
    //    immediately even if some Jira fields failed (warnings shown to user)
    const dbUpdate: Record<string, unknown> = {}
    if (input.businessUnit !== undefined) dbUpdate.businessUnit = input.businessUnit
    if (input.typeOfIssue  !== undefined) dbUpdate.typeOfIssue  = input.typeOfIssue
    if (input.rootCause    !== undefined) dbUpdate.rootCause    = input.rootCause
    if (input.resolution   !== undefined) dbUpdate.resolution   = input.resolution
    if (input.status       !== undefined && ok) dbUpdate.status = input.status

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: dbUpdate,
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
router.post('/:id/tickets/:key/comment', async (req: Request, res: Response, next: NextFunction) => {
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

    await addJiraComment(key, text.trim())

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
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const exists = await prisma.report.findUnique({ where: { id }, select: { id: true } })
    if (!exists) {
      res.status(404).json({ message: 'ไม่พบ report นี้' })
      return
    }

    await prisma.report.delete({ where: { id } })

    res.json({ message: 'ลบ report เรียบร้อย' })
  } catch (err) {
    next(err)
  }
})



export default router
