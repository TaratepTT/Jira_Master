import axios, { type AxiosInstance } from 'axios'
import prisma from './prisma.js'
import { normalizeText, similarity, textGrams } from './similar.js'

// ══════════════════════════════════════════════════════════════
// Confluence search: find manual pages for a ticket's summary.
// Confluence may live on another Atlassian site than Jira, so it has its own credentials:
//   CONFLUENCE_BASE_URL   e.g. https://anls.atlassian.net
//   CONFLUENCE_EMAIL      account that can read the manual space(s)
//   CONFLUENCE_API_TOKEN  API token of that account (kept only in the server environment)
//   CONFLUENCE_SPACES     optional default space keys, e.g. ANLTS (admin can change in the app)
// ══════════════════════════════════════════════════════════════

export interface ConfluenceSettings { autoSend: boolean; minScore: number; maxLinks: number; spaces: string[] }
export interface ConfluencePage { id: string; title: string; url: string; excerpt: string; space: string; score: number; matched: string[] }

const baseUrl = () => (process.env.CONFLUENCE_BASE_URL ?? '').trim().replace(/\/+$/, '').replace(/\/wiki$/, '')
export const confluenceConfigured = () => !!(baseUrl() && process.env.CONFLUENCE_EMAIL && process.env.CONFLUENCE_API_TOKEN)
export const confluenceSite = () => baseUrl()

const envSpaces = () => (process.env.CONFLUENCE_SPACES ?? '').split(',').map(s => s.trim()).filter(Boolean)
export const DEFAULT_CONFLUENCE: ConfluenceSettings = { autoSend: false, minScore: 0.5, maxLinks: 2, spaces: [] }

export async function readConfluenceSettings(): Promise<ConfluenceSettings & { updatedBy: string | null }> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: 'confluence' } })
    if (row?.value && typeof row.value === 'object') {
      const v = row.value as Partial<ConfluenceSettings>
      return {
        autoSend: v.autoSend === true,
        minScore: typeof v.minScore === 'number' ? v.minScore : DEFAULT_CONFLUENCE.minScore,
        maxLinks: typeof v.maxLinks === 'number' ? v.maxLinks : DEFAULT_CONFLUENCE.maxLinks,
        spaces: Array.isArray(v.spaces) && v.spaces.length ? v.spaces.map(String) : envSpaces(),
        updatedBy: row.updatedBy,
      }
    }
  } catch { /* table missing before db push */ }
  return { ...DEFAULT_CONFLUENCE, spaces: envSpaces(), updatedBy: null }
}

let client: AxiosInstance | null = null
function cf(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: `${baseUrl()}/wiki/rest/api`,
      auth: { username: process.env.CONFLUENCE_EMAIL ?? '', password: process.env.CONFLUENCE_API_TOKEN ?? '' },
      headers: { Accept: 'application/json' },
      timeout: 15000,
    })
  }
  return client
}

// Words that appear in almost every ticket and say nothing about which manual fits
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'not', 'can', 'cannot', 'cant', 'unable', 'please', 'help',
  'issue', 'problem', 'error', 'erro', 'request', 'support', 'user', 'users', 'customer', 'ticket', 'urgent', 'asap',
  'have', 'has', 'was', 'are', 'is', 'to', 'of', 'in', 'on', 'at', 'by', 'it', 'be', 'or', 'an', 'as', 'when', 'after',
  'ไม่ได้', 'ไม่', 'ได้', 'ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้า', 'รบกวน', 'ช่วย', 'ด้วย', 'ปัญหา', 'แจ้ง', 'สอบถาม', 'ลูกค้า', 'ขอ',
])

/** Search terms from a summary: drop ticket keys, numbers, plate numbers, stop words */
// Thai has no spaces, so filler sticks to real words ("ไม่ได้ครับ"): peel it off both ends
const THAI_AFFIX = [...STOP].filter(w => /[\u0E00-\u0E7F]/.test(w)).sort((a, b) => b.length - a.length)
function peelThai(w: string): string {
  let cur = w, changed = true
  while (changed && cur) {
    changed = false
    for (const a of THAI_AFFIX) {
      if (cur.startsWith(a)) { cur = cur.slice(a.length); changed = true }
      else if (cur.endsWith(a)) { cur = cur.slice(0, -a.length); changed = true }
    }
  }
  return cur
}

export function searchTerms(summary: string, description = ''): string[] {
  const pick = (s: string) => normalizeText(s.replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, ' '))
    .replace(/([\u0E00-\u0E7F])([a-z0-9])/g, '$1 $2').replace(/([a-z0-9])([\u0E00-\u0E7F])/g, '$1 $2')
    .split(' ')
    .map(w => (/[\u0E00-\u0E7F]/.test(w) ? peelThai(w) : w))
    .filter(w => w && !STOP.has(w) && !/^\d+$/.test(w) && !/\d/.test(w) && (/[a-z]/.test(w) ? w.length >= 3 : w.length >= 2))
  const out: string[] = []
  for (const w of [...pick(summary), ...pick(description).slice(0, 6)]) if (!out.includes(w)) out.push(w)
  return out.slice(0, 10)
}

