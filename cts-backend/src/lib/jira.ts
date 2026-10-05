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
  schema?: { type?: string; items?: string; custom?: string; system?: string }
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

// ── The "closing lane": a forward-only chain of statuses ─────────
// From the workflow diagram:  ... -> Resolved -> CLOSING -> Closed
// Jira only shows the NEXT step(s) from the current status, so to reach Closed from e.g.
// L2-IN PROGRESS the app queues the steps one after another (each one is a real Jira
// transition, with the same checks as doing it by hand). Edit this list if the workflow changes.
// Moves are forward-only: the app never goes backwards, so tickets are never re-opened this way.
export const CLOSING_LANE = ['Resolved', 'CLOSING', 'Closed']
const sameStatus = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const laneIndex = (name: string) => CLOSING_LANE.findIndex(l => sameStatus(l, name))

// Path to `target` starting from one of the transitions available right now, or null if the
// target is not in the lane / no lane step is reachable. Path = ordered status names to pass through.
function planQueuedPath(transitions: JiraTransition[], target: string): string[] | null {
  const ti = laneIndex(target)
  if (ti < 0) return null
  let best: { idx: number; name: string } | null = null
  for (const t of transitions) {
    const idx = laneIndex(t.to.name)
    if (idx >= 0 && idx < ti && (!best || idx > best.idx)) best = { idx, name: t.to.name }
  }
  if (!best) return null
  return [best.name, ...CLOSING_LANE.slice(best.idx + 1, ti + 1)]
}

// Statuses this ticket can move to RIGHT NOW, as allowed by the Jira workflow for the
// account that owns the API token. Used to fill the Status dropdown.
// `queued` = further lane statuses that can be reached by chaining several moves.
export async function fetchAllowedStatuses(key: string): Promise<{
  allowed: string[]
  details: Record<string, AllowedStatusInfo>
  queued: Record<string, string[]>
}> {
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
  const queued: Record<string, string[]> = {}
  for (const lane of CLOSING_LANE) {
    if (allowed.some(a => sameStatus(a, lane))) continue // already one click away
    const path = planQueuedPath(transitions, lane)
    if (path) queued[lane] = path
  }
  return { allowed, details, queued }
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

// ── "Echo" the ticket's own values into the transition request ───
// Many workflows have a validator ("The following fields must not be left empty: ...")
// that looks at the values SUBMITTED with the transition, not the ones already stored on
// the issue — so a ticket that is fully filled in still fails when the API call sends
// nothing. We therefore read the current value of every custom field on the transition
// screen and send it back unchanged (the Jira web UI does the same: its transition dialog
// is pre-filled with the current values).
function hasAdfText(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false
  const o = n as { text?: unknown; content?: unknown; type?: unknown }
  if (typeof o.text === 'string' && o.text.trim()) return true
  if (o.type === 'media' || o.type === 'mediaSingle' || o.type === 'inlineCard') return true
  return Array.isArray(o.content) && o.content.some(hasAdfText)
}

// Convert a value as READ from an issue into the shape Jira accepts when WRITING it.
// Returns undefined for empty / unsupported values (those are not echoed).
function toWritable(v: unknown): unknown {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'string') return v.trim() ? v : undefined
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    const arr = v.map(toWritable).filter(x => x !== undefined)
    return arr.length ? arr : undefined
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.type === 'doc') return hasAdfText(o) ? o : undefined
    if (typeof o.accountId === 'string') return { accountId: o.accountId }
    if (o.id !== undefined && o.id !== null) {
      const out: Record<string, unknown> = { id: String(o.id) }
      const child = toWritable(o.child)
      if (child !== undefined) out.child = child
      return out
    }
    if (typeof o.value === 'string' && o.value) return { value: o.value }
  }
  return undefined
}

const ECHO_SCALAR_TYPES = new Set(['string', 'number', 'date', 'datetime', 'option', 'option-with-child', 'user'])
function isEchoable(id: string, f: JiraTransitionField): boolean {
  if (!id.startsWith('customfield_')) return false
  const t = f.schema?.type
  if (!t) return false
  if (t === 'array') return ['option', 'string', 'user'].includes(f.schema?.items ?? '')
  return ECHO_SCALAR_TYPES.has(t)
}

