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

// ── Fetch issues via JQL with pagination ─────────────────────
export async function fetchJiraIssues(
  jql: string,
  maxTotal = 500
): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = []
  let startAt = 0
  const pageSize = 50 // smaller page = safer for Jira Cloud rate limits

  while (issues.length < maxTotal) {
    let data: Record<string, unknown>

    try {
      // Jira Cloud API v3 — POST /search
      const resp = await jiraClient.post('/search', {
        jql,
        startAt,
        maxResults: pageSize,
        fields: FIELDS,
      })
      data = resp.data as Record<string, unknown>
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: unknown } }
      const status = e?.response?.status
      const errData = e?.response?.data

      // Log full error for debugging
      console.error(`[jira] POST /search failed — status ${status}:`, JSON.stringify(errData))

      // If /search fails with 410, try legacy /search as GET
      if (status === 410) {
        console.log('[jira] Retrying with GET /search...')
        const resp2 = await jiraClient.get('/search', {
          params: {
            jql,
            startAt,
            maxResults: pageSize,
            fields: FIELDS.join(','),
          },
        })
        data = resp2.data as Record<string, unknown>
      } else {
        throw err
      }
    }

    const page = (data.issues ?? []) as Record<string, unknown>[]
    issues.push(...page.map(mapIssue))

    const total = Number(data.total ?? 0)
    if (issues.length >= total || page.length < pageSize) break
    startAt += pageSize
  }

  return issues
}

// ── Test connection ───────────────────────────────────────────
export async function testJiraConnection(): Promise<{ ok: boolean; email: string }> {
  const { data } = await jiraClient.get('/myself')
  return { ok: true, email: (data as { emailAddress: string }).emailAddress }
}

export default jiraClient
