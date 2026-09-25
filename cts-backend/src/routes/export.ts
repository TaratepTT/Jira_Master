import { Router, Request, Response, NextFunction } from 'express'
import Papa from 'papaparse'
import prisma from '../lib/prisma.js'

const router = Router()

/**
 * GET /api/export/:id
 * Returns all tickets in a report as a downloadable CSV.
 */
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

    const rows = report.tickets.map((t) => ({
      'Issue Key':                  t.key,
      'Summary':                    t.summary ?? '',
      'Business Unit':              t.businessUnit,
      'Status':                     t.status,
      'Type of Issue':              t.typeOfIssue,
      'Root Cause':                 t.rootCause ?? '',
      'Resolution':                 t.resolution ?? '',
      'Deploy Date':                t.deployDate ?? '',
      'System':                     t.system,
      'Recurring Issue Category':   t.recurringCategory,
      'Standalone Category':        t.standaloneCategory,
    }))

    const csv = Papa.unparse(rows)
    const filename = `${report.name.replace(/[^a-zA-Z0-9ก-๙ ]/g, '_')}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    res.send('\uFEFF' + csv) // BOM for Excel Thai charset
  } catch (err) {
    next(err)
  }
})

export default router