async function fetchCurrentFieldValues(key: string, ids: string[]): Promise<Record<string, unknown>> {
  if (!ids.length) return {}
  try {
    const { data } = await jiraClient.get(`/issue/${key}`, { params: { fields: ids.join(',') } })
    return (data?.fields ?? {}) as Record<string, unknown>
  } catch (err) {
    console.error(`[jira] could not read current field values of ${key}:`, err instanceof Error ? err.message : err)
    return {}
  }
}

// Work out WHY a "must not be left empty" validator failed, in plain words:
//   - fields that are really empty on the ticket  -> the user must fill them in Jira first
//   - fields that are not on the transition screen -> this app cannot send them at all
function explainEmptyFields(
  reason: string,
  screen: Record<string, JiraTransitionField>,
  current: Record<string, unknown>,
): string {
  const seg = reason.split(' | ').find(x => /must not be left empty/i.test(x))
  if (!seg) return ''
  const list = seg.slice(seg.indexOf(':') + 1).replace(/\.\s*$/, '').trim()
  if (!list) return ''

  // Jira joins the last two names with "and", but a field can itself be called "A and B".
  const tokens = list.split(/,\s*|\s+and\s+/).map(t => t.trim()).filter(Boolean)
  const nameToId = new Map<string, string>()
  for (const [id, f] of Object.entries(screen)) if (f.name) nameToId.set(f.name.toLowerCase(), id)
  const names: string[] = []
  const lastTwo = tokens.length >= 2 ? `${tokens[tokens.length - 2]} and ${tokens[tokens.length - 1]}` : ''
  if (lastTwo && nameToId.has(lastTwo.toLowerCase())) {
    names.push(...tokens.slice(0, -2), lastTwo)
  } else {
    names.push(...tokens)
  }

  const empty: string[] = []
  const offScreen: string[] = []
  for (const n of names) {
    const id = nameToId.get(n.toLowerCase())
    if (!id) { offScreen.push(n); continue }
    if (toWritable(current[id]) === undefined) empty.push(n)
  }
  const out: string[] = []
  if (empty.length) out.push(`ยังว่างอยู่ใน Jira — ต้องไปกรอกใน Jira ก่อน: ${empty.join(', ')}`)
  if (offScreen.length) out.push(`ไม่อยู่ในหน้าจอ transition จึงส่งผ่านแอปไม่ได้: ${offScreen.join(', ')}`)
  return out.join(' | ')
}

