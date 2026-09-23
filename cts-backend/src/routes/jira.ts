import { Router, Request, Response, NextFunction } from 'express'
import { fetchJiraIssues, testJiraConnection } from '../lib/jira.js'
import prisma from '../lib/prisma.js'

const router = Router()

// ── GET /api/jira/test ────────────────────────────────────────
router.get('/test', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await testJiraConnection()
    res.json({ ok: true, email: result.email, message: 'เชื่อมต่อ Jira สำเร็จ' })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/jira/sync ───────────────────────────────────────
router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      jql = 'project = CTS ORDER BY created DESC',
      reportName = `Jira Sync — ${new Date().toISOString().slice(0, 10)}`,
    } = req.body as { jql?: string; reportName?: string }

    const issues = await fetchJiraIssues(jql, 500)

    if (!issues.length) {
      res.status(422).json({ message: 'ไม่พบ ticket ที่ตรงกับ JQL นี้' })
      return
    }

    const normaliseSystem = (raw: string) => {
      const u = raw.toUpperCase()
      if (u.includes('CMP')) return 'CMP'
      if (u.includes('VMP')) return 'VMP'
      if (u.includes('TMS'))  return 'CP TMS'
      return raw
    }

    const report = await prisma.report.create({
      data: {
        name: reportName,
        totalTickets: issues.length,
        tickets: {
          createMany: {
            data: issues.map(i => ({
              key:                i.key,
              system:             normaliseSystem(i.system),
              status:             i.status,
              businessUnit:       i.businessUnit,
              typeOfIssue:        i.typeOfIssue,
              recurringCategory:  i.issueCategory,
              standaloneCategory: i.typeOfSystem,
              summary:            i.summary || null,
              rootCause:          i.rootCause || null,
              resolution:         i.resolution || null,
              deployDate:         i.deployDate || null,
            })),
          },
        },
      },
    })

    res.status(201).json({
      reportId:     report.id,
      reportName:   report.name,
      totalTickets: report.totalTickets,
      message:      `Sync สำเร็จ — ${issues.length} tickets`,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/jira/preview ─────────────────────────────────────
router.get('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jql = (req.query.jql as string) || 'project = CTS ORDER BY created DESC'
    const issues = await fetchJiraIssues(jql, 10)
    res.json({ total: issues.length, issues })
  } catch (err) {
    next(err)
  }
})

export default router
