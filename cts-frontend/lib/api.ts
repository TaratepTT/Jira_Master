import axios from 'axios'
import type { UploadResponse } from '@/types/ticket'

const TOKEN_KEY = 'cts-auth-token'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  timeout: 60_000,
})

// ── Attach auth token to every request ──────────────────────────
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── On 401, clear token and redirect to login ──────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY)
      const path = window.location.pathname
      if (path !== '/login' && path !== '/register') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// ── Upload file ───────────────────────────────────────────────
export async function uploadReport(
  file: File,
  reportName: string,
  onProgress?: (pct: number) => void
): Promise<UploadResponse> {
  const form = new FormData()
  form.append('file', file)
  form.append('reportName', reportName)

  const { data } = await api.post<UploadResponse>('/api/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100))
    },
  })

  return data
}

// ── List past reports ─────────────────────────────────────────
export async function getReports() {
  const { data } = await api.get('/api/reports')
  return data
}

// ── Delete a report ───────────────────────────────────────────
export async function deleteReport(id: string) {
  await api.delete(`/api/reports/${id}`)
}

// ── Update a ticket + sync to Jira ───────────────────────────
// ── Action Card / Type / Task Type (dropdowns whose options come from Jira) ──
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
// null = clear the field
export type ExtraFieldInput = { id: string; childId?: string } | { ids: string[] } | { text: string } | null

export interface TicketCustomFields {
  fields: ExtraFieldMeta[]
  missing: string[]
  error?: string
}

export async function getTicketCustomFields(reportId: string, key: string): Promise<TicketCustomFields> {
  const { data } = await api.get(`/api/reports/${reportId}/tickets/${key}/custom-fields`)
  return data as TicketCustomFields
}

export interface TicketUpdateInput {
  businessUnit?: string
  typeOfIssue?: string
  rootCause?: string
  resolution?: string
  deployDate?: string | null // "YYYY-MM-DD"; '' or null = clear
  transitionResolution?: string // Jira's built-in Resolution, when the status change requires one
  customFields?: Record<string, ExtraFieldInput> // keyed by Jira field id
  status?: string
}

// Who the backend wrote to Jira as: the user's own account (OAuth) or the shared API token
export interface JiraIdentity {
  jiraAs?: 'user' | 'shared'
  jiraUser?: string
  /** set when the user's own connection could not be used (fell back to the shared token) */
  jiraNotice?: string
}

export async function updateTicket(reportId: string, key: string, input: TicketUpdateInput) {
  const { data } = await api.patch(`/api/reports/${reportId}/tickets/${key}`, input)
  return data as JiraIdentity & {
    message: string
    warnings: string[]
    ticket: {
      key: string
      system: string
      status: string
      businessUnit: string
      typeOfIssue: string
      recurringCategory: string
      standaloneCategory: string
      summary: string
      rootCause: string
      resolution: string
      deployDate: string
      assignee?: string | null
      priority?: string | null
      ticketCreatedAt?: string | null
      resolvedAt?: string | null
    }
  }
}

// ── Statuses Jira allows right now (fills the Status dropdown) ─
export interface TransitionRequirement {
  resolutionOptions?: string[]   // Jira requires a built-in Resolution for this move
  resolutionDefault?: string
  needs?: string[]               // other required fields this app cannot fill
}
export interface TicketTransitions extends JiraIdentity {
  current: string
  /** status in Jira right now (the report holds a snapshot that may be older); null if unknown */
  live?: string | null
  allowed: string[]
  details?: Record<string, TransitionRequirement>
  queued?: Record<string, string[]>   // status -> steps the app will run one after another to get there
  error?: string
}

export async function getTicketTransitions(reportId: string, key: string): Promise<TicketTransitions> {
  const { data } = await api.get(`/api/reports/${reportId}/tickets/${key}/transitions`)
  return data as TicketTransitions
}

// ── Refresh a report from Jira (status / assignee / resolved date) ─
export interface RefreshResult {
  message: string
  refreshedAt: string
  checked: number
  updated: number
  statusChanged: number
  statusChanges: Array<{ key: string; from: string; to: string }>
  filledFields: number
  missing: string[]
}

export async function refreshReportFromJira(reportId: string): Promise<RefreshResult> {
  const { data } = await api.post(`/api/reports/${reportId}/refresh`, undefined, { timeout: 180_000 })
  return data as RefreshResult
}