// ── Transition an issue to a target status by NAME ───────────────
// Jira statuses are workflow-controlled — you can't just set a field,
// you must find the transition that leads to the desired status.
async function transitionIssueToStatus(
  key: string,
  targetStatusName: string,
  resolutionChoice?: string,
): Promise<{ ok: boolean; message?: string; toName?: string }> {
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

  const screen = match.fields ?? {}

  // Built-in Resolution: pick the user's choice (or a sensible default) from Jira's own list.
  const resField = screen.resolution
  const resolutionValue = (): { name: string } | undefined => {
    const opts = optionNames(resField)
    const chosen = resolutionChoice && opts.includes(resolutionChoice) ? resolutionChoice : pickDefaultResolution(opts)
    return chosen ? { name: chosen } : undefined
  }

  // Current values of the custom fields on the transition screen -> echoed back unchanged.
  const echoIds = Object.entries(screen).filter(([id, f]) => isEchoable(id, f)).map(([id]) => id)
  const current = await fetchCurrentFieldValues(key, echoIds)
  const echo: Record<string, unknown> = {}
  for (const id of echoIds) {
    const w = toWritable(current[id])
    if (w !== undefined) echo[id] = w
  }

  const post = (fields: Record<string, unknown>) =>
    jiraClient.post(`/issue/${key}/transitions`, {
      transition: { id: match.id },
      ...(Object.keys(fields).length ? { fields } : {}),
    })

  const fields: Record<string, unknown> = { ...echo }
  if (resField?.required) {
    const r = resolutionValue()
    if (r) fields.resolution = r
  }

  let lastErr: { status?: number; data?: unknown } | undefined
  const attempt = async (f: Record<string, unknown>): Promise<boolean> => {
    try {
      await post(f)
      return true
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown } }
      lastErr = { status: e?.response?.status, data: e?.response?.data }
      console.error(`[jira] transition failed for ${key} -> ${match.to.name} (status ${lastErr.status})`, JSON.stringify(lastErr.data))
      return false
    }
  }

  if (await attempt(fields)) return { ok: true, toName: match.to.name }

  let reason = describeJiraError(lastErr?.data, screen)
  const isEmptyValidator = /must not be left empty/i.test(reason)

  // The validator also wants Jira's built-in Resolution, which is on the screen but not marked required.
  if (isEmptyValidator && resField && !fields.resolution && /\bresolution\b/i.test(reason)) {
    const r = resolutionValue()
    if (r && await attempt({ ...fields, resolution: r })) return { ok: true, toName: match.to.name }
    reason = describeJiraError(lastErr?.data, screen)
  }

  // An unrelated rejection while we were echoing values: fall back to the plain request,
  // so a transition that always worked without extra fields keeps working.
  if (!isEmptyValidator && Object.keys(echo).length > 0) {
    const plain: Record<string, unknown> = {}
    if (fields.resolution) plain.resolution = fields.resolution
    if (await attempt(plain)) return { ok: true, toName: match.to.name }
    reason = describeJiraError(lastErr?.data, screen)
  }

  const explain = explainEmptyFields(reason, screen, current)
  return {
    ok: false,
    message:
      `เปลี่ยนสถานะเป็น "${match.to.name}" ใน Jira ไม่สำเร็จ` +
      (reason ? ` — Jira แจ้งว่า: ${reason}` : lastErr?.status ? ` (HTTP ${lastErr.status})` : '') +
      (explain ? `\n${explain}` : ''),
  }
}

// ══════════════════════════════════════════════════════════════
// ── EXTRA FIELDS editable from the Dashboard (found BY NAME) ────
// Action Card / Type / Task Type are dropdowns in Jira, and some workflow transitions
// (e.g. → Resolved) refuse to run while they are empty. Their field IDs are not
// hard-coded: they are looked up by display name in the issue's edit screen, together
// with the options Jira allows — so the Dashboard always offers exactly Jira's own choices.
// ══════════════════════════════════════════════════════════════
export const EXTRA_FIELD_NAMES = ['Action Card', 'Type', 'Task Type', 'Type of System']

export interface ExtraFieldOption { id: string; value: string; children?: Array<{ id: string; value: string }> }
export interface ExtraFieldMeta {
  id: string
  name: string
  kind: 'option' | 'option-with-child' | 'multi-option' | 'text'
  required: boolean
  options: ExtraFieldOption[]
  current: { id?: string; childId?: string; ids?: string[]; text?: string }
  currentLabel: string
}
// What the browser sends back for one field: null = clear
export type ExtraFieldInput = { id: string; childId?: string } | { ids: string[] } | { text: string } | null

interface RawOption { id?: unknown; value?: unknown; name?: unknown; children?: RawOption[] }
const optLabel = (o: RawOption | null | undefined): string => String(o?.value ?? o?.name ?? '')

