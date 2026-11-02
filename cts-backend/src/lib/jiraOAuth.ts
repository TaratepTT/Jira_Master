import axios, { type AxiosInstance } from 'axios'
import jwt from 'jsonwebtoken'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import prisma from './prisma.js'

// ══════════════════════════════════════════════════════════════
// Per-user Jira access — Atlassian OAuth 2.0 (3LO)
// ══════════════════════════════════════════════════════════════
// Optional. Turned on when these env vars are set on the backend:
//   ATLASSIAN_CLIENT_ID, ATLASSIAN_CLIENT_SECRET
//   ATLASSIAN_REDIRECT_URI  = <frontend>/account/jira-callback   (must match the app's Callback URL)
//   JIRA_TOKEN_ENC_KEY      = long random string (encrypts stored tokens; falls back to JWT_SECRET)
//
// Flow (the callback is a FRONTEND page on purpose):
//   1. POST /api/jira-oauth/start      -> Atlassian consent URL with a signed `state` bound to this user
//   2. Atlassian redirects the browser to <frontend>/account/jira-callback?code&state
//   3. That page (already logged in to the Dashboard) POSTs code+state to /api/jira-oauth/complete
//   4. The backend checks state.sub === the logged-in user, so nobody can attach THEIR Jira
//      account to someone else's Dashboard login by sending a crafted link.

// Atlassian endpoints (overridable only so the flow can be tested against a local mock)
const AUTH_BASE = (process.env.ATLASSIAN_AUTH_BASE ?? 'https://auth.atlassian.com').replace(/\/+$/, '')
const API_BASE = (process.env.ATLASSIAN_API_BASE ?? 'https://api.atlassian.com').replace(/\/+$/, '')
const AUTH_URL = `${AUTH_BASE}/authorize`
const TOKEN_URL = `${AUTH_BASE}/oauth/token`
const RESOURCES_URL = `${API_BASE}/oauth/token/accessible-resources`
export const OAUTH_SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access']

const STATE_PURPOSE = 'jira-oauth'
const STATE_TTL = '10m'

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

export function oauthEnabled(): boolean {
  return Boolean(env('ATLASSIAN_CLIENT_ID') && env('ATLASSIAN_CLIENT_SECRET') && env('ATLASSIAN_REDIRECT_URI'))
}

function baseSecret(): string {
  const s = env('JWT_SECRET')
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required')
  return 'change-this-secret-in-production'
}
// The OAuth `state` is signed with a key DERIVED from JWT_SECRET, never JWT_SECRET itself:
// it travels through Atlassian and the browser's URL bar, so it must not be usable as a login token.
function stateSecret(): string {
  return createHash('sha256').update(`jira-oauth-state:${baseSecret()}`).digest('hex')
}

// ── Token encryption (AES-256-GCM) ─────────────────────────────
function encKey(): Buffer {
  const base = env('JIRA_TOKEN_ENC_KEY') || `jira-token:${baseSecret()}`
  return createHash('sha256').update(base).digest()
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join('.')
}

export function decrypt(blob: string): string {
  const [v, iv, tag, data] = blob.split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('bad token blob')
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}

// ── Step 1: consent URL ────────────────────────────────────────
export function buildAuthorizeUrl(userId: string): string {
  const state = jwt.sign({ sub: userId, purpose: STATE_PURPOSE, n: randomBytes(8).toString('hex') }, stateSecret(), { algorithm: 'HS256', expiresIn: STATE_TTL })
  const p = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: env('ATLASSIAN_CLIENT_ID'),
    scope: OAUTH_SCOPES.join(' '),
    redirect_uri: env('ATLASSIAN_REDIRECT_URI'),
    state,
    response_type: 'code',
    prompt: 'consent',
  })
  return `${AUTH_URL}?${p.toString()}`
}

export function verifyState(state: string, userId: string): boolean {
  try {
    const p = jwt.verify(state, stateSecret(), { algorithms: ['HS256'] }) as { sub?: string; purpose?: string }
    return p.purpose === STATE_PURPOSE && p.sub === userId
  } catch {
    return false
  }
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope?: string }

function siteHost(url: string): string {
  try { return new URL(url).host.toLowerCase() } catch { return '' }
}

export class OAuthError extends Error {}

// ── Step 3: exchange the code and remember the account ─────────
export async function completeConnection(userId: string, code: string): Promise<{ displayName: string; siteUrl: string }> {
  let tok: TokenResponse
  try {
    const { data } = await axios.post(TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: env('ATLASSIAN_CLIENT_ID'),
      client_secret: env('ATLASSIAN_CLIENT_SECRET'),
      code,
      redirect_uri: env('ATLASSIAN_REDIRECT_URI'),
    }, { timeout: 15_000 })
    tok = data as TokenResponse
  } catch (err) {
    const d = (err as { response?: { data?: unknown } })?.response?.data
    console.error('[jira-oauth] code exchange failed', JSON.stringify(d))
    throw new OAuthError('Atlassian ไม่รับรหัสยืนยัน (อาจหมดอายุหรือใช้ซ้ำ) — กดเชื่อมต่อใหม่อีกครั้ง')
  }
  if (!tok.refresh_token) throw new OAuthError('Atlassian ไม่ส่ง refresh token มา — ตรวจว่าแอปเปิด scope offline_access แล้ว')

  // Which Jira site? Must be the same one the Dashboard syncs from (JIRA_BASE_URL).
  const { data: resources } = await axios.get(RESOURCES_URL, {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' }, timeout: 15_000,
  })
  const wanted = siteHost(env('JIRA_BASE_URL'))
  const list = (resources as Array<{ id: string; url: string; name: string }>) ?? []
  const site = list.find(r => siteHost(r.url) === wanted) ?? (wanted ? undefined : list[0])
  if (!site) {
    throw new OAuthError(`บัญชีนี้ไม่ได้ให้สิทธิ์เข้าถึง ${wanted || 'Jira site'} — ตอนกดยินยอมให้เลือก site นี้`)
  }

  const client = makeUserClient(site.id, tok.access_token)
  const { data: me } = await client.get('/myself')
  const m = me as { accountId: string; displayName?: string; emailAddress?: string }

  const record = {
    accountId: m.accountId,
    displayName: m.displayName ?? m.emailAddress ?? 'Jira user',
    email: m.emailAddress ?? null,
    cloudId: site.id,
    siteUrl: site.url,
    accessTokenEnc: encrypt(tok.access_token),
    refreshTokenEnc: encrypt(tok.refresh_token),
    expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000),
    scopes: tok.scope ?? OAUTH_SCOPES.join(' '),
    valid: true,
  }
  await prisma.jiraConnection.upsert({ where: { userId }, create: { userId, ...record }, update: record })
  cache.delete(userId)
  return { displayName: record.displayName, siteUrl: site.url }
}

