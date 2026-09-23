import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { signToken, verifyToken } from '../lib/auth.js'

const router = Router()

const APP_USERNAME      = process.env.APP_USERNAME ?? ''
const APP_PASSWORD_HASH = process.env.APP_PASSWORD_HASH ?? ''

// ── POST /api/auth/login ────────────────────────────────────────
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string }

    if (!username || !password) {
      res.status(400).json({ message: 'กรุณากรอก username และ password' })
      return
    }

    if (!APP_USERNAME || !APP_PASSWORD_HASH) {
      res.status(500).json({ message: 'ยังไม่ได้ตั้งค่า APP_USERNAME / APP_PASSWORD_HASH บน server' })
      return
    }

    if (username !== APP_USERNAME) {
      res.status(401).json({ message: 'Username หรือ Password ไม่ถูกต้อง' })
      return
    }

    const ok = await bcrypt.compare(password, APP_PASSWORD_HASH)
    if (!ok) {
      res.status(401).json({ message: 'Username หรือ Password ไม่ถูกต้อง' })
      return
    }

    const token = signToken({ username })
    res.json({ token, username })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/auth/verify ────────────────────────────────────────
// Frontend calls this on load to check if the stored token is still valid.
router.get('/verify', (req: Request, res: Response) => {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    res.status(401).json({ valid: false })
    return
  }

  try {
    const payload = verifyToken(token)
    res.json({ valid: true, username: payload.username })
  } catch {
    res.status(401).json({ valid: false })
  }
})

export default router
