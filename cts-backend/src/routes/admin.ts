import { Router, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma.js'
import { BCRYPT_COST, ROLES, STATUSES, invalidateUser, toPublicUser, validatePassword, type Role, type Status } from '../lib/users.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { recordAudit } from '../lib/audit.js'

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

    // Never log the password itself — only that it was reset.
    const changes: Record<string, { from: string; to: string }> = {}
    if (role !== undefined && role !== target.role) changes.role = { from: target.role, to: String(role) }
    if (status !== undefined && status !== target.status) changes.status = { from: target.status, to: String(status) }
    if (password !== undefined) changes.password = { from: '', to: '(รีเซ็ตรหัสผ่าน)' }
    await recordAudit(req.user, {
      action: 'user.update',
      summary: `แก้ไขผู้ใช้ ${target.email}: ${Object.keys(changes).join(', ') || 'ไม่มีการเปลี่ยนแปลง'}`,
      details: { targetUserId: id, targetEmail: target.email, changes },
    })
    res.json(toPublicUser(updated))
  } catch (err) {
    next(err)
  }
})

// ── GET /api/admin/audit ────────────────────────────────────────
// Query: page (1-based), action, q (matches ticket key, user name/email, summary)
const AUDIT_PAGE_SIZE = 50
router.get('/audit', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : ''
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''

    const where: Record<string, unknown> = {}
    if (action) where.action = action
    if (q) {
      where.OR = [
        { ticketKey: { contains: q, mode: 'insensitive' } },
        { userName:  { contains: q, mode: 'insensitive' } },
        { userEmail: { contains: q, mode: 'insensitive' } },
        { summary:   { contains: q, mode: 'insensitive' } },
      ]
    }

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * AUDIT_PAGE_SIZE,
        take: AUDIT_PAGE_SIZE,
      }),
    ])
    res.json({ items, total, page, pageSize: AUDIT_PAGE_SIZE })
  } catch (err) {
    next(err)
  }
})

export default router
