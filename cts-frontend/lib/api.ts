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
export interface TicketUpdateInput {
  businessUnit?: string
  typeOfIssue?: string
  rootCause?: string
  resolution?: string
  deployDate?: string | null // "YYYY-MM-DD"; '' or null = clear
  transitionResolution?: string // Jira's built-in Resolution, when the status change requires one
  status?: string
}

export async function updateTicket(reportId: string, key: string, input: TicketUpdateInput) {
  const { data } = await api.patch(`/api/reports/${reportId}/tickets/${key}`, input)
  return data as {
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
    }
  }
}

// ── Statuses Jira allows right now (fills the Status dropdown) ─
export interface TransitionRequirement {
  resolutionOptions?: string[]   // Jira requires a built-in Resolution for this move
  resolutionDefault?: string
  needs?: string[]               // other required fields this app cannot fill
}
export interface TicketTransitions {
  current: string
  allowed: string[]
  details?: Record<string, TransitionRequirement>
  error?: string
}

export async function getTicketTransitions(reportId: string, key: string): Promise<TicketTransitions> {
  const { data } = await api.get(`/api/reports/${reportId}/tickets/${key}/transitions`)
  return data as TicketTransitions
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