const cqlQuote = (s: string) => `"${s.replace(/[\\"]/g, ' ').replace(/[+\-&|!(){}[\]^~*?:/]/g, ' ').trim()}"`
const cleanExcerpt = (s: string) => s.replace(/@@@(end)?hl@@@/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** Rank by how much the page title looks like the summary and how many search words the page has */
export function rankPage(summary: string, terms: string[], title: string, excerpt: string): { score: number; matched: string[] } {
  const hay = normalizeText(`${title} ${excerpt}`).replace(/ /g, '')
  const titleFlat = normalizeText(title).replace(/ /g, '')
  const matched = terms.filter(t => hay.includes(t.replace(/ /g, '')))
  const inTitle = terms.filter(t => titleFlat.includes(t.replace(/ /g, ''))).length
  const coverage = terms.length ? matched.length / terms.length : 0
  const titleCoverage = terms.length ? inTitle / terms.length : 0
  const sim = similarity(textGrams(summary), textGrams(title))
  return { score: Math.min(1, 0.35 * sim + 0.35 * titleCoverage + 0.3 * coverage), matched }
}

const cache = new Map<string, { at: number; pages: ConfluencePage[] }>()

/** Best pages for a ticket, best first. Throws only on configuration / network errors. */
export async function searchConfluence(summary: string, description = '', spaces?: string[], limit = 5): Promise<ConfluencePage[]> {
  if (!confluenceConfigured()) return []
  const terms = searchTerms(summary, description)
  if (!terms.length) return []
  const sp = spaces ?? (await readConfluenceSettings()).spaces
  const ck = `${sp.join(',')}|${terms.join(' ')}`
  const hit = cache.get(ck)
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.pages.slice(0, limit)

  const words = terms.map(cqlQuote).filter(w => w !== '""')
  const any = words.flatMap(w => [`title ~ ${w}`, `text ~ ${w}`]).join(' OR ')
  const cql = `type = page${sp.length ? ` AND space in (${sp.map(cqlQuote).join(',')})` : ''} AND (${any})`
  const { data } = await cf().get('/search', { params: { cql, limit: 25, excerpt: 'highlight' } })
  type R = { title?: string; excerpt?: string; url?: string; content?: { id?: string; title?: string; _links?: { webui?: string }; space?: { key?: string } }; resultGlobalContainer?: { title?: string } }
  const results = ((data as { results?: R[] }).results ?? [])
  const pages: ConfluencePage[] = []
  for (const r of results) {
    const id = String(r.content?.id ?? '')
    const title = cleanExcerpt(r.content?.title ?? r.title ?? '')
    const webui = r.content?._links?.webui ?? r.url ?? ''
    if (!id || !title || !webui) continue
    const excerpt = cleanExcerpt(r.excerpt ?? '').slice(0, 300)
    const { score, matched } = rankPage(summary, terms, title, excerpt)
    pages.push({
      id, title, excerpt, score, matched,
      url: /^https?:/.test(webui) ? webui : `${baseUrl()}/wiki${webui.startsWith('/') ? '' : '/'}${webui}`,
      space: r.content?.space?.key ?? r.resultGlobalContainer?.title ?? '',
    })
  }
  pages.sort((a, b) => b.score - a.score)
  cache.set(ck, { at: Date.now(), pages })
  if (cache.size > 200) cache.delete(cache.keys().next().value as string)
  return pages.slice(0, limit)
}

export async function testConfluenceConnection(): Promise<{ ok: boolean; message: string }> {
  if (!confluenceConfigured()) return { ok: false, message: 'ยังไม่ได้ตั้ง CONFLUENCE_BASE_URL / CONFLUENCE_EMAIL / CONFLUENCE_API_TOKEN บน server' }
  try {
    const { data } = await cf().get('/space', { params: { limit: 1 } })
    return { ok: true, message: `เชื่อม ${baseUrl()} ได้ (เห็น space อย่างน้อย ${((data as { results?: unknown[] }).results ?? []).length} อัน)` }
  } catch (err) {
    const st = (err as { response?: { status?: number } })?.response?.status
    return { ok: false, message: st === 401 ? 'อีเมลหรือ API token ของ Confluence ไม่ถูกต้อง' : st === 403 ? 'บัญชีนี้ไม่มีสิทธิ์อ่าน Confluence' : `เชื่อม Confluence ไม่ได้${st ? ` (HTTP ${st})` : ''}` }
  }
}
