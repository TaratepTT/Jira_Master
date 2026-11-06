import axios from 'axios'
import prisma from './prisma.js'
import { sharedJiraClient } from './jira.js'
import { confluenceConfigured, testConfluenceConnection } from './confluence.js'
import { watchState } from './watcher.js'
import { aiAssistAvailable } from './aiAssist.js'
import { alert, alertConfigured } from './alerts.js'
import { ARCHIVE_DAYS, lastBackupAt } from './backup.js'

// ══════════════════════════════════════════════════════════════
// E1 — keep the free Render instance awake, and one status view for admins.
//
// Render's free plan sleeps after 15 minutes without requests, and the ticket watcher sleeps with it.
// Every 10 minutes the server calls its own public URL (RENDER_EXTERNAL_URL is set by Render), which
// counts as traffic. One always-on service uses ~744 of the 750 free hours a month.
//   KEEP_AWAKE=off           turn it off
//   KEEP_AWAKE_URL=https://… use another URL (default RENDER_EXTERNAL_URL)
//   KEEP_AWAKE_MS=600000
// ══════════════════════════════════════════════════════════════

const started = Date.now()
let keep: { enabled: boolean; url: string | null; lastAt: string | null; lastOk: boolean | null; lastMs: number | null } = { enabled: false, url: null, lastAt: null, lastOk: null, lastMs: null }

export function startKeepAwake(): void {
  const url = (process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '')
  if (!url || process.env.KEEP_AWAKE === 'off') { console.log('[keepawake] off'); return }
  keep = { ...keep, enabled: true, url }
  const every = Math.max(Number(process.env.NODE_ENV === 'test' ? 1000 : 60_000), Number(process.env.KEEP_AWAKE_MS ?? 600_000))
  const ping = async () => {
    const t = Date.now()
    try {
      const r = await axios.get(`${url}/api/health`, { timeout: 20_000, validateStatus: () => true })
      keep = { ...keep, lastAt: new Date().toISOString(), lastOk: r.status < 500, lastMs: Date.now() - t }
      await alert.report('keepawake', r.status < 500, `health ตอบ HTTP ${r.status}`)
    } catch (err) {
      keep = { ...keep, lastAt: new Date().toISOString(), lastOk: false, lastMs: null }
      await alert.report('keepawake', false, `เรียก ${url} ไม่ได้ (${(err as { code?: string }).code ?? 'network'})`)
    }
  }
  console.log(`[keepawake] pinging ${url}/api/health every ${Math.round(every / 60000)} min`)
  setTimeout(() => { void ping() }, Math.min(every, 30_000)).unref?.()
  setInterval(() => { void ping() }, every).unref?.()
}

