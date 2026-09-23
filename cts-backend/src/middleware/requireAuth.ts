import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/auth.js'

export interface AuthedRequest extends Request {
  user?: { username: string }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    res.status(401).json({ message: 'ไม่พบ token — กรุณา login' })
    return
  }

  try {
    const payload = verifyToken(token)
    req.user = { username: payload.username }
    next()
  } catch {
    res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ — กรุณา login ใหม่' })
  }
}
