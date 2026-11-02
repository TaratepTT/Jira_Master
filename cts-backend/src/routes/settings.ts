import { Router, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { recordAudit } from '../lib/audit.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'

// App-wide settings. Mounted behind requireAuth at /api/settings.
//   GET /api/settings/sla   -> target days per priority (any signed-in user)
//   PUT /api/settings/sla   { targets: { High: 2, ... } }   (admin only)
const router = Router()

export const DEFAULT_SLA: Record<string, number> = { Highest: 1, High: 2, Medium: 5, Low: 10, Lowest: 15 }

async function readSla(): Promise<{ targets: Record<string, number>; updatedBy: string | null; updatedAt: Date | null; isDefault: boolean }> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'sla' } })
    if (row && row.value && typeof row.value === 'object') {
      return { targets: row.value as Record<string, number>, updatedBy: row.updatedBy, updatedAt: row.updatedAt, isDefault: false }
    }
  } catch {
    // table not created yet (before `prisma db push`) -> defaults
  }
  return { targets: DEFAULT_SLA, updatedBy: null, updatedAt: null, isDefault: true }
}

router.get('/sla', async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try { res.json(await readSla()) } catch (err) { next(err) }
})

router.put('/sla', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'admin') { res.status(403).json({ message: 'แก้เป้าเวลาได้เฉพาะ admin' }); return }
    const raw = (req.body as { targets?: unknown })?.targets
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' }); return }
    const targets: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const name = k.trim().slice(0, 40)
      const n = Number(v)
      if (!name) continue
      if (!Number.isFinite(n) || n <= 0 || n > 365) { res.status(400).json({ message: `เป้าของ ${name} ต้องเป็นจำนวนวัน 0–365` }); return }
      targets[name] = Math.round(n * 10) / 10
    }
    if (!Object.keys(targets).length) { res.status(400).json({ message: 'ต้องมีอย่างน้อย 1 priority' }); return }
    const before = await readSla()
    await prisma.appSetting.upsert({
      where: { key: 'sla' },
      create: { key: 'sla', value: targets, updatedBy: req.user.name },
      update: { value: targets, updatedBy: req.user.name },
    })
    await recordAudit(req.user, { action: 'settings.sla', summary: 'แก้เป้าเวลาแก้ไข (SLA)', details: { before: before.targets, after: targets } })
    res.json(await readSla())
  } catch (err) { next(err) }
})

export default router
