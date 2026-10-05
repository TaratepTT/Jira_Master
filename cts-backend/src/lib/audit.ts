import prisma from './prisma.js'

export interface AuditActor {
  id: string
  name: string
  email: string
  role: string
}

export interface AuditEntry {
  action: string
  summary: string
  reportId?: string | null
  ticketKey?: string | null
  details?: Record<string, unknown> | null
  success?: boolean
}

// Long free text (root cause, resolution) is clipped so the log table stays small.
export function clip(v: unknown, max = 500): string {
  const s = v === null || v === undefined ? '' : String(v)
  return s.length > max ? s.slice(0, max) + '…' : s
}

// Record one or more audit rows. NEVER throws: failing to write the log must not
// break the action the user just performed (e.g. before `prisma db push` has been run).
export async function recordAudit(actor: AuditActor | undefined, entries: AuditEntry | AuditEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries]
  if (!list.length) return
  try {
    await prisma.auditLog.createMany({
      data: list.map(e => ({
        userId:    actor?.id ?? null,
        userName:  actor?.name ?? 'ระบบ',
        userEmail: actor?.email ?? '',
        userRole:  actor?.role ?? '',
        action:    e.action,
        reportId:  e.reportId ?? null,
        ticketKey: e.ticketKey ?? null,
        summary:   clip(e.summary, 300),
        details:   (e.details ?? undefined) as object | undefined,
        success:   e.success ?? true,
      })),
    })
  } catch (err) {
    console.error('[audit] could not write audit log:', err instanceof Error ? err.message : err)
  }
}

// Field-level diff used by single + bulk edits: only fields that really changed.
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: string; to: string }> {
  const out: Record<string, { from: string; to: string }> = {}
  for (const k of Object.keys(after)) {
    const a = before[k] === null || before[k] === undefined ? '' : String(before[k])
    const b = after[k] === null || after[k] === undefined ? '' : String(after[k])
    if (a !== b) out[k] = { from: clip(a), to: clip(b) }
  }
  return out
}
