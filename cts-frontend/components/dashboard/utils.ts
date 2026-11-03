import type { TicketDetail } from './types'

// ── Jira links ────────────────────────────────────────────────
// Set NEXT_PUBLIC_JIRA_BASE_URL on Vercel to point the links at another Jira site.
export const JIRA_BASE_URL = (process.env.NEXT_PUBLIC_JIRA_BASE_URL ?? 'https://ascendcommerce-support.atlassian.net').replace(/\/+$/, '')
export const jiraBrowseUrl = (key: string) => `${JIRA_BASE_URL}/browse/${encodeURIComponent(key)}`

// Kept in one place so the Dashboard edit modal, bulk edit and the Validate screen always
// offer the exact same Type of Issue choices.
export const TYPE_OF_ISSUE_OPTIONS = [
  'Non-app issue', 'App issue', 'User request', 'Human Error', 'Data Issue',
  'Other', 'Monitor', 'Referral', 'Bug Issue', 'Alert', 'Q&A',
]

export function pct(n: number, total: number) { return total ? Math.round(n / total * 100) : 0 }

// Status chip colours: most statuses stay neutral; only finished (ok), L3 (danger) and
// "almost done" (Resolved / CLOSING, accent) get a colour, so colour still means something.
export function statusBadge(s: string) {
  const l = (s ?? '').toLowerCase()
  if (l.includes('closed') || l.includes('done')) return 'border-transparent bg-ok-soft text-ok'
  if (l.includes('l3') || l.includes('invest')) return 'border-transparent bg-danger-soft text-danger'
  if (l.includes('resolved') || l.includes('closing')) return 'border-transparent bg-accent-soft text-accent'
  if (l.includes('cancel') || l.includes('reject')) return 'bg-sunken text-faint'
  return 'bg-sunken text-muted'
}

export function formatDate(d?: string | null) {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

// "2026-09-01" or "2026-09-01T10:00:00.000+0700" -> "2026-09-01" (value for <input type="date">)
export function toDateInput(d?: string | null) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(d ?? '')
  return m ? m[1] : ''
}

export function isClosedStatus(s: string) {
  const l = (s ?? '').toLowerCase()
  return l.includes('closed') || l.includes('done')
}
export function isL3Status(s: string) {
  const l = (s ?? '').toLowerCase()
  return l.includes('l3') || l.includes('investigate')
}
/** Work on the ticket is finished (closed, done, resolved, cancelled) — used by Aging */
export function isFinishedStatus(s: string) {
  const l = (s ?? '').toLowerCase()
  return isClosedStatus(l) || l.includes('resolved') || l.includes('cancel') || l.includes('reject')
}

// ── "ข้อมูลยังไม่ครบ" — what the weekly report needs filled in ──
export const REQUIRED_REPORT_FIELDS: Array<{ field: keyof TicketDetail; label: string }> = [
  { field: 'businessUnit', label: 'BU' },
  { field: 'typeOfIssue', label: 'Type of Issue' },
  { field: 'rootCause', label: 'Root Cause' },
  { field: 'resolution', label: 'Resolution' },
]
export function missingFields(t: TicketDetail): string[] {
  return REQUIRED_REPORT_FIELDS
    .filter(({ field }) => {
      const v = t[field]
      return v === null || v === undefined || String(v).trim() === ''
    })
    .map(f => f.label)
}
export const isIncomplete = (t: TicketDetail) => missingFields(t).length > 0

// ── Dates ─────────────────────────────────────────────────────
const DAY = 24 * 60 * 60 * 1000
export function parseDate(v?: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}
export function daysBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY))
}
/** Monday (local time) of the week containing `d`, as YYYY-MM-DD */
export function weekKey(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1))
  const mm = String(x.getMonth() + 1).padStart(2, '0')
  const dd = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${mm}-${dd}`
}
export function shortThaiDate(isoDay: string) {
  const d = new Date(`${isoDay}T00:00:00`)
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

export function median(nums: number[]) {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
export function percentile(nums: number[], p: number) {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))
  return s[idx]
}

// ── Aging ─────────────────────────────────────────────────────
export const AGE_BUCKETS = [
  { id: '0-3', label: '0–3 วัน', min: 0, max: 3, color: 'bg-emerald-500' },
  { id: '4-7', label: '4–7 วัน', min: 4, max: 7, color: 'bg-lime-500' },
  { id: '8-14', label: '8–14 วัน', min: 8, max: 14, color: 'bg-amber-500' },
  { id: '15-30', label: '15–30 วัน', min: 15, max: 30, color: 'bg-orange-500' },
  { id: '30+', label: 'มากกว่า 30 วัน', min: 31, max: Infinity, color: 'bg-red-500' },
] as const
export type AgeBucketId = (typeof AGE_BUCKETS)[number]['id']
export function ageBucket(days: number): AgeBucketId {
  return (AGE_BUCKETS.find(b => days >= b.min && days <= b.max) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]).id
}

export interface OpenTicketAge { ticket: TicketDetail; days: number; bucket: AgeBucketId }

/** Open (unfinished) tickets with their age at `asOf`. Tickets without a created date are skipped. */
export function openTicketAges(tickets: TicketDetail[], asOf: Date): OpenTicketAge[] {
  const out: OpenTicketAge[] = []
  for (const t of tickets) {
    if (isFinishedStatus(t.status)) continue
    const c = parseDate(t.ticketCreatedAt)
    if (!c) continue
    const days = daysBetween(c, asOf)
    out.push({ ticket: t, days, bucket: ageBucket(days) })
  }
  return out.sort((a, b) => b.days - a.days)
}

/** Days from created to resolved, for tickets that have both dates */
export function resolutionDays(tickets: TicketDetail[]): Array<{ ticket: TicketDetail; days: number }> {
  const out: Array<{ ticket: TicketDetail; days: number }> = []
  for (const t of tickets) {
    const c = parseDate(t.ticketCreatedAt)
    const r = parseDate(t.resolvedAt)
    if (!c || !r || r < c) continue
    out.push({ ticket: t, days: (r.getTime() - c.getTime()) / DAY })
  }
  return out
}

export function fmtDays(n: number) {
  if (n < 1) return `${Math.round(n * 24)} ชม.`
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} วัน`
}
