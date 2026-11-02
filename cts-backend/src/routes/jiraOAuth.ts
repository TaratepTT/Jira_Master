import { Router, Response, NextFunction } from 'express'
import {
  oauthEnabled, buildAuthorizeUrl, verifyState, completeConnection, disconnect, connectionStatus, OAuthError,
} from '../lib/jiraOAuth.js'
import { recordAudit } from '../lib/audit.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'

// Mounted behind requireAuth at /api/jira-oauth (see index.ts and lib/jiraOAuth.ts for the flow).
const router = Router()

// ── GET /api/jira-oauth/status — is MY Jira account connected? ──
router.get('/status', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await connectionStatus(req.user!.id))
  } catch (err) {
    next(err)
  }
})

// ── POST /api/jira-oauth/start — Atlassian consent URL for me ───
router.post('/start', (req: AuthedRequest, res: Response) => {
  if (!oauthEnabled()) {
    res.status(400).json({ message: 'ผู้ดูแลระบบยังไม่ได้ตั้งค่าการเชื่อมบัญชี Jira (ATLASSIAN_CLIENT_ID / SECRET / REDIRECT_URI)' })
    return
  }
  res.json({ url: buildAuthorizeUrl(req.user!.id) })
})

// ── POST /api/jira-oauth/complete — finish after Atlassian redirected back ──
router.post('/complete', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    if (!oauthEnabled()) { res.status(400).json({ message: 'ยังไม่ได้ตั้งค่าการเชื่อมบัญชี Jira' }); return }
    const { code, state } = (req.body ?? {}) as { code?: unknown; state?: unknown }
    if (typeof code !== 'string' || !code || typeof state !== 'string' || !state) {
      res.status(400).json({ message: 'ข้อมูลจาก Atlassian ไม่ครบ — กดเชื่อมต่อใหม่อีกครั้ง' }); return
    }
    if (!verifyState(state, req.user!.id)) {
      res.status(400).json({ message: 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ (ต้องเริ่มเชื่อมต่อจากบัญชีนี้เอง ภายใน 10 นาที)' }); return
    }
    const r = await completeConnection(req.user!.id, code)
    await recordAudit(req.user, {
      action: 'user.jira_connect',
      summary: `เชื่อมบัญชี Jira: ${r.displayName}`,
      details: { jiraAccount: r.displayName, site: r.siteUrl },
    })
    res.json({ message: `เชื่อมต่อกับ Jira ในชื่อ ${r.displayName} แล้ว`, ...(await connectionStatus(req.user!.id)) })
  } catch (err) {
    if (err instanceof OAuthError) { res.status(400).json({ message: err.message }); return }
    next(err)
  }
})

// ── DELETE /api/jira-oauth — disconnect my Jira account ─────────
router.delete('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    await disconnect(req.user!.id)
    await recordAudit(req.user, { action: 'user.jira_disconnect', summary: 'ยกเลิกการเชื่อมบัญชี Jira' })
    res.json({ message: 'ยกเลิกการเชื่อมต่อแล้ว — ต่อจากนี้จะใช้บัญชีกลางของระบบ', ...(await connectionStatus(req.user!.id)) })
  } catch (err) {
    next(err)
  }
})

export default router
