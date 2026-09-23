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

export default api
