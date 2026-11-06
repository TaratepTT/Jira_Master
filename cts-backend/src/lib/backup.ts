import zlib from 'node:zlib'
import prisma from './prisma.js'
import { invalidateKnownTickets } from './similar.js'
import { recordAudit, type AuditActor } from './audit.js'
import { alert } from './alerts.js'

// ══════════════════════════════════════════════════════════════
// E2 — backups
//  • Deleting a report first copies it (report + tickets + AI summaries) into report_archives.
//    An admin can restore it from "ถังขยะ" for 30 days; after that it is purged.
//  • Once a week (and on demand) a snapshot of the app's own data goes into backups (newest 8 kept)
//    and can be downloaded as .json.gz. Jira stays the source of truth for tickets, so the snapshot
//    protects what only this app has: report snapshots and edits, playbooks, settings, users, history.
//    Password hashes and Jira OAuth tokens are never put in a snapshot.
//
//   ARCHIVE_DAYS=30   BACKUP_EVERY_DAYS=7   BACKUP_KEEP=8   BACKUP=off (stop the weekly snapshot)
// ══════════════════════════════════════════════════════════════

export const ARCHIVE_DAYS = () => Math.max(1, Number(process.env.ARCHIVE_DAYS ?? 30))
const EVERY_DAYS = () => Math.max(1, Number(process.env.BACKUP_EVERY_DAYS ?? 7))
const KEEP = () => Math.max(1, Number(process.env.BACKUP_KEEP ?? 8))
const MAX_BYTES = 40 * 1024 * 1024

export const pack = (v: unknown): Buffer => zlib.gzipSync(Buffer.from(JSON.stringify(v)), { level: 9 })
export const unpack = <T = unknown>(b: Uint8Array | Buffer): T => JSON.parse(zlib.gunzipSync(Buffer.from(b)).toString('utf8')) as T

// Dates come back from JSON as strings; turn the known date fields back into Date objects
const DATE_KEYS = new Set(['createdAt', 'updatedAt', 'refreshedAt', 'ticketCreatedAt', 'resolvedAt', 'lastLoginAt', 'checkedAt'])
export function revive<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row }
  for (const k of Object.keys(out)) if (DATE_KEYS.has(k) && typeof out[k] === 'string') out[k] = new Date(out[k] as string)
  return out as T
}

interface ReportPayload {
  report: Record<string, unknown>
  tickets: Array<Record<string, unknown>>
  insights: Array<Record<string, unknown>>
}

async function reportPayload(id: string): Promise<ReportPayload | null> {
  const report = await prisma.report.findUnique({ where: { id } })
  if (!report) return null
  const tickets = await prisma.ticket.findMany({ where: { reportId: id } })
  const insights = await prisma.reportInsight.findMany({ where: { reportId: id } })
  return { report: report as unknown as Record<string, unknown>, tickets: tickets as unknown as Array<Record<string, unknown>>, insights: insights as unknown as Array<Record<string, unknown>> }
}

async function writeReport(p: ReportPayload): Promise<void> {
  const r = revive(p.report)
  await prisma.report.create({
    data: {
      id: String(r.id), name: String(r.name), period: (r.period as string | null) ?? null, totalTickets: Number(r.totalTickets ?? p.tickets.length),
      createdAt: r.createdAt as Date, refreshedAt: (r.refreshedAt as Date | null) ?? null,
    },
  })
  if (p.tickets.length) {
    await prisma.ticket.createMany({ data: p.tickets.map(t => { const x = revive(t); delete (x as { report?: unknown }).report; return x as never }) })
  }
  if (p.insights.length) {
    await prisma.reportInsight.createMany({ data: p.insights.map(i => revive(i) as never) })
  }
  invalidateKnownTickets()
}

/** Copy a report into the archive. Call before deleting it. */
export async function archiveReport(id: string, actor: AuditActor | undefined): Promise<boolean> {
  const p = await reportPayload(id)
  if (!p) return false
  const data = { name: String(p.report.name), totalTickets: p.tickets.length, deletedBy: actor?.name ?? 'ระบบ', deletedAt: new Date(), payload: pack(p) }
  await prisma.reportArchive.upsert({ where: { id }, create: { id, ...data }, update: data })
  return true
}

