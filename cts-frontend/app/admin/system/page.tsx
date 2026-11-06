'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import AppShell, { PageHeader } from '@/components/layout/AppShell'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import Spinner from '@/components/ui/Spinner'
import { useAuth } from '@/components/auth/AuthContext'
import { useDialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import {
  getSystemStatus, saveTokenExpiry, sendTestAlert, listBackups, createBackup, downloadBackup, listBackupReports,
  restoreReportFromBackup, restorePlaybooksFromBackup, listTrash, restoreFromTrash, purgeFromTrash,
  type SystemStatus, type SysCheck, type BackupInfo, type BackupReport, type TrashItem,
} from '@/lib/api'

type SysTab = 'status' | 'backups' | 'trash'

const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
const ago = (iso: string | null | undefined) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'เมื่อสักครู่'
  if (m < 60) return `${m} นาทีก่อน`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} ชั่วโมงก่อน` : `${Math.round(h / 24)} วันก่อน`
}
const size = (b: number) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`
const uptime = (s: number) => s < 3600 ? `${Math.round(s / 60)} นาที` : s < 172800 ? `${Math.round(s / 3600)} ชั่วโมง` : `${Math.round(s / 86400)} วัน`

const SOURCE_LABEL: Record<string, string> = { jira: 'ดึง ticket จาก Jira', confluence: 'ค้น Confluence', backup: 'สำรองข้อมูล', keepawake: 'กัน server หลับ', token: 'Token', test: 'ทดสอบ' }

// ── Status ────────────────────────────────────────────────────
function Dot({ ok }: { ok: boolean | null }) {
  const cls = ok === null ? 'bg-faint' : ok ? 'bg-ok' : 'bg-danger'
  return <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />
}

function CheckRow({ label, c, extra }: { label: string; c: SysCheck; extra?: string }) {
  const state = c.ok === null ? 'ไม่ได้ใช้' : c.ok ? 'ปกติ' : 'มีปัญหา'
  return (
    <li className="flex gap-3 px-4 py-3" data-testid={`check-${label}`}>
      <Dot ok={c.ok} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[14px]">
          <span className="font-medium text-ink">{label}</span>
          <span className={`text-[12px] ${c.ok === false ? 'text-danger' : 'text-muted'}`}>{state}</span>
        </p>
        <p className="break-words text-[13px] text-muted">{c.message}{extra ? ` · ${extra}` : ''}</p>
      </div>
      {typeof c.ms === 'number' && <span className="shrink-0 text-[12px] text-faint num">{c.ms} ms</span>}
    </li>
  )
}

function TokenRow({ label, value, days, onChange }: { label: string; value: string; days: number | null; onChange: (v: string) => void }) {
  const tone = days === null ? 'text-muted' : days <= 7 ? 'text-danger' : days <= 30 ? 'text-attention' : 'text-muted'
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="w-40 text-[13.5px] text-ink" htmlFor={`tok-${label}`}>{label}</label>
      <input id={`tok-${label}`} type="date" value={value} onChange={e => onChange(e.target.value)} className="field w-44" />
      <span className={`text-[13px] ${tone}`} data-testid={`days-${label}`}>
        {days === null ? 'ยังไม่ได้ระบุ' : days < 0 ? `หมดอายุแล้ว ${-days} วัน` : `เหลือ ${days} วัน`}
      </span>
    </div>
  )
}

