import bcrypt from 'bcryptjs'
import type { User } from '@prisma/client'
import prisma from './prisma.js'

// ── Types & constants ─────────────────────────────────────────
export type Role = 'admin' | 'editor' | 'viewer'
export type Status = 'active' | 'pending' | 'disabled'
export const ROLES: readonly Role[] = ['admin', 'editor', 'viewer']
export const STATUSES: readonly Status[] = ['active', 'pending', 'disabled']

export interface PublicUser {
  id: string
  email: string
  name: string
  role: Role
  status: Status
  createdAt: Date
  lastLoginAt: Date | null
}

// Never send passwordHash to the browser.
export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    status: u.status as Status,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  }
}

// ── Input helpers ─────────────────────────────────────────────
export function normalizeIdentifier(s: string): string {
  return s.trim().toLowerCase()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isValidEmail(e: string): boolean {
  return e.length <= 254 && EMAIL_RE.test(e)
}

// Optional allow-list, e.g. ALLOWED_EMAIL_DOMAINS=allnow.co.th,example.com
// Empty/unset = any domain may REQUEST an account (an admin still has to approve it).
function allowedDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}
export function isAllowedDomain(email: string): boolean {
  const list = allowedDomains()
  if (list.length === 0) return true
  return list.includes(email.split('@')[1] ?? '')
}
export function allowedDomainsForMessage(): string {
  return allowedDomains().join(', ')
}

// bcrypt silently ignores everything after 72 BYTES (a Thai character is 3 bytes),
// so we reject longer passwords instead of accepting a weaker one than the user typed.
export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'กรุณากรอกรหัสผ่าน'
  if (pw.length < 8) return 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'
  if (Buffer.byteLength(pw, 'utf8') > 72) return 'รหัสผ่านยาวเกินไป (ไม่เกิน 72 ไบต์ ~ 72 ตัวอักษรภาษาอังกฤษ หรือ ~24 ตัวอักษรภาษาไทย)'
  return null
}

export const BCRYPT_COST = 10
// Used to burn the same CPU time when the account doesn't exist, so response time
// doesn't reveal which emails are registered.
export const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST)

// ── Bootstrap admin (from env) ────────────────────────────────
// The very first admin comes from the existing APP_USERNAME / APP_PASSWORD_HASH env
// vars (optionally ADMIN_EMAIL to use a real email as the login name). It is also the
// recovery path: if no ACTIVE admin exists, those env credentials can always sign in
// and (re)create the admin — so the system can never be locked out.
export function getBootstrap(): { identifier: string; hash: string } | null {
  const identifier = normalizeIdentifier(process.env.ADMIN_EMAIL ?? process.env.APP_USERNAME ?? '')
  const hash = process.env.APP_PASSWORD_HASH ?? ''
  if (!identifier || !hash) return null
  return { identifier, hash }
}

export async function ensureBootstrapAdmin(identifier: string, password: string): Promise<User | null> {
  const b = getBootstrap()
  if (!b || identifier !== b.identifier) return null

  const activeAdmins = await prisma.user.count({ where: { role: 'admin', status: 'active' } })
  if (activeAdmins > 0) return null

  if (!(await bcrypt.compare(password, b.hash))) return null

  // upsert (not create): if someone registered this very email first, the env
  // credentials still win and the row is taken over as the admin.
  const user = await prisma.user.upsert({
    where: { email: b.identifier },
    update: { passwordHash: b.hash, role: 'admin', status: 'active' },
    create: { email: b.identifier, name: 'Administrator', passwordHash: b.hash, role: 'admin', status: 'active' },
  })
  invalidateUser(user.id)
  return user
}

// ── Short-lived user cache ────────────────────────────────────
// requireAuth needs the user's current role/status on every request. A 30 s cache
// avoids a DB round-trip per request; admin edits invalidate it immediately.
const TTL_MS = Number.parseInt(process.env.USER_CACHE_TTL_MS ?? '', 10) || 30_000
const cache = new Map<string, { user: User; at: number }>()

export async function getUserCached(id: string): Promise<User | null> {
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user
  const user = await prisma.user.findUnique({ where: { id } })
  if (user) cache.set(id, { user, at: Date.now() })
  else cache.delete(id)
  return user
}

export function invalidateUser(id?: string): void {
  if (id) cache.delete(id)
  else cache.clear()
}