export async function fetchExtraFields(key: string): Promise<ExtraFieldMeta[]> {
  const { data } = await jiraClient.get(`/issue/${key}/editmeta`)
  const raw = (data?.fields ?? {}) as Record<string, {
    name?: string; required?: boolean
    schema?: { type?: string; items?: string; custom?: string }
    allowedValues?: RawOption[]
  }>

  const order = new Map(EXTRA_FIELD_NAMES.map((n, i) => [n.toLowerCase(), i]))
  const picked: Array<{ id: string; f: (typeof raw)[string]; kind: ExtraFieldMeta['kind'] }> = []
  for (const [id, f] of Object.entries(raw)) {
    if (!id.startsWith('customfield_') || !f?.name) continue
    if (!order.has(f.name.trim().toLowerCase())) continue
    const t = f.schema?.type
    const kind: ExtraFieldMeta['kind'] | null =
      t === 'option' ? 'option'
      : t === 'option-with-child' ? 'option-with-child'
      : t === 'array' && f.schema?.items === 'option' ? 'multi-option'
      : t === 'string' && (f.schema?.custom ?? '').endsWith(':textfield') ? 'text' // single-line text only (rich text is ADF — not supported here)
      : null
    if (kind) picked.push({ id, f, kind })
  }
  picked.sort((a, b) => (order.get(a.f.name!.trim().toLowerCase()) ?? 99) - (order.get(b.f.name!.trim().toLowerCase()) ?? 99))
  if (!picked.length) return []

  const current = await fetchCurrentFieldValues(key, picked.map(p => p.id))

  return picked.map(({ id, f, kind }) => {
    const options: ExtraFieldOption[] = (f.allowedValues ?? [])
      .filter(o => o && o.id !== undefined && optLabel(o))
      .map(o => ({
        id: String(o.id),
        value: optLabel(o),
        ...(o.children?.length
          ? { children: o.children.filter(c => c && c.id !== undefined && optLabel(c)).map(c => ({ id: String(c.id), value: optLabel(c) })) }
          : {}),
      }))

    const cur = current[id] as RawOption | RawOption[] | string | null | undefined
    let cv: ExtraFieldMeta['current'] = {}
    let label = ''
    if (kind === 'text') {
      const t = typeof cur === 'string' ? cur : ''
      cv = { text: t }
      label = t
    } else if (kind === 'multi-option') {
      const arr = Array.isArray(cur) ? cur : []
      cv = { ids: arr.filter(o => o?.id !== undefined).map(o => String(o.id)) }
      label = arr.map(optLabel).filter(Boolean).join(', ')
    } else if (cur && typeof cur === 'object' && !Array.isArray(cur) && cur.id !== undefined) {
      cv = { id: String(cur.id) }
      label = optLabel(cur)
      const child = (cur as { child?: RawOption }).child
      if (kind === 'option-with-child' && child?.id !== undefined) {
        cv.childId = String(child.id)
        label = `${label} › ${optLabel(child)}`
      }
    }
    return { id, name: f.name!.trim(), kind, required: !!f.required, options, current: cv, currentLabel: label }
  })
}

// Validate what the browser sent against Jira's own metadata and build the write payload.
// Only fields found by NAME above can be written, and only with options Jira lists, so an
// editor cannot use this endpoint to set arbitrary custom fields or arbitrary values.
export async function prepareExtraFieldUpdate(
  key: string,
  input: Record<string, ExtraFieldInput>,
): Promise<
  | { ok: true; payload: Record<string, unknown>; changes: Record<string, { from: string; to: string }> }
  | { ok: false; message: string }
> {
  let metas: ExtraFieldMeta[]
  try {
    metas = await fetchExtraFields(key)
  } catch {
    return { ok: false, message: 'อ่านข้อมูล field จาก Jira ไม่สำเร็จ — ลองใหม่อีกครั้ง' }
  }
  const byId = new Map(metas.map(m => [m.id, m]))
  const payload: Record<string, unknown> = {}
  const changes: Record<string, { from: string; to: string }> = {}

  for (const [fieldId, v] of Object.entries(input)) {
    const m = byId.get(fieldId)
    if (!m) return { ok: false, message: `ไม่อนุญาตให้แก้ field นี้ (${fieldId})` }

    let to = ''
    if (v === null) {
      payload[fieldId] = m.kind === 'multi-option' ? [] : null
    } else if (m.kind === 'text') {
      const t = (v as { text?: unknown }).text
      if (typeof t !== 'string') return { ok: false, message: `ค่าของ ${m.name} ไม่ถูกต้อง` }
      const trimmed = t.trim()
      if (trimmed.length > 255) return { ok: false, message: `${m.name}: ยาวเกิน 255 ตัวอักษร` }
      payload[fieldId] = trimmed ? trimmed : null
      to = trimmed
    } else if (m.kind === 'multi-option') {
      const ids = (v as { ids?: unknown }).ids
      if (!Array.isArray(ids)) return { ok: false, message: `ค่าของ ${m.name} ไม่ถูกต้อง` }
      const chosen = ids.map(String).map(id => m.options.find(o => o.id === id))
      if (chosen.some(o => !o)) return { ok: false, message: `${m.name}: มีตัวเลือกที่ Jira ไม่รองรับ` }
      payload[fieldId] = chosen.map(o => ({ id: o!.id }))
      to = chosen.map(o => o!.value).join(', ')
    } else {
      const id = String((v as { id?: unknown }).id ?? '')
      const opt = m.options.find(o => o.id === id)
      if (!opt) return { ok: false, message: `${m.name}: ตัวเลือกนี้ Jira ไม่รองรับ` }
      to = opt.value
      if (m.kind === 'option-with-child') {
        const childId = (v as { childId?: unknown }).childId
        if (childId !== undefined && childId !== '') {
          const child = opt.children?.find(c => c.id === String(childId))
          if (!child) return { ok: false, message: `${m.name}: ตัวเลือกย่อยไม่ถูกต้อง` }
          payload[fieldId] = { id: opt.id, child: { id: child.id } }
          to = `${opt.value} › ${child.value}`
        } else {
          payload[fieldId] = { id: opt.id }
        }
      } else {
        payload[fieldId] = { id: opt.id }
      }
    }
    changes[m.name] = { from: m.currentLabel, to }
  }
  return { ok: true, payload, changes }
}