// ── token expiry reminders (Atlassian tokens last at most a year) ──
export interface TokenExpiry { jira: string | null; confluence: string | null }
export async function readTokenExpiry(): Promise<TokenExpiry> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'token.expiry' } })
    const v = (row?.value ?? {}) as Partial<TokenExpiry>
    return { jira: v.jira ?? null, confluence: v.confluence ?? null }
  } catch { return { jira: null, confluence: null } }
}
// whole calendar days from today (Thai time) to the expiry date: 0 = expires today
const TZ = process.env.APP_TIMEZONE ?? 'Asia/Bangkok'
const daysLeft = (d: string | null) => {
  if (!d) return null
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export async function checkTokenExpiry(): Promise<void> {
  const t = await readTokenExpiry()
  const soon = (['jira', 'confluence'] as const).map(k => ({ k, left: daysLeft(t[k]) })).filter(x => x.left !== null && x.left <= 7)
  if (soon.length) await alert.report('token', false, soon.map(x => `${x.k === 'jira' ? 'Jira' : 'Confluence'} API token ${x.left! < 0 ? 'หมดอายุแล้ว' : `หมดอายุใน ${x.left} วัน`}`).join(', '), { immediate: true })
  else await alert.report('token', true)
}
export function startTokenReminder(): void {
  setTimeout(() => { void checkTokenExpiry() }, 45_000).unref?.()
  setInterval(() => { void checkTokenExpiry() }, 12 * 3_600_000).unref?.()
}

// ── one status view ───────────────────────────────────────────
type Check = { ok: boolean | null; message: string; ms?: number }
let jiraCache: { at: number; v: Check } | null = null
let cfCache: { at: number; v: Check } | null = null

async function checkDb(): Promise<Check> {
  const t = Date.now()
  try { await prisma.$queryRaw`SELECT 1`; return { ok: true, message: 'เชื่อมได้', ms: Date.now() - t } }
  catch { return { ok: false, message: 'เชื่อมฐานข้อมูลไม่ได้' } }
}
async function checkJira(fresh: boolean): Promise<Check> {
  if (!fresh && jiraCache && Date.now() - jiraCache.at < 60_000) return jiraCache.v
  const t = Date.now()
  let v: Check
  try {
    const { data } = await sharedJiraClient.get('/myself')
    v = { ok: true, message: `เชื่อมได้ในชื่อ ${(data as { displayName?: string }).displayName ?? 'บัญชีกลาง'}`, ms: Date.now() - t }
  } catch (err) {
    const st = (err as { response?: { status?: number } })?.response?.status
    v = { ok: false, message: st === 401 ? 'API token ของ Jira ไม่ถูกต้องหรือหมดอายุ' : st === 403 ? 'บัญชีกลางไม่มีสิทธิ์' : `เชื่อม Jira ไม่ได้${st ? ` (HTTP ${st})` : ''}` }
  }
  jiraCache = { at: Date.now(), v }
  return v
}
async function checkConfluence(fresh: boolean): Promise<Check> {
  if (!confluenceConfigured()) return { ok: null, message: 'ยังไม่ได้ตั้งค่า' }
  if (!fresh && cfCache && Date.now() - cfCache.at < 60_000) return cfCache.v
  const t = Date.now()
  const r = await testConfluenceConnection()
  const v = { ok: r.ok, message: r.message, ms: Date.now() - t }
  cfCache = { at: Date.now(), v }
  return v
}

export async function systemStatus(fresh = false) {
  const [db, jira, confluence] = await Promise.all([checkDb(), checkJira(fresh), checkConfluence(fresh)])
  const w = watchState()
  const tokens = await readTokenExpiry()
  const last = await lastBackupAt().catch(() => null)
  const archived = await prisma.reportArchive.count().catch(() => 0)
  return {
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? process.env.npm_package_version ?? 'dev',
    uptimeSec: Math.round((Date.now() - started) / 1000),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    checks: {
      db, jira, confluence,
      watcher: { ok: !w.enabled ? null : !w.lastError, message: !w.enabled ? 'ปิดอยู่' : w.lastError ?? (w.lastRunAt ? 'ทำงานปกติ' : 'รอรอบแรก'), lastRunAt: w.lastRunAt, intervalMs: w.intervalMs },
      ai: { ok: aiAssistAvailable() ? true : null, message: aiAssistAvailable() ? 'ตั้ง ANTHROPIC_API_KEY แล้ว' : 'ไม่ได้ใช้' },
      keepAwake: { ok: !keep.enabled ? null : keep.lastOk, message: !keep.enabled ? 'ปิดอยู่ (ไม่ได้รันบน Render หรือ KEEP_AWAKE=off)' : keep.lastAt ? (keep.lastOk ? 'ปลุก server สำเร็จ' : 'ปลุก server ไม่สำเร็จ') : 'รอรอบแรก', lastAt: keep.lastAt, url: keep.url },
      alerts: { ok: alertConfigured() ? true : null, message: alertConfigured() ? 'ตั้ง ALERT_WEBHOOK_URL แล้ว' : 'ยังไม่ได้ตั้ง ALERT_WEBHOOK_URL (เห็นปัญหาได้แค่ในแอป)' },
      backup: { ok: last ? Date.now() - last.getTime() < 8 * 86_400_000 : null, message: last ? `ล่าสุด ${last.toISOString()}` : 'ยังไม่มีข้อมูลสำรอง', lastAt: last },
    },
    tokens: { ...tokens, jiraDaysLeft: daysLeft(tokens.jira), confluenceDaysLeft: daysLeft(tokens.confluence) },
    problems: alert.states().filter(s => s.failing),
    alertHistory: alert.history(),
    archive: { count: archived, keepDays: ARCHIVE_DAYS() },
  }
}
