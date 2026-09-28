import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/auth.js'
import { getUserCached, type Role } from '../lib/users.js'

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; name: string; role: Role }
}

// Who may write?  viewer = read-only.  editor = sync / edit tickets / comment / upload.
// admin = everything + delete reports + manage users.
export const EDITOR_ROLES: Role[] = ['editor', 'admin']

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    res.status(401).json({ message: 'ไม่พบ token — กรุณา login' })
    return
  }

  let userId: string
  try {
    userId = verifyToken(token).sub
  } catch {
    res.status(401).json({ message: 'Token ไม่ถูกต้องหรือหมดอายุ — กรุณา login ใหม่' })
    return
  }

  try {
    const user = await getUserCached(userId)
    if (!user || user.status !== 'active') {
      res.status(401).json({ message: 'บัญชีนี้ถูกระงับหรือไม่มีอยู่ในระบบ — กรุณา login ใหม่' })
      return
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role as Role }
    next()
  } catch (err) {
    next(err)
  }
}

// Use AFTER requireAuth:  app.use('/x', requireAuth, requireRole('editor', 'admin'), router)
export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'กรุณา login' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: `สิทธิ์ของคุณ (${req.user.role}) ไม่เพียงพอสำหรับการทำรายการนี้` })
      return
    }
    next()
  }
}
