import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { signToken, verifyToken } from '../lib/auth.js'
import { requireAuth, type AuthedRequest } from '../middleware/requireAuth.js'
import {
  BCRYPT_COST, DUMMY_HASH, allowedDomainsForMessage, ensureBootstrapAdmin, getBootstrap,
  getUserCached, invalidateUser, isAllowedDomain, isValidEmail, normalizeIdentifier,
  toPublicUser, validatePassword,
} from '../lib/users.js'
import prisma from '../lib/prisma.js'

const router = Router()

const BAD_LOGIN = { message: 'อีเมล/Username หรือรหัสผ่านไม่ถูกต้อง' }

// ── POST /api/auth/register ─────────────────────────────────────
// Anyone can REQUEST an account. It starts as "viewer + pending" and cannot sign in
// until an admin approves it.
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { email?: unknown; name?: unknown; password?: unknown }
    const email = normalizeIdentifier(typeof body.email === 'string' ? body.email : '')
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!isValidEmail(email)) { res.status(400).json({ message: 'รูปแบบอีเมลไม่ถูกต้อง' }); return }
    if (!isAllowedDomain(email)) {
      res.status(400).json({ message: `สมัครได้เฉพาะอีเมลของ: ${allowedDomainsForMessage()}` }); return
    }
    if (name.length < 1 || name.length > 80) { res.status(400).json({ message: 'กรุณากรอกชื่อ (ไม่เกิน 80 ตัวอักษร)' }); return }
    const pwError = validatePassword(body.password)
    if (pwError) { res.status(400).json({ message: pwError }); return }
    if (email === getBootstrap()?.identifier) {
      res.status(400).json({ message: 'อีเมลนี้สงวนไว้สำหรับผู้ดูแลระบบ' }); return
    }

    const passwordHash = await bcrypt.hash(body.password as string, BCRYPT_COST)
    try {
      await prisma.user.create({ data: { email, name, passwordHash } }) // role=viewer, status=pending by default
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        res.status(409).json({ message: 'อีเมลนี้ถูกใช้สมัครแล้ว' }); return
      }
      throw err
    }

    res.status(201).json({ message: 'สมัครสำเร็จ — รอผู้ดูแลระบบอนุมัติก่อนจึงจะเข้าสู่ระบบได้', status: 'pending' })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/login ────────────────────────────────────────
// Body: { identifier, password }   (legacy { username, password } still accepted)
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as { identifier?: unknown; username?: unknown; password?: unknown }
    const raw = typeof body.identifier === 'string' ? body.identifier : typeof body.username === 'string' ? body.username : ''
    const identifier = normalizeIdentifier(raw)
    const password = typeof body.password === 'string' ? body.password : ''

    if (!identifier || !password) {
      res.status(400).json({ message: 'กรุณากรอกอีเมล/Username และรหัสผ่าน' }); return
    }

    // 1) env bootstrap admin (only when no active admin exists), else 2) normal DB user
    let user = await ensureBootstrapAdmin(identifier, password)
    if (!user) {
      const found = await prisma.user.findUnique({ where: { email: identifier } })
      // compare against a dummy hash when the account doesn't exist → same timing either way
      const ok = await bcrypt.compare(password, found?.passwordHash ?? DUMMY_HASH)
      if (!found || !ok) { res.status(401).json(BAD_LOGIN); return }
      user = found
    }

    // Status is only revealed AFTER the password is proven correct.
    if (user.status === 'pending') {
      res.status(403).json({ code: 'PENDING', message: 'บัญชีของคุณรอผู้ดูแลระบบอนุมัติ' }); return
    }
    if (user.status !== 'active') {
      res.status(403).json({ code: 'DISABLED', message: 'บัญชีของคุณถูกระงับ กรุณาติดต่อผู้ดูแลระบบ' }); return
    }

    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .then(() => invalidateUser(user!.id))
      .catch(() => { /* best effort */ })

    res.json({ token: signToken({ sub: user.id }), user: toPublicUser(user) })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/auth/verify ────────────────────────────────────────
// The frontend calls this on load to check the stored token AND learn the user's role.
router.get('/verify', async (req: Request, res: Response) => {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) { res.status(401).json({ valid: false }); return }

  try {
    const { sub } = verifyToken(token)
    const user = await getUserCached(sub)
    if (!user || user.status !== 'active') { res.status(401).json({ valid: false }); return }
    res.json({ valid: true, user: toPublicUser(user) })
  } catch {
    res.status(401).json({ valid: false })
  }
})

// ── POST /api/auth/change-password ──────────────────────────────
router.post('/change-password', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = (req.body ?? {}) as { currentPassword?: unknown; newPassword?: unknown }
    const pwError = validatePassword(newPassword)
    if (pwError) { res.status(400).json({ message: pwError }); return }
    if (typeof currentPassword !== 'string' || !currentPassword) {
      res.status(400).json({ message: 'กรุณากรอกรหัสผ่านปัจจุบัน' }); return
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(400).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' }); return
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword as string, BCRYPT_COST) },
    })
    invalidateUser(user.id)
    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' })
  } catch (err) {
    next(err)
  }
})

export default router
