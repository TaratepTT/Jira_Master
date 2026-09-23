import axios from 'axios'

const JIRA_BASE_URL = process.env.JIRA_BASE_URL ?? ''
const JIRA_EMAIL   = process.env.JIRA_EMAIL ?? ''
const JIRA_TOKEN   = process.env.JIRA_API_TOKEN ?? ''

const jiraClient = axios.create({
  baseURL: `${JIRA_BASE_URL}/rest/api/3`,
  auth: { username: JIRA_EMAIL, password: JIRA_TOKEN },
  headers: { 'Accept': 'application/json' },
  timeout: 30_000,
})

// ── Field IDs ─────────────────────────────────────────────────
const FIELDS = [
  'key', 'summary', 'assignee', 'priority', 'status',
  'created', 'resolutiondate', 'issuetype',
  'customfield_10207', // Business Unit
  'customfield_14795', // Issue Category
  'customfield_10079', // Root Cause
  'customfield_10053', // Resolution (custom)
  'customfield_10169', // Type of Issue
  'customfield_10168', // Type of System
].join(',')

// ── Types ─────────────────────────────────────────────────────
export interface JiraIssue {
  key:              string
  summary:          string
  assignee:         string
  priority:         string
  status:           string
  created:          string
  resolved:         string
  businessUnit:     string
  system:           string   // Issue Type (issuetype name)
  issueCategory:    string   // customfield_14795
  rootCause:        string   // customfield_10079
  resolution:       string   // customfield_10053
  typeOfIssue:      string   // customfield_10169
  typeOfSystem:     string   // customfield_10168
}

// ── Map raw Jira issue to our shape ──────────────────────────
function mapIssue(raw: Record<string, unknown>): JiraIssue {
  const f = raw.fields as Record<string, unknown>

  const str = (v: unknown): string => {
    if (!v) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>
      return String(o.value ?? o.name ?? o.displayName ?? o.emailAddress ?? '')
    }
    return String(v)
  }

  // Root Cause and Resolution are Atlassian Document Format (ADF) — extract plain text
  const adf = (v: unknown): string => {
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

  return {
    key:           String(raw.key ?? ''),
    summary:       str(f.summary),
    assignee:      str(f.assignee),
    priority:      str(f.priority),
    status:        str(f.status),
    created:       str(f.created),
    resolved:      str(f.resolutiondate),
    businessUnit:  str(f.customfield_10207),
    system:        str(f.issuetype),           // "CMP Incident" etc.
    issueCategory: str(f.customfield_14795),
    rootCause:     adf(f.customfield_10079),
    resolution:    adf(f.customfield_10053),
    typeOfIssue:   str(f.customfield_10169),
    typeOfSystem:  str(f.customfield_10168),
  }
}

// ── Fetch all issues matching a JQL (handles pagination) ─────
export async function fetchJiraIssues(
  jql: string,
  maxTotal = 500
): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = []
  let startAt = 0
  const pageSize = 100

  while (issues.length < maxTotal) {
    try {
      const { data } = await jiraClient.post('/search/jql', {
        jql,
        fields: FIELDS.split(','),
        startAt,
        maxResults: pageSize,
      })

      const page = (data.issues ?? []) as Record<string, unknown>[]
      issues.push(...page.map(mapIssue))

      if (issues.length >= data.total || page.length < pageSize) break
      startAt += pageSize
    } catch (err: unknown) {
      const e = err as { response?: { data?: unknown; status?: number } }
      console.error('[jira] error:', JSON.stringify(e?.response?.data))
      throw err
    }
  }

  return issues
}

// ── Test connection ───────────────────────────────────────────
export async function testJiraConnection(): Promise<{ ok: boolean; email: string }> {
  const { data } = await jiraClient.get('/myself')
  return { ok: true, email: data.emailAddress }
}

export default jiraClient
