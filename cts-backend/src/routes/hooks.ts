import { Router, Request, Response } from 'express'
import crypto from 'node:crypto'
import { processTicket } from '../lib/playbooks.js'

// OPTIONAL fast path for Jira Automation ("Send web request" when a work item is created).
// The watcher (lib/watcher.ts) already pulls new tickets every few minutes; this only makes it instant.
//   POST /api/hooks/jira/issue-created   header X-CTS-Secret: <JIRA_WEBHOOK_SECRET>   body {"key":"CTS-123"}
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
    processTicket(key, 'webhook', 'auto')
      .then(r => console.log(`[hook] ${key}: ${r.decision}`))
      .catch(err => console.error(`[hook] ${key} failed:`, (err as Error)?.message))
  }, Number(process.env.PLAYBOOK_WEBHOOK_DELAY_MS ?? 20000))
})

export default router
