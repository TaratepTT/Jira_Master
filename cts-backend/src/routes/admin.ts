import { Router, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma.js'
import { BCRYPT_COST, ROLES, STATUSES, invalidateUser, toPublicUser, validatePassword, type Role, type Status } from '../lib/users.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'

// Mounted behind requireAuth + requireRole('admin') in index.ts.
const router = Router()

// ── GET /api/admin/users ────────────────────────────────────────
router.get('/users', async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
    // people waiting for approval first
    const rank = (s: string) => (s === 'pending' ? 0 : s === 'active' ? 1 : 2)
    users.sort((a, b) => rank(a.status) - rank(b.status))
    res.json(users.map(toPublicUser))
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/admin/users/:id ──────────────────────────────────
// Body (any of): { role, status, password }
// Approve = { status: 'active', role: 'editor' }   Suspend = { status: 'disabled' }
router.patch('/users/:id', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const { role, status, password } = (req.body ?? {}) as { role?: unknown; status?: unknown; password?: unknown }

    if (role === undefined && status === undefined && password === undefined) {
      res.status(400).json({ message: 'ไม่มีข้อมูลที่จะแก้ไข' }); return
    }
    if (role !== undefined && !ROLES.includes(role as Role)) { res.status(400).json({ message: 'role ไม่ถูกต้อง' }); return }
    if (status !== undefined && !STATUSES.includes(status as Status)) { res.status(400).json({ message: 'status ไม่ถูกต้อง' }); return }
    if (password !== undefined) {
      const pwError = validatePassword(password)
      if (pwError) { res.status(400).json({ message: pwError }); return }
    }

    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) { res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' }); return }

    // An admin can't demote/suspend themselves (they'd lose access to this very page).
    if (id === req.user!.id && ((role !== undefined && role !== target.role) || (status !== undefined && status !== target.status))) {
      res.status(400).json({ message: 'ไม่สามารถเปลี่ยนสิทธิ์หรือสถานะของบัญชีตัวเองได้ — ให้ admin คนอื่นทำแทน' }); return
    }

    const data: { role?: string; status?: string; passwordHash?: string } = {}
    if (role !== undefined) data.role = role as string
    if (status !== undefined) data.status = status as string
    if (password !== undefined) data.passwordHash = await bcrypt.hash(password as string, BCRYPT_COST)

    const updated = await prisma.user.update({ where: { id }, data })
    invalidateUser(id) // takes effect on the user's very next request
    res.json(toPublicUser(updated))
  } catch (err) {
    next(err)
  }
})

export default router
