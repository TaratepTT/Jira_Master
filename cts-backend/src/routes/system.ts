import { dropRemovedList } from '../lib/removedTickets.js'
import { Router, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'
import { recordAudit } from '../lib/audit.js'
import type { AuthedRequest } from '../middleware/requireAuth.js'
import { systemStatus, checkTokenExpiry } from '../lib/system.js'
import { sendAlert } from '../lib/alerts.js'
import {
  ARCHIVE_DAYS, restoreArchivedReport, restoreMissingPlaybooks, restoreReportFromBackup, takeBackup, unpack, type Snapshot,
} from '../lib/backup.js'

// Admin only (mounted behind requireAuth + requireRole('admin') at /api/admin/system).
//   GET    /                         status of every part (?fresh=1 re-checks Jira/Confluence now)
//   PUT    /tokens                   { jira, confluence }  token expiry dates (YYYY-MM-DD or null)
//   POST   /test-alert               send a test message to ALERT_WEBHOOK_URL
//   GET    /backups                  snapshots (without the data)
//   POST   /backups                  take one now
//   GET    /backups/:id/download     .json.gz
//   GET    /backups/:id/reports      reports inside a snapshot, and whether each still exists
//   POST   /backups/:id/restore-report     { reportId }
//   POST   /backups/:id/restore-playbooks  playbooks missing now
//   GET    /trash                    deleted reports (kept 30 days)
//   POST   /trash/:id/restore
//   DELETE /trash/:id                delete for good
const router = Router()
const DATE = /^\d{4}-\d{2}-\d{2}$/

router.get('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try { res.json(await systemStatus(req.query.fresh === '1')) } catch (err) { next(err) }
})

router.put('/tokens', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const b = (req.body ?? {}) as { jira?: unknown; confluence?: unknown }
    const norm = (v: unknown) => (v === null || v === '' || v === undefined ? null : String(v))
    const value = { jira: norm(b.jira), confluence: norm(b.confluence) }
    if ((value.jira && !DATE.test(value.jira)) || (value.confluence && !DATE.test(value.confluence))) { res.status(400).json({ message: 'วันที่ต้องเป็นรูปแบบ YYYY-MM-DD' }); return }
    await prisma.appSetting.upsert({ where: { key: 'token.expiry' }, create: { key: 'token.expiry', value, updatedBy: req.user!.name }, update: { value, updatedBy: req.user!.name } })
    await recordAudit(req.user, { action: 'settings.tokens', summary: `ตั้งวันหมดอายุ token: Jira ${value.jira ?? '—'}, Confluence ${value.confluence ?? '—'}` })
    await checkTokenExpiry()
    res.json(await systemStatus())
  } catch (err) { next(err) }
})

router.post('/test-alert', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const r = await sendAlert(`ข้อความทดสอบจาก ${req.user!.name} ถ้าเห็นข้อความนี้ การแจ้งเตือนใช้ได้แล้ว`)
    res.status(r.ok ? 200 : 400).json(r)
  } catch (err) { next(err) }
})

router.get('/backups', async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.backup.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, createdBy: true, createdAt: true, size: true, counts: true } })
    res.json(rows.map(b => ({ id: b.id, kind: b.kind, createdBy: b.createdBy, createdAt: b.createdAt, size: b.size, counts: b.counts })))
  } catch (err) { next(err) }
})

router.post('/backups', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try { res.status(201).json(await takeBackup('manual', req.user)) } catch (err) {
    if ((err as { status?: number }).status === 413) { res.status(413).json({ message: 'ข้อมูลใหญ่เกินกว่าจะเก็บในฐานข้อมูล ให้ลบ report เก่าที่ไม่ใช้ก่อน' }); return }
    next(err)
  }
})

router.get('/backups/:id/download', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const b = await prisma.backup.findUnique({ where: { id: String(req.params.id) } })
    if (!b) { res.status(404).json({ message: 'ไม่พบข้อมูลสำรองนี้' }); return }
    await recordAudit(req.user, { action: 'backup.download', summary: `ดาวน์โหลดข้อมูลสำรองวันที่ ${b.createdAt.toISOString().slice(0, 10)}` })
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Disposition', `attachment; filename="cts-backup-${b.createdAt.toISOString().slice(0, 10)}.json.gz"`)
    res.end(Buffer.from(b.payload))
  } catch (err) { next(err) }
})

router.get('/backups/:id/reports', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const b = await prisma.backup.findUnique({ where: { id: String(req.params.id) } })
    if (!b) { res.status(404).json({ message: 'ไม่พบข้อมูลสำรองนี้' }); return }
    const snap = unpack<Snapshot>(b.payload)
    const ids = snap.reports.map(r => String(r.report.id))
    const now = new Set((await prisma.report.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id))
    res.json(snap.reports.map(r => ({ id: String(r.report.id), name: String(r.report.name), tickets: r.tickets.length, createdAt: r.report.createdAt, exists: now.has(String(r.report.id)) })))
  } catch (err) { next(err) }
})

router.post('/backups/:id/restore-report', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const r = await restoreReportFromBackup(String(req.params.id), String((req.body as { reportId?: unknown })?.reportId ?? ''), req.user)
    if (!r.ok) { res.status(r.status).json({ message: r.message }); return }
    res.json(r)
  } catch (err) { next(err) }
})

router.post('/backups/:id/restore-playbooks', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const r = await restoreMissingPlaybooks(String(req.params.id), req.user)
    if (!r.ok) { res.status(r.status).json({ message: r.message }); return }
    res.json(r)
  } catch (err) { next(err) }
})

router.get('/trash', async (_req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.reportArchive.findMany({ orderBy: { deletedAt: 'desc' }, select: { id: true, name: true, totalTickets: true, deletedBy: true, deletedAt: true } })
    const days = ARCHIVE_DAYS()
    res.json({ keepDays: days, items: rows.map(r => ({ id: r.id, name: r.name, totalTickets: r.totalTickets, deletedBy: r.deletedBy, deletedAt: r.deletedAt, purgeAt: new Date(r.deletedAt.getTime() + days * 86_400_000) })) })
  } catch (err) { next(err) }
})

router.post('/trash/:id/restore', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const r = await restoreArchivedReport(String(req.params.id), req.user)
    if (!r.ok) { res.status(r.status).json({ message: r.message }); return }
    res.json(r)
  } catch (err) { next(err) }
})

router.delete('/trash/:id', async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const a = await prisma.reportArchive.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } })
    if (!a) { res.status(404).json({ message: 'ไม่พบ report นี้ในถังขยะ' }); return }
    await prisma.reportArchive.delete({ where: { id: a.id } })
    await dropRemovedList(a.id)
    await recordAudit(req.user, { action: 'report.purge', reportId: a.id, summary: `ลบ report "${a.name}" ออกจากถังขยะถาวร` })
    res.status(204).end()
  } catch (err) { next(err) }
})

export default router
