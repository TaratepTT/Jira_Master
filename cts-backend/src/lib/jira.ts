import axios from 'axios'

const JIRA_BASE_URL = process.env.JIRA_BASE_URL ?? ''
const JIRA_EMAIL    = process.env.JIRA_EMAIL ?? ''
const JIRA_TOKEN    = process.env.JIRA_API_TOKEN ?? ''

const jiraClient = axios.create({
  baseURL: `${JIRA_BASE_URL}/rest/api/3`,
  auth: { username: JIRA_EMAIL, password: JIRA_TOKEN },
  headers: {
    'Accept':       'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 30_000,
})

// ── Field IDs ─────────────────────────────────────────────────
const FIELDS = [
  'summary',
  'assignee',
  'priority',
  'status',
  'created',
  'resolutiondate',
  'issuetype',
  'customfield_10207', // Business Unit
  'customfield_14795', // Issue Category
  'customfield_10079', // Root Cause
  'customfield_10053', // Resolution (custom)
  'customfield_10169', // Type of Issue
  'customfield_10168', // Type of System
  'customfield_10185', // Deployed Date
]

// ── Types ─────────────────────────────────────────────────────
export interface JiraIssue {
  key:           string
  summary:       string
  assignee:      string
  priority:      string
  status:        string
  created:       string
  resolved:      string
  businessUnit:  string
  system:        string
  issueCategory: string
  rootCause:     string
  resolution:    string
  typeOfIssue:   string
  typeOfSystem:  string
  deployDate:    string
}

function extractAdf(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  try {
    const doc = v as { content?: Array<{ content?: Array<{ text?: string }> }> }
    return (doc.content ?? [])
      .flatMap(b => b.content ?? [])
      .map(n => n.text ?? '')
      .join(' ')
      .trim()
  } catch { return '' }
}

function str(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    return String(o.value ?? o.name ?? o.displayName ?? o.emailAddress ?? '')
  }
  return String(v)
}

function mapIssue(raw: Record<string, unknown>): JiraIssue {
  const f = raw.fields as Record<string, unknown>
  return {
    key:           String(raw.key ?? ''),
    summary:       str(f.summary),
    assignee:      str(f.assignee),
    priority:      str(f.priority),
    status:        str(f.status),
    created:       str(f.created),
    resolved:      str(f.resolutiondate),
    businessUnit:  str(f.customfield_10207),
    system:        str(f.issuetype),
    issueCategory: str(f.customfield_14795),
    rootCause:     extractAdf(f.customfield_10079),
    resolution:    extractAdf(f.customfield_10053),
    typeOfIssue:   str(f.customfield_10169),
    typeOfSystem:  str(f.customfield_10168),
    deployDate:    str(f.customfield_10185),
  }
}

// ── Sync size cap ─────────────────────────────────────────────
// How many tickets one sync may pull. Configurable via env JIRA_MAX_ISSUES
// (default 2000, hard ceiling 5000 to protect the free-tier server's memory).
export const MAX_SYNC_ISSUES: number = (() => {
  const n = Number.parseInt(process.env.JIRA_MAX_ISSUES ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return 2000
  return Math.min(n, 5000)
})()

// ── Fetch issues via new Jira Cloud /search/jql endpoint ─────
// Uses nextPageToken pagination (NOT startAt — deprecated).
// Returns `truncated: true` when more matching tickets exist than `maxTotal`,
// so callers can warn the user instead of silently dropping data.
export async function fetchJiraIssuesWithMeta(
  jql: string,
  maxTotal: number = MAX_SYNC_ISSUES
): Promise<{ issues: JiraIssue[]; truncated: boolean }> {
  const issues: JiraIssue[] = []
  let nextPageToken: string | undefined = undefined
  let truncated = false
  const pageSize = 100

  while (true) {
    const body: Record<string, unknown> = {
      jql,
      maxResults: Math.min(pageSize, maxTotal - issues.length),
      fields: FIELDS,
    }
    if (nextPageToken) body.nextPageToken = nextPageToken

    let data: Record<string, unknown>

    try {
      const resp = await jiraClient.post('/search/jql', body)
      data = resp.data as Record<string, unknown>
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown } }
      console.error(
        `[jira] POST /search/jql failed — status ${e?.response?.status}`,
        '\nbody sent:', JSON.stringify(body),
        '\nerror response:', JSON.stringify(e?.response?.data, null, 2)
      )
      throw err
    }

    const page = (data.issues ?? []) as Record<string, unknown>[]
    issues.push(...page.map(mapIssue))

    nextPageToken = data.nextPageToken as string | undefined
    const isLast = Boolean(data.isLast) || !nextPageToken || page.length === 0

    if (isLast) break
    if (issues.length >= maxTotal) { truncated = true; break }
  }

  return { issues, truncated }
}

