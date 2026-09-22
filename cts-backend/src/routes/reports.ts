import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'

const router = Router()

// ── GET /api/reports  ─────────────────────────────────────────
// List all reports (newest first), no ticket data
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
// Full report with tickets + pre-computed aggregations
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

    // ── Aggregations (mirror what the frontend dashboard needs) ──

    // 1. System breakdown
    const systemCount = groupCount(tickets, 'system')

    // 2. Status breakdown
    const statusCount = groupCount(tickets, 'status')

    // 3. Business unit breakdown
    const buCount = groupCount(tickets, 'businessUnit')

    // 4. Type of issue breakdown
    const issueTypeCount = groupCount(tickets, 'typeOfIssue')

    // 5. Recurring category breakdown
    const recurringCount = groupCount(tickets, 'recurringCategory')

    // 6. Ticket frequency by category (ranked)
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

    // 7. BU cross-table by recurring category
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
        row[cat] = tickets
          .filter((t) => t.businessUnit === bu && t.recurringCategory === cat)
          .map((t) => t.key)
      }
      return row
    })

    // 8. BU by issue type matrix
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

    // 9. L3 escalation tickets (status contains 'L3' or 'investigate')
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

      // raw tickets (paginated if needed later)
      tickets: tickets.map((t) => ({
        key:                t.key,
        system:             t.system,
        status:             t.status,
        businessUnit:       t.businessUnit,
        typeOfIssue:        t.typeOfIssue,
        recurringCategory:  t.recurringCategory,
        standaloneCategory: t.standaloneCategory,
        summary:            t.summary,
      })),

      // aggregations
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
          key:    t.key,
          bu:     t.businessUnit,
          status: t.status,
          summary: t.summary,
        })),
        top5Bu:   Object.entries(buCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
        top3Cat:  frequencyTable.slice(0, 3),
      },
    })
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

    // Cascade delete tickets via Prisma relation
    await prisma.report.delete({ where: { id } })

    res.json({ message: 'ลบ report เรียบร้อย' })
  } catch (err) {
    next(err)
  }
})

// ── Helpers ───────────────────────────────────────────────────
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
