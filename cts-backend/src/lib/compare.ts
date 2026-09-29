// Compare two report snapshots (e.g. this week's report vs last week's).
// Pure functions — no DB / Express — so the numbers are easy to test.

export interface CmpTicket {
  key: string
  status: string
  system: string
  businessUnit: string
  typeOfIssue: string
  priority: string | null
  summary: string | null
  ticketCreatedAt: Date | string | null
}

// Same rules the dashboard uses, so the numbers match what people already see there.
export const isClosedStatus = (s: string) => { const l = s.toLowerCase(); return l.includes('closed') || l.includes('done') }
export const isL3Status = (s: string) => { const l = s.toLowerCase(); return l.includes('l3') || l.includes('investigate') }

export interface Kpi {
  id: 'total' | 'closed' | 'closureRate' | 'open' | 'l3'
  label: string
  unit: 'count' | 'percent'
  base: number
  current: number
  delta: number
  /** relative change in %, null when the base is 0 */
  deltaPct: number | null
  /** does an increase count as good, bad, or neither? (drives the colour in the UI) */
  goodWhen: 'up' | 'down' | 'neutral'
}

export interface BreakdownRow { name: string; base: number; current: number; delta: number }
export interface BreakdownTable { id: string; label: string; rows: BreakdownRow[] }
export interface TicketRef { key: string; summary: string; status: string; category: string }
export interface StatusChange { key: string; summary: string; from: string; to: string }
export interface Listed<T> { total: number; items: T[] }

export interface Comparison {
  overlap: { both: number; onlyCurrent: number; onlyBase: number }
  kpis: Kpi[]
  breakdowns: BreakdownTable[]
  statusChanges: Listed<StatusChange>
  newTickets: Listed<TicketRef>
  goneTickets: Listed<TicketRef>
  windows: { base: DateRange; current: DateRange }
}
export interface DateRange { from: string | null; to: string | null; withDate: number }

const LIST_CAP = 100
const ROW_CAP = 24

const round1 = (n: number) => Math.round(n * 10) / 10
const clean = (s: string | null | undefined, fallback: string) => (s ?? '').trim() || fallback
const pctOf = (n: number, total: number) => (total ? round1((n / total) * 100) : 0)

function makeKpi(id: Kpi['id'], label: string, unit: Kpi['unit'], goodWhen: Kpi['goodWhen'], base: number, current: number): Kpi {
  const delta = unit === 'percent' ? round1(current - base) : current - base
  return {
    id, label, unit, base, current, delta, goodWhen,
    // for a percentage KPI the delta is already "points", a relative % would be confusing
    deltaPct: unit === 'percent' || base === 0 ? null : round1(((current - base) / base) * 100),
  }
}

function breakdown(id: string, label: string, base: CmpTicket[], current: CmpTicket[], pick: (t: CmpTicket) => string): BreakdownTable {
  const b = new Map<string, number>(), c = new Map<string, number>()
  for (const t of base) b.set(pick(t), (b.get(pick(t)) ?? 0) + 1)
  for (const t of current) c.set(pick(t), (c.get(pick(t)) ?? 0) + 1)
  const names = [...new Set([...b.keys(), ...c.keys()])]
  let rows: BreakdownRow[] = names.map(name => {
    const bv = b.get(name) ?? 0, cv = c.get(name) ?? 0
    return { name, base: bv, current: cv, delta: cv - bv }
  })
  rows.sort((x, y) => Math.max(y.base, y.current) - Math.max(x.base, x.current) || x.name.localeCompare(y.name))
  if (rows.length > ROW_CAP) {
    const rest = rows.slice(ROW_CAP)
    const base = rest.reduce((n, r) => n + r.base, 0), cur = rest.reduce((n, r) => n + r.current, 0)
    rows = [...rows.slice(0, ROW_CAP), { name: `อื่นๆ (${rest.length} รายการ)`, base, current: cur, delta: cur - base }]
  }
  return { id, label, rows }
}

