import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { pushTicketUpdateToJira, type JiraUpdateInput } from '../lib/jira.js'
import { fetchJiraComments, fetchJiraChangelog, addJiraComment } from '../lib/jira.js'

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

    const systemCount     = groupCount(tickets, 'system')
    const statusCount     = groupCount(tickets, 'status')
    const buCount         = groupCount(tickets, 'businessUnit')
    const issueTypeCount  = groupCount(tickets, 'typeOfIssue')
    const recurringCount  = groupCount(tickets, 'recurringCategory')

    const frequencyTable = Object.entries(issueTypeCount)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count], idx) => ({
        rank: idx + 1,
        category,
        count,
        pct: pct(count, tickets.length),
        keys: tickets
          .filter((t) => t.typeOfIssue === category)
          .map((t) => t.key),
      }))

    const recurringCats = [
      ...new Set(
        tickets
          .filter((t) => t.recurringCategory && t.recurringCategory !== 'เคสเดี่ยว')
          .map((t) => t.recurringCategory)
      ),
    ]
    const buList = Object.keys(buCount).sort((a, b) => buCount[b] - buCount[a])

    const buRecurringMatrix = buList.map((bu) => {
      const row: Record<string, string[]> = { bu: [bu] }
      const standalone = tickets
        .filter(
          (t) =>
            t.businessUnit === bu &&
            (!t.recurringCategory || t.recurringCategory === 'เคสเดี่ยว')
        )
        .map((t) => t.key)
      row['เคสเดี่ยว'] = standalone

      for (const cat of recurringCats) {
        if (!cat) continue
        row[cat] = tickets
          .filter((t) => t.businessUnit === bu && t.recurringCategory === cat)
          .map((t) => t.key)
      }
      return row
    })

    const issueTypes = Object.keys(issueTypeCount)
    const buIssueMatrix = buList.map((bu) => {
      const row: Record<string, string[] | string> = { bu }
      for (const type of issueTypes) {
        row[type] = tickets
          .filter((t) => t.businessUnit === bu && t.typeOfIssue === type)
          .map((t) => t.key)
      }
      return row
    })

    const l3Tickets = tickets.filter(
      (t) =>
        t.status.toLowerCase().includes('l3') ||
        t.status.toLowerCase().includes('investigate')
    )

    res.json({
      id:           report.id,
      name:         report.name,
      totalTickets: report.totalTickets,
      createdAt:    report.createdAt,

      // raw tickets — includes rootCause, resolution, deployDate
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
      })),

      aggregations: {
        systemCount,
        statusCount,
        buCount,
        issueTypeCount,
        recurringCount,
        frequencyTable,
        buRecurringMatrix,
        buIssueMatrix,
        l3Tickets: l3Tickets.map((t) => ({
          key:     t.key,
          bu:      t.businessUnit,
          status:  t.status,
          summary: t.summary,
        })),
        top5Bu:  Object.entries(buCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
        top3Cat: frequencyTable.slice(0, 3),
      },
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

function groupCount<T extends Record<string, unknown>>(
  items: T[],
  field: keyof T
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of items) {
    const val = String(item[field] ?? 'Unknown')
    map[val] = (map[val] ?? 0) + 1
  }
  return map
}

function pct(n: number, total: number): string {
  if (!total) return '0.00%'
  return ((n / total) * 100).toFixed(2) + '%'
}

export default router
