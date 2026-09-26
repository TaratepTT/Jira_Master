// เพิ่มต่อจาก updateTicket() ในไฟล์ lib/api.ts (ก่อน export default api)

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
