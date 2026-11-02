import prisma from './prisma.js'

// ── Carry-over: reuse what was filled in earlier reports ───────
// Tickets that stay open for several weeks show up in every weekly report. Values typed in
// on the Validate screen (BU, Type of Issue, Root Cause, Resolution, Deploy Date) are saved
// to the report but not always to Jira, so next week's sync would show them empty again.
// For every field that is EMPTY in the fresh Jira data, this finds the most recent earlier
// report where the same ticket had a value, and offers it as a suggestion. Nothing is applied
// automatically — the user accepts suggestions on the Validate screen.

export const CARRY_FIELDS = ['businessUnit', 'typeOfIssue', 'rootCause', 'resolution', 'deployDate'] as const
export type CarryField = (typeof CARRY_FIELDS)[number]

export interface CarryValue { value: string; reportName: string; reportDate: string }
export type CarrySuggestions = Partial<Record<CarryField, CarryValue>>

type Fresh = { key: string } & Partial<Record<CarryField, string | null | undefined>>

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

export async function findCarryOver(fresh: Fresh[]): Promise<Map<string, CarrySuggestions>> {
  const out = new Map<string, CarrySuggestions>()
  // Only look up tickets that actually have an empty field
  const needy = fresh.filter(t => CARRY_FIELDS.some(f => blank(t[f])))
  if (!needy.length) return out

  const keys = Array.from(new Set(needy.map(t => t.key)))
  const CHUNK = 500
  const rows: Array<{
    key: string; businessUnit: string; typeOfIssue: string; rootCause: string | null; resolution: string | null
    deployDate: string | null; report: { name: string; createdAt: Date }
  }> = []
  for (let i = 0; i < keys.length; i += CHUNK) {
    rows.push(...await prisma.ticket.findMany({
      where: { key: { in: keys.slice(i, i + CHUNK) } },
      select: {
        key: true, businessUnit: true, typeOfIssue: true, rootCause: true, resolution: true, deployDate: true,
        report: { select: { name: true, createdAt: true } },
      },
    }))
  }
  // newest report first, so the first non-empty value found per field is the latest one
  rows.sort((a, b) => b.report.createdAt.getTime() - a.report.createdAt.getTime())

  const byKey = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byKey.get(r.key)
    if (list) list.push(r)
    else byKey.set(r.key, [r])
  }

  for (const t of needy) {
    const history = byKey.get(t.key)
    if (!history) continue
    const s: CarrySuggestions = {}
    for (const f of CARRY_FIELDS) {
      if (!blank(t[f])) continue
      const hit = history.find(h => !blank(h[f]))
      if (hit) {
        s[f] = {
          value: String(hit[f]).trim(),
          reportName: hit.report.name,
          reportDate: hit.report.createdAt.toISOString(),
        }
      }
    }
    if (Object.keys(s).length) out.set(t.key, s)
  }
  return out
}
