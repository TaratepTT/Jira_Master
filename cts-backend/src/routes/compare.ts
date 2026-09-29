import { Router, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { compareReports } from '../lib/compare.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'

// Mounted behind requireAuth in index.ts — read-only, so any signed-in user may use it.
//   GET /api/compare?base=<reportId>&current=<reportId>
const router = Router()

const select = {
  id: true, name: true, createdAt: true,
  tickets: { select: { key: true, status: true, system: true, businessUnit: true, typeOfIssue: true, priority: true, summary: true, ticketCreatedAt: true } },
} as const

router.get('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const base = typeof req.query.base === 'string' ? req.query.base : ''
    const current = typeof req.query.current === 'string' ? req.query.current : ''
    if (!base || !current) { res.status(400).json({ message: 'กรุณาระบุ report ทั้งสองฝั่ง (base และ current)' }); return }
    if (base === current) { res.status(400).json({ message: 'เลือก report เดียวกันสองฝั่งไม่ได้ — เลือกคนละ report' }); return }

    const [b, c] = await Promise.all([
      prisma.report.findUnique({ where: { id: base }, select }),
      prisma.report.findUnique({ where: { id: current }, select }),
    ])
    if (!b || !c) { res.status(404).json({ message: 'ไม่พบ report ที่เลือก' }); return }

    res.json({
      base: { id: b.id, name: b.name, createdAt: b.createdAt },
      current: { id: c.id, name: c.name, createdAt: c.createdAt },
      ...compareReports(b.tickets, c.tickets),
    })
  } catch (err) {
    next(err)
  }
})

export default router
