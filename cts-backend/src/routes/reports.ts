import { Router, Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { fetchJiraIssues } from '../lib/jira.js'

const router = Router()

// ── Shared helpers ───────────────────────────────────────────
function normaliseSystem(raw: string): string {
  const u = raw.toUpperCase()
  if (u.includes('CMP')) return 'CMP'
  if (u.includes('VMP')) return 'VMP'
  if (u.includes('TMS'))  return 'CP TMS'
  return raw
}

// Build the full dashboard payload (tickets + aggregations) for one report.
// Shared by GET /:id and POST /:id/refresh so both return the exact same shape.
async function buildReportPayload(id: string) {
  const report = await prisma.report.findUnique({
    where: { id },
    include: { tickets: true },
  })

  if (!report) return null

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

    return {
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
    }
}

// ── GET /api/reports/:id  ─────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = await buildReportPayload(req.params.id)
    if (!payload) {
      res.status(404).json({ message: 'ไม่พบ report นี้' })
      return
    }
    res.json(payload)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/reports/:id/refresh ───────────────────────────────
// Re-fetch the latest data from Jira for every ticket key already saved
// in this report, and overwrite the stored fields with the fresh values.
// Lets the person pull in edits made directly in Jira after the report
// was created, without recreating the whole report from scratch.
router.post('/:id/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params

    const report = await prisma.report.findUnique({
      where: { id },
      include: { tickets: { select: { key: true } } },
    })

    if (!report) {
      res.status(404).json({ message: 'ไม่พบ report นี้' })
      return
    }

    const keys = report.tickets.map((t) => t.key)

    if (!keys.length) {
      const payload = await buildReportPayload(id)
      res.json({ updatedCount: 0, notFoundInJira: 0, ...payload })
      return
    }

    // Jira JQL "in" clause — keys are Jira issue keys already stored in our DB,
    // not free user text, so no quoting/escaping is needed here.
    const jql = `key in (${keys.join(',')})`
    const issues = await fetchJiraIssues(jql, keys.length)

    let updatedCount = 0
    for (const i of issues) {
      const result = await prisma.ticket.updateMany({
        where: { reportId: id, key: i.key },
        data: {
          system:             normaliseSystem(i.system),
          status:             i.status,
          businessUnit:       i.businessUnit,
          typeOfIssue:        i.typeOfIssue,
          recurringCategory:  i.issueCategory || null,
          standaloneCategory: i.typeOfSystem || null,
          summary:            i.summary || null,
          rootCause:          i.rootCause || null,
          resolution:         i.resolution || null,
          deployDate:         i.deployDate || null,
        },
      })
      updatedCount += result.count
    }

    const payload = await buildReportPayload(id)
    res.json({
      updatedCount,
      notFoundInJira: keys.length - issues.length,
      ...payload,
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