// Backwards-compatible wrapper (used by /sync and /preview)
export async function fetchJiraIssues(jql: string, maxTotal: number = 500): Promise<JiraIssue[]> {
  return (await fetchJiraIssuesWithMeta(jql, maxTotal)).issues
}

// ── Test connection ───────────────────────────────────────────
export async function testJiraConnection(): Promise<{ ok: boolean; email: string }> {
  const { data } = await jiraClient.get('/myself')
  return { ok: true, email: (data as { emailAddress: string }).emailAddress }
}

// ══════════════════════════════════════════════════════════════
// ── WRITE OPERATIONS — update Jira issues from the Dashboard ───
// ══════════════════════════════════════════════════════════════

// Field IDs used when writing back (must match the ones used for reading)
const WRITE_FIELD_IDS = {
  businessUnit: 'customfield_10207', // plain text field
  typeOfIssue:  'customfield_10169', // select/option field
  rootCause:    'customfield_10079', // rich-text field — written as ADF via toAdf()
  resolution:   'customfield_10053', // rich-text field — written as ADF via toAdf()
  deployDate:   'customfield_10185', // date picker — "YYYY-MM-DD", or null to clear
}

export interface JiraUpdateInput {
  businessUnit?: string
  typeOfIssue?: string
  rootCause?: string
  resolution?: string
  deployDate?: string | null // "YYYY-MM-DD", or ''/null to clear
  transitionResolution?: string // built-in Resolution to send when the status change requires one
  status?: string // target status NAME (e.g. "Closed") — resolved via transitions
}

// ── Build an Atlassian Document (ADF) from plain text ────────────
// Root Cause / Resolution are rich-text custom fields in this Jira instance —
// Jira rejects a plain string for them ("Operation value must be an Atlassian
// Document"). An empty/blank string clears the field (Jira accepts `null` for
// clearing an optional custom field; an empty ADF document is NOT accepted).
function toAdf(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }],
  }
}

// ── Update plain/select fields on an issue (PUT /issue/{key}) ───
async function updateJiraFields(key: string, fields: Record<string, unknown>): Promise<void> {
  if (Object.keys(fields).length === 0) return
  try {
    await jiraClient.put(`/issue/${key}`, { fields })
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown } }
    console.error(`[jira] PUT /issue/${key} failed — status ${e?.response?.status}`, JSON.stringify(e?.response?.data))
    throw new Error(`อัปเดต Jira ไม่สำเร็จ (${key}): ${JSON.stringify(e?.response?.data ?? err)}`)
  }
}

// ── Get available workflow transitions for an issue ─────────────
// `fields` = the transition screen: what Jira requires/accepts when making this move
// (e.g. the built-in Resolution is usually REQUIRED when moving to Resolved).
interface JiraTransitionField {
  required?: boolean
  name?: string
  hasDefaultValue?: boolean
  allowedValues?: Array<{ id?: string; name?: string; value?: string }>
}
interface JiraTransition {
  id: string
  name: string
  to: { name: string }
  fields?: Record<string, JiraTransitionField>
}