export type RestoreResult = { ok: true; id: string; name: string; tickets: number } | { ok: false; status: number; message: string }

export async function restoreArchivedReport(id: string, actor: AuditActor | undefined): Promise<RestoreResult> {
  const a = await prisma.reportArchive.findUnique({ where: { id } })
  if (!a) return { ok: false, status: 404, message: 'ไม่พบ report นี้ในถังขยะ' }
  if (await prisma.report.findUnique({ where: { id }, select: { id: true } })) return { ok: false, status: 409, message: 'มี report นี้อยู่ในระบบแล้ว' }
  const p = unpack<ReportPayload>(a.payload)
  await writeReport(p)
  await prisma.reportArchive.delete({ where: { id } })
  await recordAudit(actor, { action: 'report.restore', reportId: id, summary: `กู้คืน report "${a.name}" (${p.tickets.length} ticket) จากถังขยะ` })
  return { ok: true, id, name: a.name, tickets: p.tickets.length }
}

export async function purgeArchives(): Promise<number> {
  const cutoff = new Date(Date.now() - ARCHIVE_DAYS() * 86_400_000)
  const old = await prisma.reportArchive.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } })
  if (!old.length) return 0
  await prisma.reportArchive.deleteMany({ where: { id: { in: old.map(o => o.id) } } })
  // the report is gone for good, so is its list of removed tickets
  await prisma.appSetting.deleteMany({ where: { key: { in: old.map(o => `report.removed.${o.id}`) } } })
  return old.length
}

// ── snapshots ─────────────────────────────────────────────────
export interface Snapshot {
  version: 1
  takenAt: string
  reports: ReportPayload[]
  playbooks: unknown[]
  playbookDeliveries: unknown[]
  savedViews: unknown[]
  appSettings: unknown[]
  users: unknown[]
  ticketChecks: unknown[]
  auditLog: unknown[]
}

export async function buildSnapshot(): Promise<Snapshot> {
  const reports = await prisma.report.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  const payloads: ReportPayload[] = []
  for (const r of reports) { const p = await reportPayload(r.id); if (p) payloads.push(p) }
  // pick the safe fields by hand as well as in select, so a password hash can never slip into a snapshot
  const users = (await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, status: true, createdAt: true, lastLoginAt: true } }))
    .map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt }))
  const settings = (await prisma.appSetting.findMany({})).filter(s => !String(s.key).startsWith('watch.'))
  return {
    version: 1,
    takenAt: new Date().toISOString(),
    reports: payloads,
    playbooks: await prisma.playbook.findMany({}),
    playbookDeliveries: await prisma.playbookDelivery.findMany({}),
    savedViews: await prisma.savedView.findMany({}),
    appSettings: settings,
    users, // no password hashes
    ticketChecks: await prisma.ticketCheck.findMany({ orderBy: { checkedAt: 'desc' }, take: 2000 }),
    auditLog: await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5000 }),
  }
}

export const snapshotCounts = (s: Snapshot) => ({
  reports: s.reports.length,
  tickets: s.reports.reduce((n, r) => n + r.tickets.length, 0),
  playbooks: s.playbooks.length,
  deliveries: s.playbookDeliveries.length,
  savedViews: s.savedViews.length,
  users: s.users.length,
})

export async function takeBackup(kind: 'auto' | 'manual', actor: AuditActor | undefined) {
  const snap = await buildSnapshot()
  const payload = pack(snap)
  if (payload.length > MAX_BYTES) throw Object.assign(new Error('snapshot too large'), { status: 413 })
  const counts = snapshotCounts(snap)
  const row = await prisma.backup.create({ data: { kind, createdBy: actor?.name ?? 'อัตโนมัติ', size: payload.length, counts, payload } })
  // keep the newest N
  const all = await prisma.backup.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true } })
  for (const old of all.slice(KEEP())) await prisma.backup.delete({ where: { id: old.id } })
  await recordAudit(actor, { action: 'backup.create', summary: `สำรองข้อมูล${kind === 'auto' ? 'อัตโนมัติ' : ''}: ${counts.reports} report, ${counts.tickets} ticket, ${counts.playbooks} คู่มือ`, details: { id: row.id, size: payload.length } })
  return { id: row.id, kind, createdAt: row.createdAt, size: payload.length, counts }
}