function StatusPanel() {
  const [s, setS] = useState<SystemStatus | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [tok, setTok] = useState({ jira: '', confluence: '' })
  const [savingTok, setSavingTok] = useState(false)
  const [testing, setTesting] = useState(false)
  const toast = useToast()
  const { notify } = useDialog()

  const apply = (d: SystemStatus) => { setS(d); setTok({ jira: d.tokens.jira ?? '', confluence: d.tokens.confluence ?? '' }) }
  const load = useCallback(async (fresh = false) => {
    if (fresh) setChecking(true)
    try { apply(await getSystemStatus(fresh)); setError('') } catch (e) { setError(errMsg(e, 'โหลดสถานะระบบไม่ได้')) } finally { setChecking(false) }
  }, [])
  useEffect(() => { void load(true) }, [load])
  useEffect(() => { const t = setInterval(() => { void load() }, 30_000); return () => clearInterval(t) }, [load])

  const saveTok = async () => {
    setSavingTok(true)
    try { apply(await saveTokenExpiry({ jira: tok.jira || null, confluence: tok.confluence || null })); toast.show({ text: 'บันทึกวันหมดอายุ token แล้ว', tone: 'ok' }) }
    catch (e) { await notify({ title: 'บันทึกไม่สำเร็จ', message: errMsg(e, 'ลองใหม่อีกครั้ง'), tone: 'danger' }) }
    finally { setSavingTok(false) }
  }
  const test = async () => {
    setTesting(true)
    try {
      const r = await sendTestAlert()
      if (r.ok) toast.show({ text: 'ส่งข้อความทดสอบแล้ว ดูใน Teams หรือ Slack', tone: 'ok' })
      else await notify({ title: 'ส่งข้อความทดสอบไม่ได้', message: r.message, tone: 'danger' })
      void load()
    } catch (e) { await notify({ title: 'ส่งข้อความทดสอบไม่ได้', message: errMsg(e, 'ลองใหม่อีกครั้ง'), tone: 'danger' }) }
    finally { setTesting(false) }
  }

  if (error && !s) return <div className="panel"><EmptyState title="โหลดสถานะระบบไม่ได้" text={error} action={<button className="btn" onClick={() => load(true)}>ลองใหม่</button>} /></div>
  if (!s) return <div className="panel flex items-center gap-2 px-4 py-6 text-[13px] text-muted"><Spinner /> กำลังตรวจทุกส่วนของระบบ</div>

  const c = s.checks
  const allOk = !s.problems.length && [c.db, c.jira, c.confluence, c.watcher, c.keepAwake, c.backup].every(x => x.ok !== false)
  return (
    <div className="space-y-6">
      <div className={`panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${allOk ? '' : 'border-danger/40 bg-danger-soft'}`} data-testid="system-summary">
        <div className="min-w-0">
          <p className={`text-[15px] font-semibold ${allOk ? 'text-ink' : 'text-danger'}`}>{allOk ? 'ทุกส่วนทำงานปกติ' : 'มีบางส่วนที่ต้องดู'}</p>
          {s.problems.map(p => (
            <p key={p.source} className="text-[13px] text-ink">
              {SOURCE_LABEL[p.source] ?? p.source}: {p.lastError} <span className="text-muted">({p.source === 'token' ? 'ตั้งวันใหม่ด้านล่างเมื่อสร้าง token ใหม่แล้ว' : `ผิดพลาด ${p.failures} ครั้ง ตั้งแต่ ${fmt(p.since)}`}{p.notified ? ', แจ้งเตือนแล้ว' : ''})</span>
            </p>
          ))}
        </div>
        <button className="btn" onClick={() => load(true)} disabled={checking} aria-busy={checking}>{checking ? 'กำลังตรวจ...' : 'ตรวจอีกครั้ง'}</button>
      </div>

      <section aria-labelledby="sys-checks">
        <h2 id="sys-checks" className="section-title mb-2">ส่วนต่างๆ ของระบบ</h2>
        <ul className="panel divide-y divide-line">
          <CheckRow label="ฐานข้อมูล" c={c.db} />
          <CheckRow label="Jira" c={c.jira} />
          <CheckRow label="Confluence" c={c.confluence} />
          <CheckRow label="ตัวดึง ticket" c={c.watcher} extra={c.watcher.lastRunAt ? `รอบล่าสุด ${ago(c.watcher.lastRunAt)}` : undefined} />
          <CheckRow label="กัน server หลับ" c={c.keepAwake} extra={c.keepAwake.lastAt ? `ปลุกล่าสุด ${ago(c.keepAwake.lastAt)}` : undefined} />
          <CheckRow label="สำรองข้อมูล" c={{ ...c.backup, message: c.backup.lastAt ? `ล่าสุด ${fmt(c.backup.lastAt)}` : c.backup.message }} />
          <CheckRow label="การแจ้งเตือน" c={c.alerts} />
          <CheckRow label="AI ช่วยตรวจ" c={c.ai} />
        </ul>
        <p className="mt-2 text-[12px] text-faint num">เวอร์ชัน {s.version} · ทำงานมา {uptime(s.uptimeSec)} · ใช้หน่วยความจำ {s.memoryMb} MB</p>
      </section>

      <section aria-labelledby="sys-tokens" className="panel panel-pad">
        <h2 id="sys-tokens" className="section-title">วันหมดอายุ API token</h2>
        <p className="section-note mt-0.5 mb-4">ระบบไม่เก็บ token แค่จำวันที่ที่คุณกรอก แล้วแจ้งเตือนล่วงหน้า 7 วัน ดูวันหมดอายุได้ที่หน้า API tokens ของ Atlassian</p>
        <div className="space-y-3">
          <TokenRow label="Jira" value={tok.jira} days={s.tokens.jiraDaysLeft} onChange={v => setTok(t => ({ ...t, jira: v }))} />
          <TokenRow label="Confluence" value={tok.confluence} days={s.tokens.confluenceDaysLeft} onChange={v => setTok(t => ({ ...t, confluence: v }))} />
        </div>
        <button className="btn-primary mt-4" onClick={saveTok} disabled={savingTok} aria-busy={savingTok}>{savingTok ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </section>

      <section aria-labelledby="sys-alerts" className="panel panel-pad">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="sys-alerts" className="section-title">การแจ้งเตือน</h2>
            <p className="section-note mt-0.5">ส่งเข้า Teams หรือ Slack เมื่อดึง ticket ไม่ได้ 3 รอบติด, Jira ปฏิเสธ token, สำรองข้อมูลไม่สำเร็จ หรือ token ใกล้หมดอายุ และแจ้งอีกครั้งเมื่อกลับมาปกติ</p>
          </div>
          <button className="btn" onClick={test} disabled={testing || c.alerts.ok === null} aria-busy={testing} title={c.alerts.ok === null ? 'ตั้ง ALERT_WEBHOOK_URL บน Render ก่อน' : undefined}>{testing ? 'กำลังส่ง...' : 'ส่งข้อความทดสอบ'}</button>
        </div>
        {!s.alertHistory.length ? (
          <p className="mt-4 text-[13px] text-faint">ยังไม่มีการแจ้งเตือนตั้งแต่ server เริ่มทำงาน</p>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-md border border-line" data-testid="alert-history">
            {s.alertHistory.map((a, i) => (
              <li key={i} className="flex gap-3 px-3 py-2 text-[13px]">
                <Dot ok={a.ok} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-ink">{a.text}</p>
                  <p className="text-[12px] text-muted">{fmt(a.at)} · {SOURCE_LABEL[a.source] ?? a.source}{a.delivered ? '' : ' · ส่งไม่ถึง (ยังไม่ได้ตั้ง webhook หรือ webhook ผิด)'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ── Backups ───────────────────────────────────────────────────
function BackupReports({ b, onRestored }: { b: BackupInfo; onRestored: () => void }) {
  const [rows, setRows] = useState<BackupReport[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const { confirm, notify } = useDialog()
  const load = useCallback(async () => { try { setRows(await listBackupReports(b.id)) } catch { setRows([]) } }, [b.id])
  useEffect(() => { void load() }, [load])

  const restore = async (r: BackupReport) => {
    if (!(await confirm({ title: 'กู้คืน report นี้?', message: `ข้อมูลจะกลับมาตามที่เป็นเมื่อ ${fmt(b.createdAt)} รวมการแก้ไขและบทสรุป AI ที่มีตอนนั้น`, detail: <><span className="font-medium">{r.name}</span><span className="text-muted"> · {r.tickets} ticket</span></>, confirmLabel: 'กู้คืน' }))) return
    setBusy(r.id)
    try { await restoreReportFromBackup(b.id, r.id); toast.show({ text: `กู้คืน "${r.name}" แล้ว`, tone: 'ok', action: { label: 'เปิด', onClick: () => { window.location.href = `/dashboard/${r.id}` } } }); await load(); onRestored() }
    catch (e) { await notify({ title: 'กู้คืนไม่สำเร็จ', message: errMsg(e, 'ลองใหม่อีกครั้ง'), tone: 'danger' }) }
    finally { setBusy(null) }
  }
  const restorePb = async () => {
    setBusy('pb')
    try { const r = await restorePlaybooksFromBackup(b.id); toast.show({ text: r.restored ? `กู้คืนคู่มือ ${r.restored} รายการ` : 'คู่มือในข้อมูลสำรองนี้ยังอยู่ครบ ไม่ต้องกู้', tone: r.restored ? 'ok' : 'info' }) }
    catch (e) { await notify({ title: 'กู้คืนคู่มือไม่สำเร็จ', message: errMsg(e, 'ลองใหม่อีกครั้ง'), tone: 'danger' }) }
    finally { setBusy(null) }
  }

  if (!rows) return <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-muted"><Spinner /> กำลังเปิดข้อมูลสำรอง</div>
  const missing = rows.filter(r => !r.exists).length
  return (
    <div className="border-t border-line bg-sunken/50 px-4 py-3" data-testid="backup-reports">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">{rows.length} report ในข้อมูลสำรองนี้{missing ? `, ${missing} รายการไม่มีในระบบแล้ว` : ', ทุกรายการยังอยู่ในระบบ'}</p>
        <button className="btn-quiet" onClick={restorePb} disabled={busy !== null} aria-busy={busy === 'pb'}>{busy === 'pb' ? 'กำลังกู้...' : 'กู้คืนคู่มือที่หายไป'}</button>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line bg-surface">
        {rows.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
            <span className="text-muted num">{r.tickets} ticket</span>
            {r.exists
              ? <span className="chip border-transparent bg-sunken text-muted">ยังอยู่ในระบบ</span>
              : <button className="btn" onClick={() => restore(r)} disabled={busy !== null} aria-busy={busy === r.id}>{busy === r.id ? 'กำลังกู้...' : 'กู้คืน'}</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function BackupsPanel() {
  const [rows, setRows] = useState<BackupInfo[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const toast = useToast()
  const { notify } = useDialog()
  const load = useCallback(async () => { try { setRows(await listBackups()); setError('') } catch (e) { setError(errMsg(e, 'โหลดรายการข้อมูลสำรองไม่ได้')) } }, [])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    setCreating(true)
    try { const b = await createBackup(); toast.show({ text: `สำรองข้อมูลแล้ว (${b.counts.reports} report, ${size(b.size)})`, tone: 'ok' }); await load() }
    catch (e) { await notify({ title: 'สำรองข้อมูลไม่สำเร็จ', message: errMsg(e, 'ลองใหม่อีกครั้ง'), tone: 'danger' }) }
    finally { setCreating(false) }
  }
  const download = async (b: BackupInfo) => {
    setDownloading(b.id)
    try { await downloadBackup(b) } catch { await notify({ title: 'ดาวน์โหลดไม่สำเร็จ', message: 'ลองใหม่อีกครั้ง', tone: 'danger' }) } finally { setDownloading(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[44rem] text-[13.5px] leading-relaxed text-muted">
          ระบบสำรองข้อมูลของแอปเองทุก 7 วัน เก็บไว้ 8 ชุดล่าสุด ได้แก่ report พร้อมการแก้ไขและบทสรุป AI, คู่มือ, ประวัติการส่งคู่มือ, การตั้งค่า, รายชื่อผู้ใช้ และประวัติการใช้งาน
          ไม่เก็บรหัสผ่านและ token ใดๆ ดาวน์โหลดเก็บไว้นอกระบบได้เป็นไฟล์ .json.gz
        </p>
        <button className="btn-primary" onClick={create} disabled={creating} aria-busy={creating}>{creating ? 'กำลังสำรอง...' : 'สำรองข้อมูลตอนนี้'}</button>
      </div>
      {error ? (
        <div className="panel"><EmptyState title="โหลดรายการไม่ได้" text={error} action={<button className="btn" onClick={load}>ลองใหม่</button>} /></div>
      ) : !rows ? (
        <div className="panel flex items-center gap-2 px-4 py-6 text-[13px] text-muted"><Spinner /> กำลังโหลด</div>
      ) : !rows.length ? (
        <div className="panel"><EmptyState title="ยังไม่มีข้อมูลสำรอง" text="ชุดแรกจะถูกสร้างเองภายในไม่กี่นาทีหลัง server เริ่มทำงาน หรือกดสำรองข้อมูลตอนนี้" /></div>
      ) : (
        <ul className="panel divide-y divide-line" data-testid="backup-list">
          {rows.map(b => (
            <li key={b.id}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <p className="flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="font-medium text-ink num">{fmt(b.createdAt)}</span>
                    <span className="chip border-transparent bg-sunken text-muted">{b.kind === 'auto' ? 'อัตโนมัติ' : `สร้างโดย ${b.createdBy}`}</span>
                  </p>
                  <p className="text-[13px] text-muted num">{b.counts.reports} report · {b.counts.tickets.toLocaleString()} ticket · {b.counts.playbooks} คู่มือ · {b.counts.users} ผู้ใช้ · {size(b.size)}</p>
                </div>
                <button className="btn-quiet" onClick={() => setOpen(o => o === b.id ? null : b.id)} aria-expanded={open === b.id}>{open === b.id ? 'ซ่อน' : 'กู้คืนจากชุดนี้'}</button>
                <button className="btn-quiet" onClick={() => download(b)} disabled={downloading === b.id} aria-busy={downloading === b.id}>{downloading === b.id ? 'กำลังโหลด...' : 'ดาวน์โหลด'}</button>
              </div>
              {open === b.id && <BackupReports b={b} onRestored={() => {}} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Trash ─────────────────────────────────────────────────────
function TrashPanel() {
  const [data, setData] = useState<{ keepDays: number; items: TrashItem[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const { confirm, notify } = useDialog()
  const load = useCallback(async () => { try { setData(await listTrash()); setError('') } catch (e) { setError(errMsg(e, 'โหลดถังขยะไม่ได้')) } }, [])
  useEffect(() => { void load() }, [load])

  const restore = async (t: TrashItem) => {
    setBusy(t.id)
    try { await restoreFromTrash(t.id); toast.show({ text: `กู้คืน "${t.name}" แล้ว`, tone: 'ok', action: { label: 'เปิด', onClick: () => { window.location.href = `/dashboard/${t.id}` } } }); await load() }
    catch (e) { await notify({ title: 'กู้คืนไม่สำเร็จ', message: errMsg(e, 'ลองใหม่อีกครั้ง'), tone: 'danger' }) }
    finally { setBusy(null) }
  }
  const purge = async (t: TrashItem) => {
    if (!(await confirm({ title: 'ลบถาวร?', message: 'ลบออกจากถังขยะแล้วกู้จากที่นี่ไม่ได้อีก (ถ้ามีข้อมูลสำรองที่ทำไว้ก่อนลบ ยังกู้จากแท็บสำรองข้อมูลได้)', detail: <><span className="font-medium">{t.name}</span><span className="text-muted"> · {t.totalTickets} ticket</span></>, confirmLabel: 'ลบถาวร', tone: 'danger' }))) return
    setBusy(t.id)
    try { await purgeFromTrash(t.id); toast.show({ text: `ลบ "${t.name}" ถาวรแล้ว` }); await load() }
    catch (e) { await notify({ title: 'ลบไม่สำเร็จ', message: errMsg(e, 'ลองใหม่อีกครั้ง'), tone: 'danger' }) }
    finally { setBusy(null) }
  }

  if (error) return <div className="panel"><EmptyState title="โหลดถังขยะไม่ได้" text={error} action={<button className="btn" onClick={load}>ลองใหม่</button>} /></div>
  if (!data) return <div className="panel flex items-center gap-2 px-4 py-6 text-[13px] text-muted"><Spinner /> กำลังโหลด</div>
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] text-muted">report ที่ถูกลบจะอยู่ที่นี่ {data.keepDays} วัน กู้คืนได้ครบทั้ง ticket การแก้ไข และบทสรุป AI จากนั้นระบบลบให้เอง</p>
      {!data.items.length ? (
        <div className="panel"><EmptyState title="ถังขยะว่าง" text="ยังไม่มี report ที่ถูกลบในช่วงนี้" action={<Link href="/" className="btn">ไปหน้ารายงาน</Link>} /></div>
      ) : (
        <ul className="panel divide-y divide-line" data-testid="trash-list">
          {data.items.map(t => {
            const left = Math.max(0, Math.ceil((new Date(t.purgeAt).getTime() - Date.now()) / 86_400_000))
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <p className="truncate text-[14px] font-medium text-ink">{t.name}</p>
                  <p className="text-[13px] text-muted num">{t.totalTickets.toLocaleString()} ticket · ลบโดย {t.deletedBy} เมื่อ {fmt(t.deletedAt)} · <span className={left <= 3 ? 'text-attention' : ''}>ลบถาวรใน {left} วัน ({fmtDate(t.purgeAt)})</span></p>
                </div>
                <button className="btn" onClick={() => restore(t)} disabled={busy !== null} aria-busy={busy === t.id}>{busy === t.id ? 'กำลังทำ...' : 'กู้คืน'}</button>
                <button className="btn-quiet hover:bg-danger-soft hover:text-danger" onClick={() => purge(t)} disabled={busy !== null} aria-label={`ลบถาวร ${t.name}`}>ลบถาวร</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SystemInner() {
  const { isAdmin, isChecking } = useAuth()
  const params = useSearchParams()
  const router = useRouter()
  const p = params.get('tab') as SysTab | null
  const tab: SysTab = p && ['status', 'backups', 'trash'].includes(p) ? p : 'status'
  const setTab = (t: SysTab) => router.replace(t === 'status' ? '/admin/system' : `/admin/system?tab=${t}`, { scroll: false })

  return (
    <AppShell>
      <PageHeader title="สถานะระบบ" description="ระบบยังทำงานอยู่ไหม ข้อมูลสำรองล่าสุดเมื่อไร และกู้ report ที่ลบผิด" />
      {!isChecking && !isAdmin ? (
        <div className="rounded-lg border border-dashed border-line-strong py-16 text-center"><p className="text-muted">หน้านี้สำหรับ Admin เท่านั้น</p></div>
      ) : isAdmin ? (
        <>
          <Tabs idPrefix="sys" active={tab} onChange={id => setTab(id as SysTab)} className="mb-6"
            tabs={[{ id: 'status', label: 'สถานะ' }, { id: 'backups', label: 'สำรองข้อมูล' }, { id: 'trash', label: 'ถังขยะ' }]} />
          <div id={`sys-panel-${tab}`} role="tabpanel" aria-labelledby={`sys-tab-${tab}`}>
            {tab === 'status' && <StatusPanel />}
            {tab === 'backups' && <BackupsPanel />}
            {tab === 'trash' && <TrashPanel />}
          </div>
        </>
      ) : null}
    </AppShell>
  )
}

export default function SystemPage() {
  return <Suspense><SystemInner /></Suspense>
}
