export interface Ticket {
  key: string
  system: string
  status: string
  businessUnit: string
  typeOfIssue: string
  recurringCategory: string
  standaloneCategory: string
  summary?: string
}

export interface UploadResponse {
  reportId: string
  reportName: string
  totalTickets: number
  message: string
}

export interface UploadError {
  message: string
  code?: string
}

export type UploadStatus =
  | { state: 'idle' }
  | { state: 'dragging' }
  | { state: 'parsing'; fileName: string }
  | { state: 'uploading'; fileName: string; progress: number }
  | { state: 'success'; reportId: string; totalTickets: number }
  | { state: 'error'; message: string }
