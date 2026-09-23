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
}

// ── Extract plain text from Atlassian Document Format (ADF) ──
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

// ── Extract string value from various Jira field shapes ──────
function str(v: unknown): string {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    return String(o.value ?? o.name ?? o.displayName ?? o.emailAddress ?? '')
  }
  return String(v)
}

// ── Map raw Jira issue → our shape ───────────────────────────
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
  }
}

// ── Fetch issues via new Jira Cloud /search/jql endpoint ─────
// NOTE: This endpoint uses nextPageToken pagination, NOT startAt.
// See: https://developer.atlassian.com/cloud/jira/platform/changelog/#CHANGE-2046
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

export default jiraClient
