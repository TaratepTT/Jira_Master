import { Router, Request, Response, NextFunction } from 'express'
import { fetchJiraIssues, testJiraConnection, type JiraIssue } from '../lib/jira.js'
import prisma from '../lib/prisma.js'

const router = Router()

// ── Shared helpers ───────────────────────────────────────────
function normaliseSystem(raw: string): string {
  const u = raw.toUpperCase()
  if (u.includes('CMP')) return 'CMP'
  if (u.includes('VMP')) return 'VMP'
  if (u.includes('TMS'))  return 'CP TMS'
  return raw
}

// A ticket "fails validation" if any required field for the dashboard is empty
function validateIssue(i: JiraIssue): string[] {
  const problems: string[] = []
  if (!i.key)                       problems.push('ไม่มี Key')
  if (!i.status)                    problems.push('ไม่มี Status')
  if (!i.businessUnit)              problems.push('ไม่มี Business Unit')
  if (!i.typeOfIssue)               problems.push('ไม่มี Type of Issue')
  if (!i.system)                    problems.push('ไม่มี System')
  return problems
}

// ── GET /api/jira/test ────────────────────────────────────────
router.get('/test', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await testJiraConnection()
    res.json({ ok: true, email: result.email, message: 'เชื่อมต่อ Jira สำเร็จ' })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/jira/preview-all ─────────────────────────────────
// Fetch ALL issues matching JQL but do NOT save. Returns each issue plus
// its validation problems (if any) and a duplicate-key flag, so the
// frontend can render a review/validation screen before committing.
router.post('/preview-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { jql } = req.body as { jql?: string }
    if (!jql || !jql.trim()) {
      res.status(400).json({ message: 'กรุณาระบุ JQL' })
      return
    }

    const issues = await fetchJiraIssues(jql, 500)

    if (!issues.length) {
      res.status(422).json({ message: 'ไม่พบ ticket ที่ตรงกับ JQL นี้' })
      return
    }

    // Detect duplicate keys within this batch
    const keyCounts: Record<string, number> = {}
    issues.forEach(i => { keyCounts[i.key] = (keyCounts[i.key] ?? 0) + 1 })

    const rows = issues.map(i => {
      const problems = validateIssue(i)
      if (keyCounts[i.key] > 1) problems.push('Key ซ้ำในชุดข้อมูลนี้')

      return {
        key:                i.key,
        system:             normaliseSystem(i.system),
        status:             i.status,
        businessUnit:       i.businessUnit,
        typeOfIssue:        i.typeOfIssue,
        recurringCategory:  i.issueCategory,
        standaloneCategory: i.typeOfSystem,
        summary:            i.summary,
        rootCause:          i.rootCause,
        resolution:         i.resolution,
        deployDate:         i.deployDate,
        problems,
        valid: problems.length === 0,
      }
    })

    const validCount = rows.filter(r => r.valid).length

    res.json({
      total: rows.length,
      validCount,
      invalidCount: rows.length - validCount,
      tickets: rows,
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/jira/confirm ─────────────────────────────────────
// Save only the tickets the user explicitly confirmed (selected keys +
// their full data, passed back from the preview screen).
router.post('/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reportName, tickets } = req.body as {
      reportName?: string
      tickets?: Array<{
        key: string; system: string; status: string; businessUnit: string
        typeOfIssue: string; recurringCategory?: string; standaloneCategory?: string
        summary?: string; rootCause?: string; resolution?: string; deployDate?: string
      }>
    }

    if (!tickets || !tickets.length) {
      res.status(400).json({ message: 'ไม่มี ticket ที่เลือกไว้ให้บันทึก' })
      return
    }

    const name = reportName?.trim() || `Jira Sync — ${new Date().toISOString().slice(0, 10)}`

    const report = await prisma.report.create({
      data: {
        name,
        totalTickets: tickets.length,
        tickets: {
          createMany: {
            data: tickets.map(t => ({
              key:                t.key,
              system:             t.system,
              status:             t.status,
              businessUnit:       t.businessUnit,
              typeOfIssue:        t.typeOfIssue,
              recurringCategory:  t.recurringCategory || null,
              standaloneCategory: t.standaloneCategory || null,
              summary:            t.summary || null,
              rootCause:          t.rootCause || null,
              resolution:         t.resolution || null,
              deployDate:         t.deployDate || null,
            })),
          },
        },
      },
    })

    res.status(201).json({
      reportId:     report.id,
      reportName:   report.name,
      totalTickets: report.totalTickets,
      message:      `บันทึกสำเร็จ — ${tickets.length} tickets`,
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/jira/sync ───────────────────────────────────────
// Legacy one-step sync (fetch + save immediately), kept for JQL presets /
// scripted use. The new UI flow uses preview-all → confirm instead.
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
// Small (first 10) preview — kept for quick sanity checks.
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
