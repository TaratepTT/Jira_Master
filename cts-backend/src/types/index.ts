export interface RawTicketRow {
  [key: string]: string
}

export interface Ticket {
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

export interface ParsedReport {
  tickets: Ticket[]
  totalTickets: number
}
