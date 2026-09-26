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
      if (window.location.pathname !== '/login') {
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

export default api