/** Put one report from a snapshot back (only when it is not in the system any more) */
export async function restoreReportFromBackup(backupId: string, reportId: string, actor: AuditActor | undefined): Promise<RestoreResult> {
  const b = await prisma.backup.findUnique({ where: { id: backupId } })
  if (!b) return { ok: false, status: 404, message: 'ไม่พบข้อมูลสำรองนี้' }
  const snap = unpack<Snapshot>(b.payload)
  const p = snap.reports.find(r => r.report.id === reportId)
  if (!p) return { ok: false, status: 404, message: 'ไม่มี report นี้ในข้อมูลสำรอง' }
  if (await prisma.report.findUnique({ where: { id: reportId }, select: { id: true } })) return { ok: false, status: 409, message: 'มี report นี้อยู่ในระบบแล้ว' }
  await writeReport(p)
  await prisma.reportArchive.deleteMany({ where: { id: reportId } })
  await recordAudit(actor, { action: 'report.restore', reportId, summary: `กู้คืน report "${String(p.report.name)}" จากข้อมูลสำรองวันที่ ${b.createdAt.toISOString().slice(0, 10)}` })
  return { ok: true, id: reportId, name: String(p.report.name), tickets: p.tickets.length }
}

/** Bring back playbooks that are in the snapshot but no longer in the system (never overwrites) */
export async function restoreMissingPlaybooks(backupId: string, actor: AuditActor | undefined): Promise<{ ok: true; restored: number } | { ok: false; status: number; message: string }> {
  const b = await prisma.backup.findUnique({ where: { id: backupId } })
  if (!b) return { ok: false, status: 404, message: 'ไม่พบข้อมูลสำรองนี้' }
  const snap = unpack<Snapshot>(b.payload)
  const have = new Set((await prisma.playbook.findMany({ select: { id: true } })).map(p => p.id))
  let restored = 0
  for (const raw of snap.playbooks as Array<Record<string, unknown>>) {
    if (have.has(String(raw.id))) continue
    await prisma.playbook.create({ data: revive(raw) as never })
    restored++
  }
  if (restored) await recordAudit(actor, { action: 'playbook.restore', summary: `กู้คืนคู่มือ ${restored} รายการจากข้อมูลสำรอง` })
  return { ok: true, restored }
}

// ── weekly schedule ───────────────────────────────────────────
export async function lastBackupAt(): Promise<Date | null> {
  const b = await prisma.backup.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  return b?.createdAt ?? null
}

async function tick() {
  try {
    await purgeArchives()
    const last = await lastBackupAt()
    if (!last || Date.now() - last.getTime() > EVERY_DAYS() * 86_400_000) {
      const r = await takeBackup('auto', undefined)
      console.log(`[backup] weekly snapshot ${r.id} (${Math.round(r.size / 1024)} KB)`)
    }
    await alert.report('backup', true)
  } catch (err) {
    console.error('[backup] failed:', (err as Error)?.message)
    await alert.report('backup', false, `สำรองข้อมูลอัตโนมัติไม่สำเร็จ: ${(err as Error)?.message ?? 'ไม่ทราบสาเหตุ'}`, { immediate: true })
  }
}

export function startBackupSchedule(): void {
  if (process.env.BACKUP === 'off') { console.log('[backup] off'); return }
  setTimeout(() => { void tick() }, Number(process.env.BACKUP_FIRST_MS ?? 60_000)).unref?.()
  setInterval(() => { void tick() }, Number(process.env.BACKUP_CHECK_MS ?? 3_600_000)).unref?.()
}
