import prisma from './prisma.js'
import { recentTicketKeys } from './jira.js'
import { processTicket } from './playbooks.js'

// ══════════════════════════════════════════════════════════════
// Ticket watcher: every few minutes, pull new tickets from Jira (no Jira admin setup needed)
// and run each one through processTicket. The Jira Automation webhook is now optional —
// it only makes the comment arrive sooner.
//
//   PLAYBOOK_WATCH=off        turn the watcher off
//   PLAYBOOK_WATCH_MS=300000  how often (default 5 minutes)
//   JIRA_PROJECT_KEY=CTS      project to watch
// ══════════════════════════════════════════════════════════════

export interface WatchState { enabled: boolean; intervalMs: number; lastRunAt: string | null; lastError: string | null; lastFound: number; lastChecked: number; running: boolean }

const intervalMs = () => Math.max(process.env.NODE_ENV === 'test' ? 1000 : 60_000, Number(process.env.PLAYBOOK_WATCH_MS ?? 5 * 60_000))
const enabled = () => process.env.PLAYBOOK_WATCH !== 'off' && !!(process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL)

let running = false
let mem: Omit<WatchState, 'enabled' | 'intervalMs' | 'running'> = { lastRunAt: null, lastError: null, lastFound: 0, lastChecked: 0 }

async function loadState() {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'watch.state' } })
    if (row?.value && typeof row.value === 'object') mem = { ...mem, ...(row.value as typeof mem) }
  } catch { /* table missing */ }
}
async function saveState() {
  try {
    await prisma.appSetting.upsert({ where: { key: 'watch.state' }, create: { key: 'watch.state', value: mem, updatedBy: 'watcher' }, update: { value: mem, updatedBy: 'watcher' } })
  } catch { /* best effort */ }
}

export function watchState(): WatchState {
  return { enabled: enabled(), intervalMs: intervalMs(), running, ...mem }
}

/** One pass. Looks back to the last pass (at most 24 h, first time 2 h) so a sleeping server catches up. */
export async function runWatchOnce(): Promise<WatchState> {
  if (running) return watchState()
  running = true
  try {
    if (!mem.lastRunAt) await loadState()
    const since = mem.lastRunAt ? Date.now() - new Date(mem.lastRunAt).getTime() : 2 * 3600_000
    const hours = Math.min(24, Math.max(0.25, since / 3600_000 + 0.25))
    const keys = await recentTicketKeys(process.env.JIRA_PROJECT_KEY ?? 'CTS', hours)
    const done = new Set((await prisma.ticketCheck.findMany({ where: { ticketKey: { in: keys } }, select: { ticketKey: true } })).map(c => c.ticketKey))
    const todo = keys.filter(k => !done.has(k)).slice(0, 40).reverse() // oldest first
    for (const key of todo) {
      const r = await processTicket(key, 'watch', 'auto')
      if (r.decision === 'sent_playbook' || r.decision === 'sent_confluence') console.log(`[watch] ${key}: ${r.detail}`)
    }
    mem = { lastRunAt: new Date().toISOString(), lastError: null, lastFound: keys.length, lastChecked: todo.length }
  } catch (err) {
    const st = (err as { response?: { status?: number } })?.response?.status
    mem = { ...mem, lastRunAt: new Date().toISOString(), lastError: `ดึง ticket จาก Jira ไม่สำเร็จ${st ? ` (HTTP ${st})` : ''}` }
    console.error('[watch] failed:', (err as Error)?.message)
  } finally {
    running = false
    await saveState()
  }
  return watchState()
}

export function startTicketWatcher(): void {
  if (!enabled()) { console.log('[watch] off'); return }
  console.log(`[watch] checking new tickets every ${Math.round(intervalMs() / 60000)} min`)
  setTimeout(() => { void runWatchOnce() }, Number(process.env.PLAYBOOK_WATCH_FIRST_MS ?? 20_000)).unref?.()
  setInterval(() => { void runWatchOnce() }, intervalMs()).unref?.()
}
