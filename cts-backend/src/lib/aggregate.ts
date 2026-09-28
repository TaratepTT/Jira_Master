// Pure aggregation helpers for the dashboard (no DB / no Express imports),
// so the logic is easy to test and reuse.
//
// Replaces the nested `tickets.filter(...)` loops that used to live in
// routes/reports.ts. Everything here is a SINGLE pass over the tickets
// (O(n)) instead of O(n × categories × business-units).

export interface AggTicket {
  key: string
  status: string
  businessUnit: string
  typeOfIssue: string
  summary: string | null
  system: string
  recurringCategory: string | null
  assignee: string | null
  priority: string | null
}

export function pct(n: number, total: number): string {
  if (!total) return '0.00%'
  return ((n / total) * 100).toFixed(2) + '%'
}

// Same semantics as the old groupCount: null/undefined -> 'Unknown',
// keys keep first-seen insertion order.
function bump(map: Record<string, number>, raw: unknown): void {
  const k = String(raw ?? 'Unknown')
  map[k] = (map[k] ?? 0) + 1
}

export function buildAggregations(tickets: AggTicket[]) {
  const systemCount: Record<string, number> = {}
  const statusCount: Record<string, number> = {}
  const buCount: Record<string, number> = {}
  const issueTypeCount: Record<string, number> = {}
  const recurringCount: Record<string, number> = {}
  const assigneeCount: Record<string, number> = {}
  const priorityCount: Record<string, number> = {}

  // category -> ticket keys (built in the same pass)
  const keysByType = new Map<string, string[]>()
  const l3Tickets: Array<{ key: string; bu: string; status: string; summary: string | null }> = []

  for (const t of tickets) {
    bump(systemCount, t.system)
    bump(statusCount, t.status)
    bump(buCount, t.businessUnit)
    bump(issueTypeCount, t.typeOfIssue)
    bump(recurringCount, t.recurringCategory)
    bump(assigneeCount, t.assignee)
    bump(priorityCount, t.priority)

    const bucket = keysByType.get(t.typeOfIssue)
    if (bucket) bucket.push(t.key)
    else keysByType.set(t.typeOfIssue, [t.key])

    const s = t.status.toLowerCase()
    if (s.includes('l3') || s.includes('investigate')) {
      l3Tickets.push({ key: t.key, bu: t.businessUnit, status: t.status, summary: t.summary })
    }
  }

  const frequencyTable = Object.entries(issueTypeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count], idx) => ({
      rank: idx + 1,
      category,
      count,
      pct: pct(count, tickets.length),
      keys: keysByType.get(category) ?? [],
    }))

  const top5Bu = Object.entries(buCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  const topAssignees = Object.entries(assigneeCount)
    .filter(([name]) => name && name !== 'Unknown' && name !== 'null')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  return {
    systemCount,
    statusCount,
    buCount,
    issueTypeCount,
    recurringCount,
    frequencyTable,
    l3Tickets,
    top5Bu,
    top3Cat: frequencyTable.slice(0, 3),
    topAssignees,
    priorityCount,
  }
}
