import jwt from 'jsonwebtoken'

const DEFAULT_DEV_SECRET = 'change-this-secret-in-production'
const JWT_SECRET = process.env.JWT_SECRET ?? DEFAULT_DEV_SECRET

// A publicly-known fallback secret would let anyone forge login tokens, so
// production must have a real JWT_SECRET (set it in Render → Environment).
if (process.env.NODE_ENV === 'production' && (JWT_SECRET === DEFAULT_DEV_SECRET || JWT_SECRET.length < 16)) {
  throw new Error('JWT_SECRET must be set to a strong random value (16+ chars) in production')
}
const JWT_EXPIRES_IN = '7d'

export interface AuthPayload {
  username: string
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload
}