// ── Move a ticket to a status, queuing several transitions when needed ──
// Direct move when Jira offers it; otherwise, for statuses on the closing lane, the steps
// are executed one by one (re-reading Jira's allowed transitions before every step).
// If a step fails the queue STOPS there and reports exactly which status was reached.
async function moveToStatus(
  key: string,
  target: string,
  resolutionChoice?: string,
): Promise<{ ok: boolean; message?: string; finalStatus?: string; path: string[] }> {
  const transitions = await getTransitions(key)
  const direct = transitions.some(t => sameStatus(t.to.name, target) || sameStatus(t.name, target))

  if (direct) {
    const r = await transitionIssueToStatus(key, target, resolutionChoice)
    return { ok: r.ok, message: r.message, finalStatus: r.toName, path: r.toName ? [r.toName] : [] }
  }

  const plan = planQueuedPath(transitions, target)
  if (!plan) {
    // Not directly allowed and not on a known queue: same explanation as before
    const r = await transitionIssueToStatus(key, target, resolutionChoice)
    return { ok: r.ok, message: r.message, finalStatus: r.toName, path: r.toName ? [r.toName] : [] }
  }

  const reached: string[] = []
  for (const step of plan) {
    const r = await transitionIssueToStatus(key, step, resolutionChoice)
    if (!r.ok) {
      const where = reached.length ? `ไปถึง "${reached[reached.length - 1]}" แล้ว แต่` : 'ยังไม่ได้เริ่มเปลี่ยน —'
      return {
        ok: false,
        finalStatus: reached[reached.length - 1],
        path: reached,
        message: `คิวเปลี่ยนสถานะไป "${target}" (${plan.join(' → ')}) หยุดที่ขั้น "${step}": ${where} ${r.message ?? 'Jira ไม่อนุญาต'}`,
      }
    }
    reached.push(r.toName ?? step)
  }
  return { ok: true, finalStatus: reached[reached.length - 1], path: reached }
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
  input: JiraUpdateInput,
  extraFields?: Record<string, unknown>, // already validated by prepareExtraFieldUpdate() — never taken from the request body
): Promise<{ ok: boolean; warnings: string[]; finalStatus?: string; statusPath?: string[] }> {
  const warnings: string[] = []
  let finalStatus: string | undefined
  let statusPath: string[] | undefined

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

  if (extraFields) Object.assign(fields, extraFields)

  if (Object.keys(fields).length > 0) {
    try {
      await updateJiraFields(key, fields)
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : 'อัปเดตข้อมูลบางส่วนไม่สำเร็จ')
    }
  }

  // 2) Status — requires a workflow transition, handled separately
  if (input.status) {
    const result = await moveToStatus(key, input.status, input.transitionResolution)
    if (!result.ok && result.message) warnings.push(result.message)
    finalStatus = result.finalStatus // set whenever at least one move succeeded (even if the queue stopped midway)
    statusPath = result.path
  }

  return { ok: warnings.length === 0, warnings, finalStatus, statusPath }
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


