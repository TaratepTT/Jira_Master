// Shared types for the report dashboard (/dashboard/[id]) and its summary page.

export interface FreqRow { rank: number; category: string; count: number; pct: string; keys: string[] }
export interface BuTop { name: string; count: number }
export interface L3Ticket { key: string; bu: string; status: string; summary?: string }

export interface TicketDetail {
  key: string
  system: string
  status: string
  businessUnit: string
  typeOfIssue: string
  recurringCategory: string
  standaloneCategory: string
  summary?: string
  rootCause?: string
  resolution?: string
  deployDate?: string
  assignee?: string | null
  priority?: string | null
  ticketCreatedAt?: string | null
  /** Jira "resolutiondate" — null for tickets not resolved yet (or reports synced before this field existed) */
  resolvedAt?: string | null
  /** highest support level reached: 'L1' | 'L2' | 'L3' (null = not known yet, refresh from Jira) */
  escalation?: string | null
}

export interface Aggregations {
  systemCount: Record<string, number>
  statusCount: Record<string, number>
  buCount: Record<string, number>
  issueTypeCount: Record<string, number>
  frequencyTable: FreqRow[]
  top5Bu: BuTop[]
  top3Cat: FreqRow[]
  l3Tickets: L3Ticket[]
  topAssignees: Array<{ name: string; count: number }>
  priorityCount: Record<string, number>
}

export interface ReportData {
  id: string
  name: string
  totalTickets: number
  createdAt: string
  /** last "รีเฟรชจาก Jira" (null = never) */
  refreshedAt?: string | null
  tickets: TicketDetail[]
  aggregations: Aggregations
}

export type SortKey = 'key' | 'summary' | 'businessUnit' | 'status' | 'typeOfIssue' | 'rootCause' | 'resolution' | 'deployDate'
export type SortDir = 'asc' | 'desc'