function dateRange(tickets: CmpTicket[]): DateRange {
  let min = Infinity, max = -Infinity, n = 0
  for (const t of tickets) {
    if (!t.ticketCreatedAt) continue
    const ms = new Date(t.ticketCreatedAt).getTime()
    if (Number.isNaN(ms)) continue
    n++; if (ms < min) min = ms; if (ms > max) max = ms
  }
  return n ? { from: new Date(min).toISOString(), to: new Date(max).toISOString(), withDate: n } : { from: null, to: null, withDate: 0 }
}

// If a report contains the same key twice (shouldn't, but sync data can), the last one wins.
function byKey(tickets: CmpTicket[]): Map<string, CmpTicket> {
  const m = new Map<string, CmpTicket>()
  for (const t of tickets) m.set(t.key, t)
  return m
}

const ref = (t: CmpTicket): TicketRef => ({ key: t.key, summary: (t.summary ?? '').slice(0, 160), status: t.status, category: clean(t.typeOfIssue, 'ไม่ระบุ') })
const listed = <T>(all: T[]): Listed<T> => ({ total: all.length, items: all.slice(0, LIST_CAP) })

export function compareReports(baseRaw: CmpTicket[], currentRaw: CmpTicket[]): Comparison {
  const baseMap = byKey(baseRaw), curMap = byKey(currentRaw)
  const base = [...baseMap.values()], current = [...curMap.values()]

  const stats = (ts: CmpTicket[]) => {
    const total = ts.length, closed = ts.filter(t => isClosedStatus(t.status)).length
    return { total, closed, open: total - closed, l3: ts.filter(t => isL3Status(t.status)).length, rate: pctOf(closed, total) }
  }
  const b = stats(base), c = stats(current)

  const newTickets = current.filter(t => !baseMap.has(t.key))
  const goneTickets = base.filter(t => !curMap.has(t.key))
  const statusChanges: StatusChange[] = []
  for (const t of current) {
    const old = baseMap.get(t.key)
    if (old && clean(old.status, '') !== clean(t.status, '')) {
      statusChanges.push({ key: t.key, summary: (t.summary ?? '').slice(0, 160), from: clean(old.status, 'ไม่ระบุ'), to: clean(t.status, 'ไม่ระบุ') })
    }
  }

  const norm = (fallback: string, f: (t: CmpTicket) => string | null) => (t: CmpTicket) => clean(f(t), fallback)
  return {
    overlap: { both: current.length - newTickets.length, onlyCurrent: newTickets.length, onlyBase: goneTickets.length },
    kpis: [
      makeKpi('total', 'Total tickets', 'count', 'neutral', b.total, c.total),
      makeKpi('closed', 'Closed', 'count', 'up', b.closed, c.closed),
      makeKpi('closureRate', 'Closure rate', 'percent', 'up', b.rate, c.rate),
      makeKpi('open', 'Open / Pending', 'count', 'down', b.open, c.open),
      makeKpi('l3', 'L3 escalation', 'count', 'down', b.l3, c.l3),
    ],
    breakdowns: [
      breakdown('status', 'Status', base, current, norm('ไม่ระบุ', t => t.status)),
      breakdown('category', 'Category (Type of Issue)', base, current, norm('ไม่ระบุ', t => t.typeOfIssue)),
      breakdown('system', 'System', base, current, norm('ไม่ระบุ', t => t.system)),
      breakdown('businessUnit', 'Business Unit', base, current, norm('ไม่ระบุ BU', t => t.businessUnit)),
      breakdown('priority', 'Priority', base, current, norm('ไม่ระบุ', t => t.priority)),
    ],
    statusChanges: listed(statusChanges),
    newTickets: listed(newTickets.map(ref)),
    goneTickets: listed(goneTickets.map(ref)),
    windows: { base: dateRange(base), current: dateRange(current) },
  }
}