async function getTransitions(key: string): Promise<JiraTransition[]> {
  const { data } = await jiraClient.get(`/issue/${key}/transitions`, { params: { expand: 'transitions.fields' } })
  return (data.transitions ?? []) as JiraTransition[]
}

function optionNames(f?: JiraTransitionField): string[] {
  return (f?.allowedValues ?? []).map(v => v.name ?? v.value ?? '').filter(Boolean)
}

// Picks a sensible default for Jira's built-in Resolution (the user can override in the UI).
const RESOLUTION_PREFERENCE = ['done', 'fixed', 'resolved', 'complete', 'completed']
export function pickDefaultResolution(options: string[]): string | undefined {
  for (const pref of RESOLUTION_PREFERENCE) {
    const hit = options.find(o => o.toLowerCase() === pref)
    if (hit) return hit
  }
  return options[0]
}

export interface AllowedStatusInfo {
  /** built-in Jira Resolution the transition requires — options to choose from */
  resolutionOptions?: string[]
  resolutionDefault?: string
  /** other REQUIRED fields on the transition screen that this app cannot fill (names) */
  needs?: string[]
}

// Fields this app fills itself (written to the issue BEFORE the transition runs), so
// they don't count as "needs" even if the transition screen lists them as required.
const FILLED_BY_APP = new Set(['customfield_10207', 'customfield_10169', 'customfield_10079', 'customfield_10053', 'customfield_10185'])

// Statuses this ticket can move to RIGHT NOW, as allowed by the Jira workflow for the
// account that owns the API token. Used to fill the Status dropdown.
export async function fetchAllowedStatuses(key: string): Promise<{ allowed: string[]; details: Record<string, AllowedStatusInfo> }> {
  const transitions = await getTransitions(key)
  const allowed = Array.from(new Set(transitions.map(t => t.to.name).filter(Boolean)))
  const details: Record<string, AllowedStatusInfo> = {}
  for (const t of transitions) {
    const info: AllowedStatusInfo = {}
    const res = t.fields?.resolution
    if (res?.required) {
      const opts = optionNames(res)
      if (opts.length) { info.resolutionOptions = opts; info.resolutionDefault = pickDefaultResolution(opts) }
    }
    const needs = Object.entries(t.fields ?? {})
      .filter(([id, f]) => f.required && !f.hasDefaultValue && id !== 'resolution' && !FILLED_BY_APP.has(id))
      .map(([id, f]) => f.name ?? id)
    if (needs.length) info.needs = needs
    if (info.resolutionOptions || info.needs) details[t.to.name] = info
  }
  return { allowed, details }
}

// Turn Jira's error body into one readable line: field errors use the field's display name.
function describeJiraError(data: unknown, fields?: Record<string, JiraTransitionField>): string {
  const d = (data ?? {}) as { errorMessages?: string[]; errors?: Record<string, string> }
  const parts: string[] = [...(d.errorMessages ?? [])]
  for (const [id, msg] of Object.entries(d.errors ?? {})) {
    parts.push(`${fields?.[id]?.name ?? id}: ${msg}`)
  }
  return parts.join(' | ')
}

