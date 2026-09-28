import { Router, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { requireRole, type AuthedRequest } from '../middleware/requireAuth.js'
import {
  AI_MODEL, AiError, askModel, buildEntries, dailyLimit, isAiConfigured, normalizeThemes,
  type InsightResult,
} from '../lib/insights.js'

// Mounted behind requireAuth in index.ts.
//   GET  /api/insights/:reportId/root-cause   any signed-in user  (cached result + what a run would send)
//   POST /api/insights/:reportId/root-cause   editor / admin      (calls the AI, then caches)
const router = Router()
const KIND = 'root_cause'
const DAY_MS = 24 * 60 * 60 * 1000

// One generation per report at a time — a double click must not be billed twice.
const inflight = new Set<string>()

const ticketSelect = { key: true, system: true, typeOfIssue: true, businessUnit: true, summary: true, rootCause: true, resolution: true } as const

function publicInsight(i: {
  id: string; createdAt: Date; model: string; ticketCount: number; inputTokens: number | null
  outputTokens: number | null; createdByName: string | null; result: unknown
}) {
  return {
    id: i.id,
    createdAt: i.createdAt,
    model: i.model,
    createdBy: i.createdByName,
    ticketCount: i.ticketCount,
    inputTokens: i.inputTokens,
    outputTokens: i.outputTokens,
    result: i.result as InsightResult,
  }
}

async function dailyRemaining(): Promise<number> {
  const used = await prisma.reportInsight.count({ where: { createdAt: { gte: new Date(Date.now() - DAY_MS) } } })
  return Math.max(0, dailyLimit() - used)
}

// ── GET ───────────────────────────────────────────────────────
router.get('/:reportId/root-cause', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const { reportId } = req.params
    const report = await prisma.report.findUnique({ where: { id: reportId }, select: { id: true, tickets: { select: ticketSelect } } })
    if (!report) { res.status(404).json({ message: 'ไม่พบ report นี้' }); return }

    const [latest, remaining] = await Promise.all([
      prisma.reportInsight.findFirst({ where: { reportId, kind: KIND }, orderBy: { createdAt: 'desc' } }),
      dailyRemaining(),
    ])
    const built = buildEntries(report.tickets)

    res.json({
      enabled: isAiConfigured(),
      model: AI_MODEL,
      dailyRemaining: remaining,
      latest: latest ? publicInsight(latest) : null,
      preview: {
        ticketsWithText: built.ticketsWithText,
        uniqueEntries: built.entries.length,
        willAnalyse: built.ticketsAnalysed,
        truncated: built.truncated,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ── POST ──────────────────────────────────────────────────────
router.post('/:reportId/root-cause', requireRole('editor', 'admin'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const { reportId } = req.params
  let locked = false
  try {
    if (!isAiConfigured()) { res.status(503).json({ message: 'ยังไม่ได้เปิดใช้ AI — ผู้ดูแลต้องตั้งค่า ANTHROPIC_API_KEY บน server' }); return }

    const report = await prisma.report.findUnique({ where: { id: reportId }, select: { id: true, tickets: { select: ticketSelect } } })
    if (!report) { res.status(404).json({ message: 'ไม่พบ report นี้' }); return }

    const built = buildEntries(report.tickets)
    if (built.ticketsAnalysed < 2) {
      res.status(422).json({ message: 'มี ticket ที่กรอก Root Cause/Resolution ไม่ถึง 2 รายการ จึงยังหาความซ้ำไม่ได้' }); return
    }

    if ((await dailyRemaining()) <= 0) {
      res.status(429).json({ message: `ใช้ AI ครบโควตาแล้ว (${dailyLimit()} ครั้งต่อ 24 ชั่วโมง) — ลองใหม่ภายหลัง` }); return
    }

    if (inflight.has(reportId)) { res.status(409).json({ message: 'กำลังสร้างสรุปของ report นี้อยู่ กรุณารอสักครู่' }); return }
    inflight.add(reportId); locked = true

    const { raw, inputTokens, outputTokens } = await askModel(built.entries)
    const result = normalizeThemes(raw, built.entries)

    const saved = await prisma.reportInsight.create({
      data: {
        reportId, kind: KIND, result: result as unknown as object, model: AI_MODEL,
        ticketCount: built.ticketsAnalysed, inputTokens, outputTokens,
        createdById: req.user!.id, createdByName: req.user!.name,
      },
    })
    res.status(201).json(publicInsight(saved))
  } catch (err) {
    if (err instanceof AiError) { res.status(err.status).json({ message: err.message }); return }
    next(err)
  } finally {
    if (locked) inflight.delete(reportId)
  }
})

export default router