export function makeUserClient(cloudId: string, accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: `${API_BASE}/ex/jira/${cloudId}/rest/api/3`,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    timeout: 30_000,
  })
}

// ── Getting a ready-to-use client for a user (refreshing when needed) ──
// Atlassian rotates refresh tokens: each refresh returns a NEW refresh token and the old one
// stops working, so two refreshes for the same user must never run at once (single-flight).
interface Cached { client: AxiosInstance; expiresAt: number; displayName: string }
const cache = new Map<string, Cached>()
const inflight = new Map<string, Promise<UserJira | null>>()

export interface UserJira { client: AxiosInstance; displayName: string }
export type UserJiraResult = UserJira | { error: string } | null // null = never connected

export async function getUserJira(userId: string): Promise<UserJiraResult> {
  if (!oauthEnabled()) return null
  const c = cache.get(userId)
  if (c && c.expiresAt > Date.now() + 30_000) return { client: c.client, displayName: c.displayName }

  const conn = await prisma.jiraConnection.findUnique({ where: { userId } })
  if (!conn) return null
  if (!conn.valid) return { error: 'การเชื่อมต่อ Jira ของคุณหมดอายุ — ไปที่ "บัญชีของฉัน" แล้วเชื่อมต่อใหม่' }

  if (conn.expiresAt.getTime() > Date.now() + 30_000) {
    try {
      const client = makeUserClient(conn.cloudId, decrypt(conn.accessTokenEnc))
      cache.set(userId, { client, expiresAt: conn.expiresAt.getTime(), displayName: conn.displayName })
      return { client, displayName: conn.displayName }
    } catch {
      // undecryptable (key changed) -> treat like an expired token and refresh below
    }
  }

  let p = inflight.get(userId)
  if (!p) {
    p = refresh(userId).finally(() => inflight.delete(userId))
    inflight.set(userId, p)
  }
  const r = await p
  return r ?? { error: 'ต่ออายุการเชื่อมต่อ Jira ไม่สำเร็จ — ไปที่ "บัญชีของฉัน" แล้วเชื่อมต่อใหม่' }
}

async function refresh(userId: string): Promise<UserJira | null> {
  const conn = await prisma.jiraConnection.findUnique({ where: { userId } })
  if (!conn || !conn.valid) return null
  let refreshToken: string
  try {
    refreshToken = decrypt(conn.refreshTokenEnc)
  } catch {
    await markInvalid(userId)
    return null
  }
  try {
    const { data } = await axios.post(TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: env('ATLASSIAN_CLIENT_ID'),
      client_secret: env('ATLASSIAN_CLIENT_SECRET'),
      refresh_token: refreshToken,
    }, { timeout: 15_000 })
    const tok = data as TokenResponse
    const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000)
    await prisma.jiraConnection.update({
      where: { userId },
      data: {
        accessTokenEnc: encrypt(tok.access_token),
        ...(tok.refresh_token ? { refreshTokenEnc: encrypt(tok.refresh_token) } : {}),
        expiresAt,
      },
    })
    const client = makeUserClient(conn.cloudId, tok.access_token)
    cache.set(userId, { client, expiresAt: expiresAt.getTime(), displayName: conn.displayName })
    return { client, displayName: conn.displayName }
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    console.error(`[jira-oauth] refresh failed for user ${userId} (HTTP ${status ?? '-'})`)
    // 400/401/403 = token revoked or expired for good. Network errors: keep it valid and retry later.
    if (status && status >= 400 && status < 500) await markInvalid(userId)
    return null
  }
}

async function markInvalid(userId: string): Promise<void> {
  cache.delete(userId)
  await prisma.jiraConnection.update({ where: { userId }, data: { valid: false } }).catch(() => undefined)
}

export async function disconnect(userId: string): Promise<void> {
  cache.delete(userId)
  await prisma.jiraConnection.deleteMany({ where: { userId } })
}

export async function connectionStatus(userId: string) {
  const conn = oauthEnabled() ? await prisma.jiraConnection.findUnique({ where: { userId } }) : null
  return {
    enabled: oauthEnabled(),
    connected: Boolean(conn?.valid),
    needsReconnect: Boolean(conn && !conn.valid),
    account: conn ? { displayName: conn.displayName, email: conn.email, siteUrl: conn.siteUrl } : null,
    connectedAt: conn?.createdAt ?? null,
  }
}