// ── Transition an issue to a target status by NAME ───────────────
// Jira statuses are workflow-controlled — you can't just set a field,
// you must find the transition that leads to the desired status.
async function transitionIssueToStatus(
  key: string,
  targetStatusName: string,
  resolutionChoice?: string,
): Promise<{ ok: boolean; message?: string }> {
  const transitions = await getTransitions(key)

  const match = transitions.find(
    t => t.to.name.toLowerCase() === targetStatusName.toLowerCase()
      || t.name.toLowerCase() === targetStatusName.toLowerCase()
  )

  if (!match) {
    const available = transitions.map(t => t.to.name).join(', ')
    return {
      ok: false,
      message: `ไม่สามารถเปลี่ยนสถานะเป็น "${targetStatusName}" ได้ — สถานะที่เปลี่ยนได้ตอนนี้คือ: ${available || 'ไม่มี'}`,
    }
  }

  // When the transition screen REQUIRES the built-in Resolution, send one.
  const payload: { transition: { id: string }; fields?: Record<string, unknown> } = { transition: { id: match.id } }
  const resField = match.fields?.resolution
  if (resField?.required) {
    const opts = optionNames(resField)
    const chosen = resolutionChoice && opts.includes(resolutionChoice) ? resolutionChoice : pickDefaultResolution(opts)
    if (chosen) payload.fields = { resolution: { name: chosen } }
  }

  try {
    await jiraClient.post(`/issue/${key}/transitions`, payload)
    return { ok: true }
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown } }
    console.error(`[jira] transition failed for ${key} -> ${match.to.name} (status ${e?.response?.status})`, JSON.stringify(e?.response?.data))
    const reason = describeJiraError(e?.response?.data, match.fields)
    return {
      ok: false,
      message: `เปลี่ยนสถานะเป็น "${match.to.name}" ใน Jira ไม่สำเร็จ${reason ? ` — Jira แจ้งว่า: ${reason}` : e?.response?.status ? ` (HTTP ${e.response.status})` : ''}`,
    }
  }
}

// ── Deploy Date → value Jira accepts ─────────────────────────────
// Returns "YYYY-MM-DD" (valid real date), null (clear the field),
// or undefined (invalid input — caller should skip and warn).
export function normalizeDeployDate(v: string | null): string | null | undefined {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  if (!t) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined
  return `${m[1]}-${m[2]}-${m[3]}`
}

// ── Main entry point: push a set of dashboard edits back to Jira ─
// Returns which parts succeeded/failed so the caller can report clearly.
export async function pushTicketUpdateToJira(
  key: string,
  input: JiraUpdateInput
): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = []

  // 1) Plain/select fields (Business Unit, Type of Issue, Root Cause, Resolution, Deploy Date)
  const fields: Record<string, unknown> = {}

  if (input.businessUnit !== undefined) {
    fields[WRITE_FIELD_IDS.businessUnit] = input.businessUnit
  }
  if (input.typeOfIssue !== undefined) {
    fields[WRITE_FIELD_IDS.typeOfIssue] = { value: input.typeOfIssue }
  }
  if (input.rootCause !== undefined) {
    fields[WRITE_FIELD_IDS.rootCause] = toAdf(input.rootCause)
  }
  if (input.resolution !== undefined) {
    fields[WRITE_FIELD_IDS.resolution] = toAdf(input.resolution)
  }
  if (input.deployDate !== undefined) {
    const d = normalizeDeployDate(input.deployDate)
    if (d === undefined) {
      warnings.push('รูปแบบ Deploy Date ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD) — ข้ามการอัปเดตวันที่')
    } else {
      fields[WRITE_FIELD_IDS.deployDate] = d
    }
  }

  if (Object.keys(fields).length > 0) {
    try {
      await updateJiraFields(key, fields)
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : 'อัปเดตข้อมูลบางส่วนไม่สำเร็จ')
    }
  }

  // 2) Status — requires a workflow transition, handled separately
  if (input.status) {
    const result = await transitionIssueToStatus(key, input.status, input.transitionResolution)
    if (!result.ok && result.message) warnings.push(result.message)
  }

  return { ok: warnings.length === 0, warnings }
}

// ══════════════════════════════════════════════════════════════
// ── COMMENTS & CHANGELOG — read ticket activity history ────────
// ══════════════════════════════════════════════════════════════

export interface JiraComment {
  id: string
  author: string
  body: string
  created: string
}

export interface JiraChangelogEntry {
  id: string
  author: string
  created: string
  changes: Array<{ field: string; from: string; to: string }>
}

function adfToPlainText(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  try {
    const doc = v as { content?: Array<{ content?: Array<{ text?: string }> }> }
    return (doc.content ?? [])
      .flatMap(b => b.content ?? [])
      .map(n => n.text ?? '')
      .join(' ')
      .trim()
  } catch { return '' }
}

