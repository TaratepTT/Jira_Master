import { Router, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'

// Saved Dashboard filter sets. Mounted behind requireAuth at /api/views.
//   GET    /api/views        -> my views + views others shared
//   POST   /api/views        { name, query, shared? }
//   DELETE /api/views/:id    (owner, or admin)
const router = Router()
const MAX_PER_USER = 50

// Only the filter keys the Dashboard understands; anything else is dropped.
const ALLOWED_KEYS = new Set(['q', 'bu', 'st', 'sys', 'cat', 'as', 'incomplete', 'sort'])
function cleanQuery(raw: string): string {
  const p = new URLSearchParams(raw.replace(/^\?/, ''))
  const out = new URLSearchParams()
  for (const [k, v] of p) if (ALLOWED_KEYS.has(k) && v.length <= 200) out.append(k, v)
  return out.toString()
}

router.get('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const me = req.user!.id
    const views = await prisma.savedView.findMany({
      where: { OR: [{ userId: me }, { shared: true }] },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ views: views.map(v => ({ id: v.id, name: v.name, query: v.query, shared: v.shared, owner: v.userName, mine: v.userId === me })) })
  } catch (err) { next(err) }
})

router.post('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; query?: unknown; shared?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
    const query = typeof body.query === 'string' ? cleanQuery(body.query) : ''
    if (!name) { res.status(400).json({ message: 'ตั้งชื่อมุมมองก่อนบันทึก' }); return }
    if (!query) { res.status(400).json({ message: 'ยังไม่ได้เลือกตัวกรอง — ไม่มีอะไรให้บันทึก' }); return }
    const count = await prisma.savedView.count({ where: { userId: req.user!.id } })
    if (count >= MAX_PER_USER) { res.status(400).json({ message: `บันทึกได้สูงสุด ${MAX_PER_USER} มุมมองต่อคน` }); return }
    const v = await prisma.savedView.create({
      data: { userId: req.user!.id, userName: req.user!.name, name, query, shared: body.shared === true },
    })
    res.status(201).json({ view: { id: v.id, name: v.name, query: v.query, shared: v.shared, owner: v.userName, mine: true } })
  } catch (err) { next(err) }
})

router.delete('/:id', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const v = await prisma.savedView.findUnique({ where: { id: req.params.id } })
    if (!v) { res.status(404).json({ message: 'ไม่พบมุมมองนี้' }); return }
    if (v.userId !== req.user!.id && req.user!.role !== 'admin') { res.status(403).json({ message: 'ลบได้เฉพาะมุมมองของตัวเอง' }); return }
    await prisma.savedView.delete({ where: { id: v.id } })
    res.json({ message: 'ลบแล้ว' })
  } catch (err) { next(err) }
})

export default router
