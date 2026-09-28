import jwt from 'jsonwebtoken'

const DEFAULT_DEV_SECRET = 'change-this-secret-in-production'
const JWT_SECRET = process.env.JWT_SECRET ?? DEFAULT_DEV_SECRET

// A publicly-known fallback secret would let anyone forge login tokens, so
// production must have a real JWT_SECRET (set it in Render → Environment).
if (process.env.NODE_ENV === 'production' && (JWT_SECRET === DEFAULT_DEV_SECRET || JWT_SECRET.length < 16)) {
  throw new Error('JWT_SECRET must be set to a strong random value (16+ chars) in production')
}

const JWT_EXPIRES_IN = '7d'

// The token only carries WHO the user is (their id). Role and status are always
// read from the database, so an admin changing or disabling an account takes
// effect immediately instead of when the token expires.
export interface AuthPayload {
  sub: string
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN })
}

export function verifyToken(token: string): AuthPayload {
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as Partial<AuthPayload>
  // Tokens issued by the old single-user login had { username } and no `sub`.
  if (!decoded || typeof decoded.sub !== 'string' || !decoded.sub) {
    throw new Error('invalid token payload')
  }
  return { sub: decoded.sub }
}
