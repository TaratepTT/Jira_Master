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

// ── Fetch issues via new Jira Cloud /search/jql endpoint ─────
// Uses nextPageToken pagination (NOT startAt — deprecated).
export async function fetchJiraIssues(
  jql: string,
  maxTotal = 500
): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = []
  let nextPageToken: string | undefined = undefined
  const pageSize = 50

  while (issues.length < maxTotal) {
    const body: Record<string, unknown> = {
      jql,
      maxResults: pageSize,
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
  }

  return issues
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
  rootCause:    'customfield_10079', // textarea field (plain string)
  resolution:   'customfield_10053', // textarea field (plain string)
}

export interface JiraUpdateInput {
  businessUnit?: string
  typeOfIssue?: string
  rootCause?: string
  resolution?: string
  status?: string // target status NAME (e.g. "Closed") — resolved via transitions
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
interface JiraTransition {
  id: string
  name: string
  to: { name: string }
}

async function getTransitions(key: string): Promise<JiraTransition[]> {
  const { data } = await jiraClient.get(`/issue/${key}/transitions`)
  return (data.transitions ?? []) as JiraTransition[]
}

// ── Transition an issue to a target status by NAME ───────────────
// Jira statuses are workflow-controlled — you can't just set a field,
// you must find the transition that leads to the desired status.
async function transitionIssueToStatus(key: string, targetStatusName: string): Promise<{ ok: boolean; message?: string }> {
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

  try {
    await jiraClient.post(`/issue/${key}/transitions`, {
      transition: { id: match.id },
    })
    return { ok: true }
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown } }
    console.error(`[jira] transition failed for ${key}`, JSON.stringify(e?.response?.data))
    return { ok: false, message: 'เปลี่ยนสถานะใน Jira ไม่สำเร็จ' }
  }
}

// ── Main entry point: push a set of dashboard edits back to Jira ─
// Returns which parts succeeded/failed so the caller can report clearly.
export async function pushTicketUpdateToJira(
  key: string,
  input: JiraUpdateInput
): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = []

  // 1) Plain/select fields (Business Unit, Type of Issue, Root Cause, Resolution)
  const fields: Record<string, unknown> = {}

  if (input.businessUnit !== undefined) {
    fields[WRITE_FIELD_IDS.businessUnit] = input.businessUnit
  }
  if (input.typeOfIssue !== undefined) {
    fields[WRITE_FIELD_IDS.typeOfIssue] = { value: input.typeOfIssue }
  }
  if (input.rootCause !== undefined) {
    fields[WRITE_FIELD_IDS.rootCause] = input.rootCause
  }
  if (input.resolution !== undefined) {
    fields[WRITE_FIELD_IDS.resolution] = input.resolution
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
    const result = await transitionIssueToStatus(key, input.status)
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
export async function addJiraComment(key: string, text: string): Promise<void> {
  await jiraClient.post(`/issue/${key}/comment`, {
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    },
  })
}

export default jiraClient

