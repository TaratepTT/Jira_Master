'use client'

import { useMemo } from 'react'
import type { TicketDetail } from './types'
import { pct } from './utils'

// How often each type of problem had to go beyond L1. Uses the highest level each ticket
// ever reached (from its Jira status history), not just where it is now.
export default function EscalationPanel({
  tickets, canRefresh, onRefresh, refreshing,
}: {
  tickets: TicketDetail[]
  canRefresh: boolean
  onRefresh: () => void
  refreshing: boolean
}) {
  const known = useMemo(() => tickets.filter(t => t.escalation), [tickets])
  const rows = useMemo(() => {
    const m = new Map<string, { n: number; l2: number; l3: number }>()
    for (const t of known) {
      const k = t.typeOfIssue || 'ไม่ระบุ'
      const r = m.get(k) ?? { n: 0, l2: 0, l3: 0 }
      r.n++
      if (t.escalation === 'L2' || t.escalation === 'L3') r.l2++
      if (t.escalation === 'L3') r.l3++
      m.set(k, r)
    }
    return Array.from(m.entries()).sort((a, b) => pct(b[1].l2, b[1].n) - pct(a[1].l2, a[1].n) || b[1].n - a[1].n)
  }, [known])

  const total = known.length
  const beyondL1 = known.filter(t => t.escalation !== 'L1').length
  const toL3 = known.filter(t => t.escalation === 'L3').length

  return (
    <div className="panel panel-pad">
      <h2 className="section-title">การส่งต่อจาก L1</h2>
      <p className="section-note mt-0.5">ดูว่าปัญหาประเภทไหนที่ L1 ปิดเองไม่ได้ นับระดับสูงสุดที่ ticket เคยไปถึงจากประวัติสถานะใน Jira</p>

      {total === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-line-strong p-5 text-center">
          <p className="text-[14px] text-muted">report นี้ยังไม่มีประวัติสถานะของ ticket</p>
          {canRefresh
            ? <button onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} className="btn-primary mt-3">{refreshing ? 'กำลังดึงจาก Jira...' : 'รีเฟรชจาก Jira เพื่อดึงประวัติสถานะ'}</button>
            : <p className="mt-2 text-[12px] text-faint">ให้ผู้มีสิทธิ์ editor กด "รีเฟรชจาก Jira"</p>}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-8">
            <div><p className="text-[24px] font-semibold leading-none num">{pct(total - beyondL1, total)}%</p><p className="mt-1 text-[12px] text-muted">จบที่ L1 ({total - beyondL1} ใบ)</p></div>
            <div><p className="text-[24px] font-semibold leading-none num">{pct(beyondL1, total)}%</p><p className="mt-1 text-[12px] text-muted">ส่งต่อ L2 ขึ้นไป ({beyondL1} ใบ)</p></div>
            <div><p className={`text-[24px] font-semibold leading-none num ${toL3 ? 'text-danger' : ''}`}>{pct(toL3, total)}%</p><p className="mt-1 text-[12px] text-muted">ไปถึง L3 ({toL3} ใบ)</p></div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="py-1.5 pr-3 font-medium">Type of Issue</th>
                  <th className="py-1.5 px-2 text-right font-medium">ticket</th>
                  <th className="py-1.5 px-2 font-medium">ส่งต่อ L2 ขึ้นไป</th>
                  <th className="py-1.5 pl-2 text-right font-medium">ถึง L3</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([type, r]) => (
                  <tr key={type} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3">{type}</td>
                    <td className="py-2 px-2 text-right num">{r.n}</td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <span className="block h-1.5 w-28 rounded-full bg-sunken">
                          <span className="block h-1.5 rounded-full bg-chart-b" style={{ width: `${pct(r.l2, r.n)}%` }} />
                        </span>
                        <span className="num">{pct(r.l2, r.n)}%</span>
                        <span className="text-faint num">({r.l2})</span>
                      </div>
                    </td>
                    <td className={`py-2 pl-2 text-right num ${r.l3 ? 'text-danger' : 'text-faint'}`}>{r.l3}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total < tickets.length && <p className="mt-2 text-[12px] text-faint">มี {tickets.length - total} ticket ที่ยังไม่มีประวัติสถานะ กด &quot;รีเฟรชจาก Jira&quot; เพื่อดึงเพิ่ม</p>}
        </>
      )}
    </div>
  )
}
