import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { RawTicketRow, Ticket, ParsedReport } from '../types/index.js'

const COL_MAP: Record<keyof Ticket, string[]> = {
  key:               ['key', 'issue key', 'id', 'ticket id', 'issue id'],
  system:            ['issue type', 'system', 'project', 'component'],
  status:            ['status', 'state'],
  businessUnit:      ['business unit', 'bu', 'customer', 'organization', 'team'],
  typeOfIssue:       ['type of issue', 'ticket type'],
  recurringCategory: ['issue category', 'recurring issue category', 'recurring category', 'sub category'],
  standaloneCategory:['type of system', 'standalone category', 'standalone sub category'],
  summary:           ['summary', 'title', 'description', 'subject'],
}

function getCol(row: RawTicketRow, aliases: string[]): string {
  for (const alias of aliases) {
    const key = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === alias.toLowerCase()
    )
    if (key) return (row[key] ?? '').trim()
  }
  return ''
}

function normaliseSystem(raw: string): string {
  if (!raw) return ''
  const u = raw.toUpperCase()
  if (u.includes('CMP')) return 'CMP'
  if (u.includes('VMP')) return 'VMP'
  if (u.includes('TMS')) return 'CP TMS'
  return raw.trim()
}

function rowToTicket(row: RawTicketRow, idx: number): Ticket {
  return {
    key:                getCol(row, COL_MAP.key) || `TICKET-${idx + 1}`,
    system:             normaliseSystem(getCol(row, COL_MAP.system)),
    status:             getCol(row, COL_MAP.status),
    businessUnit:       getCol(row, COL_MAP.businessUnit),
    typeOfIssue:        getCol(row, COL_MAP.typeOfIssue),
    recurringCategory:  getCol(row, COL_MAP.recurringCategory),
    standaloneCategory: getCol(row, COL_MAP.standaloneCategory),
    summary:            getCol(row, COL_MAP.summary),
  }
}

function parseCSVBuffer(buf: Buffer): RawTicketRow[] {
  const result = Papa.parse<RawTicketRow>(buf.toString('utf-8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })
  return result.data
}

function findHeaderRow(ws: XLSX.WorkSheet): number {
  // Scan first 10 rows to find the one containing 'Key' or 'Issue Key'
  const KEY_VARIANTS = ['key', 'issue key']
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 20; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr]
      if (cell && KEY_VARIANTS.includes(String(cell.v ?? '').trim().toLowerCase())) {
        return r // 0-based row index of the header
      }
    }
  }
  return 0 // fallback: first row
}

function parseExcelBuffer(buf: Buffer): RawTicketRow[] {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]

  const headerRow = findHeaderRow(ws)

  // Re-read sheet starting from the found header row
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  range.s.r = headerRow
  const trimmedRef = XLSX.utils.encode_range(range)

  return XLSX.utils.sheet_to_json<RawTicketRow>(ws, {
    defval: '',
    raw: false,
    range: trimmedRef,
  })
}

export function parseFile(
  buf: Buffer,
  mimetype: string,
  filename: string
): ParsedReport {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  let rows: RawTicketRow[]
  if (ext === 'csv' || mimetype === 'text/csv') {
    rows = parseCSVBuffer(buf)
  } else if (['xlsx', 'xls'].includes(ext)) {
    rows = parseExcelBuffer(buf)
  } else {
    throw new Error(`ไม่รองรับไฟล์ประเภท .${ext} — ใช้ .csv, .xlsx หรือ .xls`)
  }

  if (!rows.length) throw new Error('ไม่พบข้อมูลในไฟล์')

  const validRows = rows.filter((r) => getCol(r, COL_MAP.key).length > 0)

  if (!validRows.length) throw new Error('ไม่พบข้อมูล ticket ในไฟล์')

  const tickets = validRows.map((r, i) => rowToTicket(r, i))

  return { tickets, totalTickets: tickets.length }
}
