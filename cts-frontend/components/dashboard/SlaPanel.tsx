'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSla, saveSla, type SlaSettings } from '@/lib/api'
import type { TicketDetail } from './types'
import { daysBetween, fmtDays, isFinishedStatus, parseDate, pct } from './utils'

// Target days to resolve per priority (admin sets them). For resolved tickets: did they make it?
// For open tickets: which are already over target, and which are close (75% or more used).
const NEAR = 0.75
const NO_PRIORITY = 'ไม่ระบุ'

export default function SlaPanel({
  tickets, asOf, isAdmin, onOpenTicket,
}: {
  tickets: TicketDetail[]
  asOf: Date
  isAdmin: boolean
  onOpenTicket: (key: string) => void
}) {
  const [sla, setSla] = useState<SlaSettings | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { getSla().then(setSla).catch(() => setSla(null)) }, [])

  const priorities = useMemo(() => {
    const set = new Set<string>(Object.keys(sla?.targets ?? {}))
    tickets.forEach(t => set.add(t.priority || NO_PRIORITY))
    return Array.from(set)
  }, [tickets, sla])

  const stats = useMemo(() => {
    const targets = sla?.targets ?? {}
    const per = new Map<string, { resolved: number; met: number; open: number; over: number }>()
    const watch: Array<{ t: TicketDetail; days: number; target: number; over: boolean }> = []
    for (const t of tickets) {
      const p = t.priority || NO_PRIORITY
      const target = targets[p]
      const row = per.get(p) ?? { resolved: 0, met: 0, open: 0, over: 0 }
      per.set(p, row)
      if (!target) continue
      const c = parseDate(t.ticketCreatedAt)
      if (!c) continue
      const r = parseDate(t.resolvedAt)
      if (r) {
        row.resolved++
        if ((r.getTime() - c.getTime()) / 864e5 <= target) row.met++
      } else if (!isFinishedStatus(t.status)) {
        row.open++
        const days = daysBetween(c, asOf)
        if (days > target) { row.over++; watch.push({ t, days, target, over: true }) }
        else if (days >= target * NEAR) watch.push({ t, days, target, over: false })
      }
    }
    watch.sort((a, b) => Number(b.over) - Number(a.over) || b.days / b.target - a.days / a.target)
    const resolved = Array.from(per.values()).reduce((s, r) => s + r.resolved, 0)
    const met = Array.from(per.values()).reduce((s, r) => s + r.met, 0)
    return { per, watch, resolved, met, over: watch.filter(w => w.over).length, near: watch.filter(w => !w.over).length }
  }, [tickets, sla, asOf])

  const startEdit = () => {
    setDraft(Object.fromEntries(priorities.filter(p => p !== NO_PRIORITY).map(p => [p, String(sla?.targets[p] ?? '')])))
    setError('')
    setEditing(true)
  }
  const save = async () => {
    const targets: Record<string, number> = {}
    for (const [p, v] of Object.entries(draft)) if (v.trim()) targets[p] = Number(v)
    setSaving(true); setError('')
    try {
      setSla(await saveSla(targets))
      setEditing(false)
    } catch (e: unknown) {
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  if (!sla) return null

  return (
    <div className="panel panel-pad">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">เป้าเวลาแก้ไข (SLA)</h2>
          <p className="section-note mt-0.5">
            นับจากวันสร้างถึงวันที่ resolve ใน Jira
            {sla.isDefault ? ', ตอนนี้ใช้ค่าเริ่มต้น' : sla.updatedBy ? `, ตั้งโดย ${sla.updatedBy}` : ''}
          </p>
        </div>
        {isAdmin && !editing && <button onClick={startEdit} className="btn">แก้เป้าเวลา</button>}
      </div>

      {editing && (
        <div className="mt-4 rounded-md border border-line bg-sunken p-3">
          <p className="mb-2 text-[13px] text-muted">จำนวนวันที่ควรแก้เสร็จ เว้นว่าง = ไม่มีเป้า</p>
          <div className="flex flex-wrap gap-3">
            {Object.keys(draft).map(p => (
              <label key={p} className="flex flex-col text-[12px] text-muted">
                {p}
                <input
                  type="number" min={0.5} step={0.5} max={365}
                  value={draft[p]}
                  onChange={e => setDraft(d => ({ ...d, [p]: e.target.value }))}
                  className="field mt-1 w-24"
                />
              </label>
            ))}
          </div>
          {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={save} disabled={saving} aria-busy={saving} className="btn-primary">{saving ? 'กำลังบันทึก...' : 'บันทึกเป้าเวลา'}</button>
            <button onClick={() => setEditing(false)} className="btn-quiet">ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-8">
        <div>
          <p className="text-[24px] font-semibold leading-none num">{stats.resolved ? `${pct(stats.met, stats.resolved)}%` : '—'}</p>
          <p className="mt-1 text-[12px] text-muted">แก้ทันเป้า ({stats.met} จาก {stats.resolved} ที่ resolve แล้ว)</p>
        </div>
        <div>
          <p className={`text-[24px] font-semibold leading-none num ${stats.over ? 'text-danger' : ''}`}>{stats.over}</p>
          <p className="mt-1 text-[12px] text-muted">ยังเปิดและเกินเป้าแล้ว</p>
        </div>
        <div>
          <p className={`text-[24px] font-semibold leading-none num ${stats.near ? 'text-attention' : ''}`}>{stats.near}</p>
          <p className="mt-1 text-[12px] text-muted">ใกล้เกินเป้า (ใช้ไปแล้ว 75% ขึ้นไป)</p>
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <table className="w-full self-start text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="py-1.5 pr-2 font-medium">Priority</th>
              <th className="py-1.5 px-2 text-right font-medium">เป้า</th>
              <th className="py-1.5 px-2 text-right font-medium">ทันเป้า</th>
              <th className="py-1.5 pl-2 text-right font-medium">เปิดและเกินเป้า</th>
            </tr>
          </thead>
          <tbody>
            {priorities.map(p => {
              const r = stats.per.get(p)
              const target = sla.targets[p]
              return (
                <tr key={p} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-2">{p}</td>
                  <td className="py-2 px-2 text-right num">{target ? fmtDays(target) : <span className="text-faint">ไม่มีเป้า</span>}</td>
                  <td className="py-2 px-2 text-right num">{target && r?.resolved ? `${pct(r.met, r.resolved)}% (${r.met}/${r.resolved})` : <span className="text-faint">—</span>}</td>
                  <td className={`py-2 pl-2 text-right num ${r?.over ? 'text-danger' : 'text-faint'}`}>{target ? r?.over ?? 0 : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div>
          <p className="mb-2 text-[13px] font-semibold">ต้องรีบดู</p>
          {stats.watch.length === 0 ? (
            <p className="text-[13px] text-muted">ไม่มี ticket ที่เกินหรือใกล้เกินเป้า</p>
          ) : (
            <ul className="divide-y divide-line">
              {stats.watch.slice(0, 8).map(w => (
                <li key={w.t.key}>
                  <button onClick={() => onOpenTicket(w.t.key)} className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-3 rounded px-1.5 py-2 text-left hover:bg-sunken">
                    <span className={`w-16 shrink-0 text-right text-[13px] font-semibold num ${w.over ? 'text-danger' : 'text-attention'}`}>{w.days}/{w.target} วัน</span>
                    <span className="min-w-0 flex-1">
                      <span className="key block text-[12px] text-accent">{w.t.key}</span>
                      <span className="block truncate text-[13px] text-ink">{w.t.summary || '—'}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">{w.t.priority || NO_PRIORITY}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