// ── Help for filling Root Cause / Resolution (from earlier tickets, no AI) ─
export interface SimilarTicket {
  key: string
  summary: string
  rootCause: string
  resolution: string
  typeOfIssue: string
  status: string
  score: number
  reportName: string
}
export interface TextSuggestions { scope: 'type' | 'all'; items: Array<{ text: string; count: number }> }
export interface TicketAssist {
  similar: SimilarTicket[]
  suggestions: { typeOfIssue: string | null; rootCause: TextSuggestions; resolution: TextSuggestions }
}

export async function getTicketAssist(reportId: string, key: string, typeOfIssue?: string): Promise<TicketAssist> {
  const { data } = await api.get(`/api/reports/${reportId}/tickets/${key}/assist`, { params: typeOfIssue ? { typeOfIssue } : undefined })
  return data as TicketAssist
}

// ── Open tickets per report over time ─────────────────────────
export interface BacklogPoint { id: string; name: string; date: string; total: number; open: number; closed: number; l3: number; over14: number }

export async function getBacklog(): Promise<BacklogPoint[]> {
  const { data } = await api.get('/api/reports/backlog')
  return (data as { reports: BacklogPoint[] }).reports
}

// ── Ctrl+K: find tickets by key or summary (latest report each) ─
export interface TicketHit { key: string; summary: string; status: string; reportId: string; reportName: string; exact: boolean }
export async function searchTickets(q: string): Promise<TicketHit[]> {
  const { data } = await api.get('/api/reports/search', { params: { q } })
  return (data as { tickets: TicketHit[] }).tickets
}

// ── Saved Dashboard views ──────────────────────────────────────
export interface SavedView { id: string; name: string; query: string; shared: boolean; owner: string; mine: boolean }
export async function listViews(): Promise<SavedView[]> {
  const { data } = await api.get('/api/views')
  return (data as { views: SavedView[] }).views
}
export async function createView(name: string, query: string, shared: boolean): Promise<SavedView> {
  const { data } = await api.post('/api/views', { name, query, shared })
  return (data as { view: SavedView }).view
}
export async function deleteView(id: string): Promise<void> {
  await api.delete(`/api/views/${id}`)
}

// ── SLA: target days to resolve, per priority (admin edits) ───
export interface SlaSettings { targets: Record<string, number>; updatedBy: string | null; updatedAt: string | null; isDefault: boolean }
export async function getSla(): Promise<SlaSettings> {
  const { data } = await api.get('/api/settings/sla')
  return data as SlaSettings
}
export async function saveSla(targets: Record<string, number>): Promise<SlaSettings> {
  const { data } = await api.put('/api/settings/sla', { targets })
  return data as SlaSettings
}

// ── Per-user Jira account (Atlassian OAuth) ────────────────────
export interface JiraConnectionStatus {
  enabled: boolean
  connected: boolean
  needsReconnect: boolean
  account: { displayName: string; email: string | null; siteUrl: string } | null
  connectedAt: string | null
}

export async function getJiraConnection(): Promise<JiraConnectionStatus> {
  const { data } = await api.get('/api/jira-oauth/status')
  return data as JiraConnectionStatus
}

export async function startJiraConnection(): Promise<string> {
  const { data } = await api.post('/api/jira-oauth/start')
  return (data as { url: string }).url
}

export async function completeJiraConnection(code: string, state: string): Promise<JiraConnectionStatus & { message: string }> {
  const { data } = await api.post('/api/jira-oauth/complete', { code, state })
  return data as JiraConnectionStatus & { message: string }
}

export async function disconnectJira(): Promise<JiraConnectionStatus & { message: string }> {
  const { data } = await api.delete('/api/jira-oauth')
  return data as JiraConnectionStatus & { message: string }
}

// ── Bulk edit: many tickets at once, written back to Jira ─────
export interface BulkChanges {
  businessUnit?: string
  typeOfIssue?: string
  deployDate?: string | null // null = clear
}
export interface BulkResultItem {
  key: string
  status: 'updated' | 'skipped' | 'failed' | 'not_found'
  message?: string
  ticket?: { businessUnit: string; typeOfIssue: string; deployDate: string | null }
}
export interface BulkUpdateResponse {
  total: number
  updated: number
  skipped: number
  failed: number
  notFound: number
  results: BulkResultItem[]
}
export const BULK_MAX_TICKETS = 100

