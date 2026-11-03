import { Router, Request, Response } from 'express'
import crypto from 'node:crypto'
import { autoHandleTicket } from '../lib/playbooks.js'
import { recentTicketKeys } from '../lib/jira.js'
import prisma from '../lib/prisma.js'

// Public endpoint for Jira Automation ("Send web request" when a work item is created).
//   POST /api/hooks/jira/issue-created   header X-CTS-Secret: <JIRA_WEBHOOK_SECRET>   body {"key":"CTS-123"}
// Answers 202 at once (Jira Automation times out after a few seconds) and does the work after.
// Off unless JIRA_WEBHOOK_SECRET is set.
const router = Router()

function secretOk(given: unknown): boolean {
  const want = process.env.JIRA_WEBHOOK_SECRET ?? ''
  if (!want || typeof given !== 'string') return false
  const a = Buffer.from(given), b = Buffer.from(want)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/

router.post('/jira/issue-created', (req: Request, res: Response) => {
  if (!process.env.JIRA_WEBHOOK_SECRET) { res.status(404).json({ message: 'Route not found' }); return }
  if (!secretOk(req.get('x-cts-secret'))) { res.status(401).json({ message: 'secret ไม่ถูกต้อง' }); return }
  const body = (req.body ?? {}) as { key?: unknown; issue?: { key?: unknown } }
  const key = String(body.key ?? body.issue?.key ?? '').trim().toUpperCase()
  if (!KEY_RE.test(key)) { res.status(400).json({ message: 'ต้องส่ง {"key":"{{issue.key}}"}' }); return }
  res.status(202).json({ accepted: key })
  // small delay: Jira fires the rule right after create, before custom fields are filled in
  setTimeout(() => {
    autoHandleTicket(key)
      .then(r => console.log(`[playbook] ${key}: ${r.ok ? `sent "${r.title}"` : r.reason}`))
      .catch(err => console.error(`[playbook] ${key} failed:`, (err as Error)?.message))
  }, Number(process.env.PLAYBOOK_WEBHOOK_DELAY_MS ?? 20000))
})

// ── Sweeper: Render free instances sleep, so a webhook can be missed. Every 10 minutes look at
// tickets created in the last 2 hours and handle the ones that never got a playbook decision.
const seen = new Map<string, number>() // key -> time we decided (no match / low score), so we don't refetch each run
export function startPlaybookSweeper(): void {
  if (!process.env.JIRA_WEBHOOK_SECRET || process.env.PLAYBOOK_SWEEP === 'off') return
  const project = process.env.JIRA_PROJECT_KEY ?? 'CTS'
  const every = Number(process.env.PLAYBOOK_SWEEP_MS ?? 10 * 60 * 1000)
  const run = async () => {
    try {
      const keys = await recentTicketKeys(project, 2)
      const done = new Set((await prisma.playbookDelivery.findMany({ where: { ticketKey: { in: keys } }, select: { ticketKey: true } })).map(d => d.ticketKey))
      const now = Date.now()
      for (const [k, t] of seen) if (now - t > 3 * 3600_000) seen.delete(k)
      for (const key of keys) {
        if (done.has(key) || seen.has(key)) continue
        const r = await autoHandleTicket(key)
        if (!r.ok) seen.set(key, now)
        else console.log(`[playbook] sweep ${key}: sent "${r.title}"`)
      }
    } catch (err) {
      console.error('[playbook] sweep failed:', (err as Error)?.message)
    }
  }
  setTimeout(run, 30_000).unref?.()
  setInterval(run, every).unref?.()
}

export default router
