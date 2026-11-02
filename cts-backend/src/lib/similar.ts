import prisma from './prisma.js'

// ══════════════════════════════════════════════════════════════
// "ticket คล้ายกันที่เคยแก้แล้ว" + Root Cause / Resolution suggestions
// ══════════════════════════════════════════════════════════════
// Works on the app's own data (every report ever saved) — no AI call, no cost.
// Similarity: Thai has no spaces between words, so summaries are compared as sets of
// character trigrams (plus whole Latin/number words such as "GPS", "CMP", "printer"),
// scored with cosine similarity on those sets. Good enough to surface "same problem again".

export interface KnownTicket {
  key: string
  summary: string
  rootCause: string
  resolution: string
  typeOfIssue: string
  system: string
  status: string
  reportName: string
  reportDate: Date
  grams: Set<string>
}

const CACHE_MS = 60_000
let cache: { at: number; list: KnownTicket[] } | null = null

/** Call after a ticket's Root Cause / Resolution changes so suggestions pick it up */
export function invalidateKnownTickets(): void {
  cache = null
}

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')           // "[CMP]" style prefixes say nothing about the problem
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')  // keep letters (incl. Thai vowels/tone marks) and digits
    .replace(/\s+/g, ' ')
    .trim()
}

export function textGrams(s: string): Set<string> {
  const n = normalizeText(s)
  const out = new Set<string>()
  for (const w of n.split(' ')) {
    if (/^[a-z0-9]{2,}$/.test(w)) out.add(`w:${w}`)
  }
  const flat = n.replace(/ /g, '')
  for (let i = 0; i + 3 <= flat.length; i++) out.add(flat.slice(i, i + 3))
  return out
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let common = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const g of small) if (big.has(g)) common++
  return common / Math.sqrt(a.size * b.size)
}

const clean = (v: string | null | undefined) => (v ?? '').trim()

/** Latest known version of every ticket that has a Root Cause or a Resolution filled in */
export async function knownTickets(): Promise<KnownTicket[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list
  const rows = await prisma.ticket.findMany({
    where: { OR: [{ rootCause: { not: null } }, { resolution: { not: null } }] },
    select: {
      key: true, summary: true, rootCause: true, resolution: true, typeOfIssue: true, system: true, status: true,
      report: { select: { name: true, createdAt: true } },
    },
  })
  const latest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    if (!clean(r.rootCause) && !clean(r.resolution)) continue
    const prev = latest.get(r.key)
    if (!prev || prev.report.createdAt < r.report.createdAt) latest.set(r.key, r)
  }
  const list: KnownTicket[] = Array.from(latest.values()).map(r => ({
    key: r.key,
    summary: clean(r.summary),
    rootCause: clean(r.rootCause),
    resolution: clean(r.resolution),
    typeOfIssue: clean(r.typeOfIssue),
    system: clean(r.system),
    status: r.status,
    reportName: r.report.name,
    reportDate: r.report.createdAt,
    grams: textGrams(r.summary ?? ''),
  }))
  cache = { at: Date.now(), list }
  return list
}

export interface SimilarTicket {
  key: string
  summary: string
  rootCause: string
  resolution: string
  typeOfIssue: string
  status: string
  score: number   // 0..1
  reportName: string
}

export function findSimilar(
  target: { key: string; summary: string; typeOfIssue?: string; system?: string },
  known: KnownTicket[],
  limit = 5,
  minScore = 0.22,
): SimilarTicket[] {
  const g = textGrams(target.summary)
  if (g.size < 3) return []
  const scored: SimilarTicket[] = []
  for (const k of known) {
    if (k.key === target.key) continue
    let score = similarity(g, k.grams)
    if (score < minScore) continue
    // small nudge for the same problem type / system — never enough to make a weak match strong
    if (target.typeOfIssue && k.typeOfIssue === target.typeOfIssue) score += 0.03
    if (target.system && k.system === target.system) score += 0.02
    scored.push({
      key: k.key, summary: k.summary, rootCause: k.rootCause, resolution: k.resolution,
      typeOfIssue: k.typeOfIssue, status: k.status, score: Math.min(1, score), reportName: k.reportName,
    })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

export interface TextSuggestion { text: string; count: number }

/** Most used Root Cause / Resolution texts, preferably within the same Type of Issue */
export function topTexts(
  known: KnownTicket[],
  field: 'rootCause' | 'resolution',
  typeOfIssue?: string,
  limit = 20,
): { scope: 'type' | 'all'; items: TextSuggestion[] } {
  const count = (list: KnownTicket[]) => {
    const m = new Map<string, TextSuggestion>()
    for (const k of list) {
      const t = k[field]
      if (!t || t.length > 400) continue // very long free text is rarely reusable as-is
      const id = normalizeText(t)
      if (!id) continue
      const e = m.get(id)
      if (e) e.count++
      else m.set(id, { text: t, count: 1 })
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || a.text.length - b.text.length).slice(0, limit)
  }
  if (typeOfIssue) {
    const same = count(known.filter(k => k.typeOfIssue === typeOfIssue))
    if (same.length >= 3) return { scope: 'type', items: same }
  }
  return { scope: 'all', items: count(known) }
}