// Up to 100 Jira writes; the default 60 s client timeout could cut it off.
export async function bulkUpdateTickets(reportId: string, keys: string[], changes: BulkChanges): Promise<BulkUpdateResponse> {
  const { data } = await api.post(`/api/reports/${reportId}/bulk-update`, { keys, changes }, { timeout: 150_000 })
  return data as BulkUpdateResponse
}

// ── Audit log (admin only) ────────────────────────────────────
export interface AuditLogEntry {
  id: string
  createdAt: string
  userName: string
  userEmail: string
  userRole: string
  action: string
  reportId: string | null
  ticketKey: string | null
  summary: string
  details: {
    changes?: Record<string, { from: string; to: string }>
    warnings?: string[]
    text?: string
    batchId?: string
    error?: string
  } | null
  success: boolean
}
export interface AuditLogPage {
  items: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
}

export async function getAuditLog(params: { page?: number; action?: string; q?: string }): Promise<AuditLogPage> {
  const { data } = await api.get('/api/admin/audit', { params })
  return data as AuditLogPage
}

// ── Ticket activity: comments + changelog ─────────────────────
export interface TicketComment {
  id: string
  author: string
  body: string
  created: string
}

export interface TicketChangelogEntry {
  id: string
  author: string
  created: string
  changes: Array<{ field: string; from: string; to: string }>
}

export async function getTicketActivity(reportId: string, key: string) {
  const { data } = await api.get(`/api/reports/${reportId}/tickets/${key}/activity`)
  return data as { comments: TicketComment[]; changelog: TicketChangelogEntry[] }
}

export async function addTicketComment(reportId: string, key: string, text: string) {
  const { data } = await api.post(`/api/reports/${reportId}/tickets/${key}/comment`, { text })
  return data as { message: string; comments: TicketComment[] }
}

// ── Attachments ────────────────────────────────────────────────
export interface TicketAttachment {
  id: string
  filename: string
  size: number
  mimeType: string
  author: string
  created: string
}

export async function getTicketAttachments(reportId: string, key: string) {
  const { data } = await api.get(`/api/reports/${reportId}/tickets/${key}/attachments`)
  return data as { attachments: TicketAttachment[] }
}

