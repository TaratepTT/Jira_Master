import { Router, Request, Response, NextFunction } from 'express'
import { upload } from '../middleware/multer.js'
import { parseFile } from '../lib/parser.js'
import prisma from '../lib/prisma.js'

const router = Router()

/**
 * POST /api/upload
 * Body: multipart/form-data
 *   file        — CSV or Excel file
 *   reportName  — display name for this report
 */
router.post(
  '/',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ── Validate ──────────────────────────────────────────
      if (!req.file) {
        res.status(400).json({ message: 'ไม่พบไฟล์ในคำขอ' })
        return
      }

      const reportName = (req.body.reportName as string | undefined)?.trim()
        || `Report ${new Date().toISOString().slice(0, 10)}`

      // ── Parse ─────────────────────────────────────────────
      const { tickets, totalTickets } = parseFile(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      )

      if (!totalTickets) {
        res.status(422).json({ message: 'ไม่พบข้อมูล ticket ในไฟล์' })
        return
      }

      // ── Persist ───────────────────────────────────────────
      const report = await prisma.report.create({
        data: {
          name: reportName,
          totalTickets,
          tickets: {
            createMany: {
              data: tickets.map((t) => ({
                key:                t.key,
                system:             t.system,
                status:             t.status,
                businessUnit:       t.businessUnit,
                typeOfIssue:        t.typeOfIssue,
                recurringCategory:  t.recurringCategory,
                standaloneCategory: t.standaloneCategory,
                summary:            t.summary || null,
              })),
            },
          },
        },
      })

      res.status(201).json({
        reportId:     report.id,
        reportName:   report.name,
        totalTickets: report.totalTickets,
        message:      'อัปโหลดสำเร็จ',
      })
    } catch (err) {
      next(err)
    }
  }
)

export default router
