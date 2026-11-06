import prisma from './prisma.js'
import { revive } from './backup.js'
import { invalidateKnownTickets } from './similar.js'

// ══════════════════════════════════════════════════════════════
// Tickets an admin took out of one report ("ลบออกจาก report").
// Only the Dashboard's copy is removed — nothing in Jira is touched. The removed rows are kept
// in app_settings under `report.removed.<reportId>` so they can be put back (undo, or the
// "ticket ที่ลบออก" list). Refresh from Jira only updates the tickets still in the report, so
// removed tickets stay out until someone restores them.
// ══════════════════════════════════════════════════════════════

export interface RemovedTicket {
  key: string
  summary: string | null
  status: string
  removedBy: string
  removedAt: string
  row: Record<string, unknown>
}

const settingKey = (reportId: string) => `report.removed.${reportId}`

export async function listRemoved(reportId: string): Promise<RemovedTicket[]> {
  const s = await prisma.appSetting.findUnique({ where: { key: settingKey(reportId) } })
  return Array.isArray(s?.value) ? (s!.value as unknown as RemovedTicket[]) : []
}

async function saveRemoved(reportId: string, items: RemovedTicket[], by: string) {
  const key = settingKey(reportId)
  if (!items.length) { await prisma.appSetting.deleteMany({ where: { key } }); return }
  const value = items as never
  await prisma.appSetting.upsert({ where: { key }, create: { key, value, updatedBy: by }, update: { value, updatedBy: by } })
}

async function syncTotal(reportId: string) {
  const n = await prisma.ticket.count({ where: { reportId } })
  await prisma.report.update({ where: { id: reportId }, data: { totalTickets: n } })
  return n
}

/** Take tickets out of a report. Returns the keys that were actually removed. */
export async function removeTickets(reportId: string, keys: string[], by: string): Promise<{ removed: string[]; total: number }> {
  const want = [...new Set(keys.map(k => String(k).trim().toUpperCase()).filter(Boolean))]
  const rows = await prisma.ticket.findMany({ where: { reportId, key: { in: want } } })
  if (!rows.length) return { removed: [], total: await syncTotal(reportId) }
  const now = new Date().toISOString()
  const kept = (await listRemoved(reportId)).filter(r => !rows.some(x => x.key === r.key))
  const added: RemovedTicket[] = rows.map(r => ({
    key: r.key, summary: (r as { summary?: string | null }).summary ?? null, status: r.status,
    removedBy: by, removedAt: now, row: JSON.parse(JSON.stringify(r)) as Record<string, unknown>,
  }))
  // save the copies first, then delete, so a failure in between never loses a ticket
  await saveRemoved(reportId, [...added, ...kept], by)
  await prisma.ticket.deleteMany({ where: { reportId, id: { in: rows.map(r => r.id) } } })
  invalidateKnownTickets()
  return { removed: rows.map(r => r.key), total: await syncTotal(reportId) }
}

/** Put removed tickets back (all of them when `keys` is empty). Never duplicates a ticket that is in the report. */
export async function restoreTickets(reportId: string, keys: string[] | undefined, by: string): Promise<{ restored: string[]; total: number }> {
  const all = await listRemoved(reportId)
  const want = keys?.length ? new Set(keys.map(k => String(k).trim().toUpperCase())) : null
  const pick = all.filter(r => !want || want.has(r.key))
  if (!pick.length) return { restored: [], total: await syncTotal(reportId) }
  const present = new Set((await prisma.ticket.findMany({ where: { reportId, key: { in: pick.map(p => p.key) } }, select: { key: true } })).map(t => t.key))
  const toCreate = pick.filter(p => !present.has(p.key))
  if (toCreate.length) {
    await prisma.ticket.createMany({ data: toCreate.map(p => { const x = revive({ ...p.row }); delete (x as { report?: unknown }).report; return { ...x, reportId } as never }) })
  }
  await saveRemoved(reportId, all.filter(r => !pick.includes(r)), by)
  invalidateKnownTickets()
  return { restored: pick.map(p => p.key), total: await syncTotal(reportId) }
}

/** Forget the removed list when the report itself is gone for good */
export async function dropRemovedList(reportId: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: settingKey(reportId) } })
}