// Downloads via blob so the Authorization header (attached by the axios
// interceptor) is sent — a plain <a href> would not include it.
export async function downloadTicketAttachment(reportId: string, key: string, attachment: TicketAttachment) {
  const response = await api.get(
    `/api/reports/${reportId}/tickets/${key}/attachments/${attachment.id}`,
    { responseType: 'blob' }
  )
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', attachment.filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

// Fetches attachment as a blob URL for inline preview.
// Caller must call window.URL.revokeObjectURL(url) when done to avoid memory leaks.
export async function fetchAttachmentBlobUrl(
  reportId: string,
  key: string,
  attachmentId: string
): Promise<string> {
  const response = await api.get(
    `/api/reports/${reportId}/tickets/${key}/attachments/${attachmentId}`,
    { responseType: 'blob' }
  )
  return window.URL.createObjectURL(new Blob([response.data]))
}

// Fetches attachment as plain text for txt / csv / json / xml preview.
export async function fetchAttachmentText(
  reportId: string,
  key: string,
  attachmentId: string
): Promise<string> {
  const response = await api.get(
    `/api/reports/${reportId}/tickets/${key}/attachments/${attachmentId}`,
    { responseType: 'text' }
  )
  return response.data as string
}

// ── Users & accounts ──────────────────────────────────────────
export type UserRole = 'admin' | 'editor' | 'viewer'
export type UserStatus = 'active' | 'pending' | 'disabled'

export interface AppUser {
  id: string
  email: string
  name: string
  role: UserRole
  status: UserStatus
  createdAt: string
  lastLoginAt: string | null
}

export async function listUsers(): Promise<AppUser[]> {
  const { data } = await api.get('/api/admin/users')
  return data as AppUser[]
}

export async function updateUser(
  id: string,
  patch: { role?: UserRole; status?: UserStatus; password?: string }
): Promise<AppUser> {
  const { data } = await api.patch(`/api/admin/users/${id}`, patch)
  return data as AppUser
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/api/auth/change-password', { currentPassword, newPassword })
}

// ── AI: recurring root-cause summary ──────────────────────────
export interface InsightTheme {
  title: string
  description: string
  suggestedAction: string
  ticketKeys: string[]
  count: number
}

export interface RootCauseInsight {
  id: string
  createdAt: string
  model: string
  createdBy: string | null
  ticketCount: number
  inputTokens: number | null
  outputTokens: number | null
  result: { overview: string; themes: InsightTheme[]; analysed: number; ungroupedCount: number }
}

export interface InsightStatus {
  enabled: boolean
  model: string
  dailyRemaining: number
  latest: RootCauseInsight | null
  preview: { ticketsWithText: number; uniqueEntries: number; willAnalyse: number; truncated: boolean }
}

export async function getRootCauseInsight(reportId: string): Promise<InsightStatus> {
  const { data } = await api.get(`/api/insights/${reportId}/root-cause`)
  return data as InsightStatus
}

// The AI call can take a while; the default 60 s client timeout would cut it off.
export async function generateRootCauseInsight(reportId: string): Promise<RootCauseInsight> {
  const { data } = await api.post(`/api/insights/${reportId}/root-cause`, undefined, { timeout: 100_000 })
  return data as RootCauseInsight
}

// ── Compare two reports (e.g. this week vs last week) ─────────
export interface CompareKpi {
  id: 'total' | 'closed' | 'closureRate' | 'open' | 'l3'
  label: string
  unit: 'count' | 'percent'
  base: number
  current: number
  delta: number
  deltaPct: number | null
  goodWhen: 'up' | 'down' | 'neutral'
}
export interface CompareRow { name: string; base: number; current: number; delta: number }
export interface CompareTable { id: string; label: string; rows: CompareRow[] }
export interface CompareTicketRef { key: string; summary: string; status: string; category: string }
export interface CompareStatusChange { key: string; summary: string; from: string; to: string }
export interface CompareListed<T> { total: number; items: T[] }
export interface CompareRange { from: string | null; to: string | null; withDate: number }
export interface ReportComparison {
  base: { id: string; name: string; createdAt: string }
  current: { id: string; name: string; createdAt: string }
  overlap: { both: number; onlyCurrent: number; onlyBase: number }
  kpis: CompareKpi[]
  breakdowns: CompareTable[]
  statusChanges: CompareListed<CompareStatusChange>
  newTickets: CompareListed<CompareTicketRef>
  goneTickets: CompareListed<CompareTicketRef>
  windows: { base: CompareRange; current: CompareRange }
}

export async function compareReportsApi(baseId: string, currentId: string): Promise<ReportComparison> {
  const { data } = await api.get('/api/compare', { params: { base: baseId, current: currentId } })
  return data as ReportComparison
}

export default api

// ── คู่มือ L1 (playbooks): matched to new tickets, sent as an internal Jira comment ──
export interface Playbook {
  id: string; title: string; confluenceUrl: string | null; steps: string; keywords: string
  typeOfIssue: string | null; system: string | null; enabled: boolean; autoSend: boolean
  createdBy: string; createdAt: string; updatedAt: string
}
export type PlaybookInput = Pick<Playbook, 'title' | 'confluenceUrl' | 'steps' | 'keywords' | 'typeOfIssue' | 'system' | 'enabled' | 'autoSend'>
export interface PlaybookStats { id: string; sent: number; auto: number; helpful: number; wrong: number; knownLevel: number; stayedL1: number; lastSentAt: string | null }
export interface PlaybookDelivery {
  id: string; playbookId: string; ticketKey: string; mode: 'auto' | 'manual'; score: number; sentBy: string
  feedback: 'helpful' | 'wrong' | null; feedbackBy: string | null; createdAt: string; title: string; escalation?: string | null
  pages?: Array<{ id: string; title: string; url: string }> | null
}
export interface PlaybookMatch { playbookId: string; title: string; score: number; reasons: string[]; autoSend?: boolean; confluenceUrl?: string | null }
export interface ConfluencePage { id: string; title: string; url: string; excerpt: string; space: string; score: number; matched: string[]; reasons?: string[]; checked?: boolean }
export interface ConfluenceRoot { id: string; title: string; url: string }
export interface ConfluenceSettings { autoSend: boolean; minScore: number; maxLinks: number; spaces: string[]; roots: ConfluenceRoot[]; updatedBy?: string | null }
export interface ConfluenceStatus { configured: boolean; site: string | null; settings: ConfluenceSettings }
export interface ConfluenceResult { configured: boolean; pages: ConfluencePage[]; error?: string; minScore?: number; autoSend?: boolean }
export interface PlaybookList {
  playbooks: Playbook[]; stats: PlaybookStats[]; recent: PlaybookDelivery[]; autoMinScore: number; webhookEnabled: boolean
  confluence: ConfluenceStatus & { stats: Omit<PlaybookStats, 'id' | 'lastSentAt'> }
  watch?: WatchState
}

export async function listPlaybooks(): Promise<PlaybookList> {
  const { data } = await api.get('/api/playbooks'); return data as PlaybookList
}
export async function createPlaybook(p: PlaybookInput): Promise<Playbook> {
  const { data } = await api.post('/api/playbooks', p); return data as Playbook
}
export async function updatePlaybook(id: string, p: PlaybookInput): Promise<Playbook> {
  const { data } = await api.put(`/api/playbooks/${id}`, p); return data as Playbook
}
export async function deletePlaybook(id: string): Promise<void> {
  await api.delete(`/api/playbooks/${id}`)
}
export async function testPlaybooks(t: { summary: string; description?: string; typeOfIssue?: string; system?: string }): Promise<PlaybookTestResult> {
  const { data } = await api.post('/api/playbooks/test', t); return data
}
export interface PlaybookTestResult { matches: PlaybookMatch[]; confluence: ConfluenceResult; preview: unknown; wouldAutoSend: boolean; wouldSend: 'playbook' | 'confluence' | null }
export async function getTicketPlaybooks(key: string): Promise<{ matches: PlaybookMatch[]; confluence: ConfluenceResult; sent: PlaybookDelivery[]; hasPlaybooks: boolean; setupNeeded?: string }> {
  const { data } = await api.get(`/api/playbooks/ticket/${encodeURIComponent(key)}`); return data
}
export async function sendTicketPlaybook(key: string, playbookId: string): Promise<{ deliveryId: string; title: string }> {
  const { data } = await api.post(`/api/playbooks/ticket/${encodeURIComponent(key)}/send`, { playbookId }); return data
}
export async function getPlaybookDelivery(id: string): Promise<PlaybookDelivery> {
  const { data } = await api.get(`/api/playbooks/deliveries/${encodeURIComponent(id)}`); return data as PlaybookDelivery
}
export async function setPlaybookFeedback(id: string, feedback: 'helpful' | 'wrong' | null): Promise<PlaybookDelivery> {
  const { data } = await api.patch(`/api/playbooks/deliveries/${encodeURIComponent(id)}`, { feedback }); return data as PlaybookDelivery
}
export async function sendTicketConfluence(key: string, pageId: string): Promise<{ deliveryId: string; title: string }> {
  const { data } = await api.post(`/api/playbooks/ticket/${encodeURIComponent(key)}/confluence`, { pageId }); return data
}
export async function saveConfluenceSettings(s: Omit<ConfluenceSettings, 'updatedBy' | 'roots'> & { roots: string[] }): Promise<ConfluenceStatus> {
  const { data } = await api.put('/api/playbooks/confluence/settings', s); return data as ConfluenceStatus
}
export async function checkConfluence(): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post('/api/playbooks/confluence/check'); return data
}