// ── Fetch comments for a ticket ──────────────────────────────────
export async function fetchJiraComments(key: string): Promise<JiraComment[]> {
  const { data } = await jiraClient.get(`/issue/${key}/comment`, {
    params: { orderBy: '-created', maxResults: 50 },
  })
  const comments = (data.comments ?? []) as Array<Record<string, unknown>>
  return comments.map(c => ({
    id:      String(c.id ?? ''),
    author:  String((c.author as { displayName?: string })?.displayName ?? 'Unknown'),
    body:    adfToPlainText(c.body),
    created: String(c.created ?? ''),
  }))
}

// ── Fetch changelog (status/field change history) for a ticket ──
export async function fetchJiraChangelog(key: string): Promise<JiraChangelogEntry[]> {
  const { data } = await jiraClient.get(`/issue/${key}`, {
    params: { expand: 'changelog' },
  })
  const histories = (data.changelog?.histories ?? []) as Array<Record<string, unknown>>

  return histories.map(h => ({
    id:      String(h.id ?? ''),
    author:  String((h.author as { displayName?: string })?.displayName ?? 'Unknown'),
    created: String(h.created ?? ''),
    changes: ((h.items ?? []) as Array<Record<string, unknown>>).map(item => ({
      field: String(item.field ?? ''),
      from:  String(item.fromString ?? '—'),
      to:    String(item.toString ?? '—'),
    })),
  })).reverse() // newest first
}

// ── Add a new comment to a ticket ────────────────────────────────
// Every write goes through ONE Jira API token, so Jira would show all comments as the
// token owner. `author` (the Dashboard user who pressed the button) is appended as a
// signature line so the real person is visible in Jira.
export async function addJiraComment(key: string, text: string, author?: string): Promise<void> {
  const paragraphs: unknown[] = text
    .split(/\r?\n/)
    .map(line => ({
      type: 'paragraph',
      content: line.trim() ? [{ type: 'text', text: line }] : [],
    }))

  const name = (author ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80)
  if (name) {
    paragraphs.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `— ${name} (ผ่าน CTS Dashboard)`, marks: [{ type: 'em' }] }],
    })
  }

  await jiraClient.post(`/issue/${key}/comment`, {
    body: { type: 'doc', version: 1, content: paragraphs },
  })
}

export default jiraClient

// ══════════════════════════════════════════════════════════════
// ── ATTACHMENTS — list & download files attached to a ticket ───
// ══════════════════════════════════════════════════════════════

export interface JiraAttachment {
  id:       string
  filename: string
  size:     number
  mimeType: string
  author:   string
  created:  string
}

// ── List attachment metadata for a ticket ────────────────────────
export async function fetchJiraAttachments(key: string): Promise<JiraAttachment[]> {
  const { data } = await jiraClient.get(`/issue/${key}`, {
    params: { fields: 'attachment' },
  })
  const attachments = (data.fields?.attachment ?? []) as Array<Record<string, unknown>>

  return attachments.map(a => ({
    id:       String(a.id ?? ''),
    filename: String(a.filename ?? 'unnamed'),
    size:     Number(a.size ?? 0),
    mimeType: String(a.mimeType ?? 'application/octet-stream'),
    author:   String((a.author as { displayName?: string })?.displayName ?? 'Unknown'),
    created:  String(a.created ?? ''),
  }))
}

// ── Download raw attachment bytes (proxied — Jira requires auth) ──
export async function downloadJiraAttachment(
  attachmentId: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  // First get metadata to know filename + mimeType (content endpoint doesn't return them)
  const { data: meta } = await jiraClient.get(`/attachment/${attachmentId}`)

  const { data: buffer } = await jiraClient.get(`/attachment/content/${attachmentId}`, {
    responseType: 'arraybuffer',
  })

  return {
    buffer:   Buffer.from(buffer as ArrayBuffer),
    mimeType: String(meta.mimeType ?? 'application/octet-stream'),
    filename: String(meta.filename ?? 'download'),
  }
}