// ── Ticket watcher: new tickets pulled from Jira and what was decided for each ──
export interface CheckCandidate { kind: 'playbook' | 'confluence'; id: string; title: string; url: string | null; score: number; reasons: string[]; autoSend?: boolean }
export type CheckDecision = 'sent_playbook' | 'sent_confluence' | 'suggested' | 'low_confidence' | 'no_match' | 'already_sent' | 'error'
export interface TicketCheck {
  ticketKey: string; summary: string; decision: CheckDecision; decisionText: string; detail: string | null
  candidates: CheckCandidate[] | null; trigger: 'watch' | 'webhook' | 'manual'; ticketCreatedAt: string | null; checkedAt: string
  sent: Array<{ id: string; playbookId: string; title: string; mode: string; feedback: string | null; pages?: Array<{ id: string }> | null }>
}
export interface WatchState { enabled: boolean; intervalMs: number; lastRunAt: string | null; lastError: string | null; lastFound: number; lastChecked: number; running: boolean }
export async function listChecks(): Promise<{ watch: WatchState; webhookEnabled: boolean; checks: TicketCheck[]; setupNeeded?: string }> {
  const { data } = await api.get('/api/playbooks/checks'); return data
}
export async function runChecks(): Promise<{ watch: WatchState }> {
  const { data } = await api.post('/api/playbooks/checks/run'); return data
}
export async function recheckTicket(key: string): Promise<{ decision: CheckDecision; decisionText: string; detail: string }> {
  const { data } = await api.post(`/api/playbooks/checks/${encodeURIComponent(key)}/recheck`); return data
}
