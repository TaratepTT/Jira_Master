'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AppShell, { PageHeader } from '@/components/layout/AppShell'
import { useAuth } from '@/components/auth/AuthContext'
import { TYPE_OF_ISSUE_OPTIONS, jiraBrowseUrl } from '@/components/dashboard/utils'
import AdfPreview from '@/components/playbooks/AdfPreview'
import TicketChecks from '@/components/playbooks/TicketChecks'
import {
  checkConfluence, saveConfluenceSettings, type ConfluencePage, type ConfluenceStatus, type PlaybookTestResult,
  createPlaybook, deletePlaybook, getPlaybookDelivery, listPlaybooks, setPlaybookFeedback, testPlaybooks, updatePlaybook,
  type Playbook, type PlaybookDelivery, type PlaybookInput, type PlaybookList,
} from '@/lib/api'

const errMsg = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const EMPTY: PlaybookInput = { title: '', confluenceUrl: '', steps: '', keywords: '', typeOfIssue: null, system: null, enabled: true, autoSend: false }
const kwChips = (k: string) => k.split(/[,\n]/).map(x => x.trim()).filter(Boolean)

// ── Feedback landing: the link at the bottom of each Jira comment opens here ──
function FeedbackCard({ id, onDone }: { id: string; onDone: () => void }) {
  const [d, setD] = useState<PlaybookDelivery | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { getPlaybookDelivery(id).then(setD).catch(e => setError(errMsg(e, 'ไม่พบรายการนี้'))) }, [id])
  const give = async (f: 'helpful' | 'wrong') => {
    try { setD(await setPlaybookFeedback(id, f)); onDone() } catch (e) { setError(errMsg(e, 'บันทึกไม่สำเร็จ')) }
  }
  if (error) return <div className="panel panel-pad mb-6 text-[14px] text-danger">{error}</div>
  if (!d) return <div className="panel mb-6 h-24 animate-pulse" />
  return (
    <div className="panel panel-pad mb-6 border-accent" data-testid="feedback-card">
      <p className="text-[13px] text-muted">
        คู่มือที่ส่งให้ <a href={jiraBrowseUrl(d.ticketKey)} target="_blank" rel="noreferrer" className="key text-accent hover:underline">{d.ticketKey}</a>
      </p>
      <p className="mt-1 text-[16px] font-semibold">{d.title}</p>
      <p className="mt-3 text-[14px]">คู่มือนี้ตรงกับเรื่องของ ticket ไหม</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => give('helpful')} className={d.feedback === 'helpful' ? 'btn-primary' : 'btn'}>ตรง ช่วยได้</button>
        <button onClick={() => give('wrong')} className={d.feedback === 'wrong' ? 'btn-primary' : 'btn'}>ไม่ตรงเรื่อง</button>
        {d.feedback && <span className="text-[13px] text-ok">บันทึกแล้ว ขอบคุณครับ</span>}
      </div>
      <p className="mt-3 text-[12px] text-faint">ใช้ปรับคำค้นของคู่มือ คู่มือที่ถูกบอกว่าไม่ตรงบ่อย ๆ ควรแก้ keyword หรือปิดการส่งอัตโนมัติ</p>
    </div>
  )
}

// ── Add / edit form ───────────────────────────────────────────
function Editor({ initial, onSaved, onCancel }: { initial: Playbook | null; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState<PlaybookInput>(initial ? {
    title: initial.title, confluenceUrl: initial.confluenceUrl ?? '', steps: initial.steps, keywords: initial.keywords,
    typeOfIssue: initial.typeOfIssue, system: initial.system, enabled: initial.enabled, autoSend: initial.autoSend,
  } : EMPTY)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof PlaybookInput>(k: K, v: PlaybookInput[K]) => setF(x => ({ ...x, [k]: v }))
  const save = async () => {
    setSaving(true); setError('')
    try {
      const body = { ...f, confluenceUrl: f.confluenceUrl?.trim() || null }
      if (initial) await updatePlaybook(initial.id, body); else await createPlaybook(body)
      onSaved()
    } catch (e) { setError(errMsg(e, 'บันทึกไม่สำเร็จ')) } finally { setSaving(false) }
  }
  const label = 'block text-[13px] font-medium text-ink'
  const hint = 'mt-0.5 text-[12px] text-muted'
  return (
    <div className="panel panel-pad mb-6" data-testid="playbook-editor">
      <h2 className="section-title">{initial ? `แก้คู่มือ "${initial.title}"` : 'เพิ่มคู่มือ'}</h2>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <label className={label}>ชื่อคู่มือ
            <input value={f.title} onChange={e => set('title', e.target.value)} className="field mt-1" placeholder="เช่น GPS รถไม่อัปเดตตำแหน่ง" maxLength={200} />
          </label>
          <label className={label}>ลิงก์หน้า Confluence
            <input value={f.confluenceUrl ?? ''} onChange={e => set('confluenceUrl', e.target.value)} className="field mt-1" placeholder="https://….atlassian.net/wiki/spaces/…" />
          </label>
          <label className={label}>คำที่ใช้จับคู่ (คั่นด้วย ,)
            <input value={f.keywords} onChange={e => set('keywords', e.target.value)} className="field mt-1" placeholder="gps, ตำแหน่งรถ, รถไม่ขยับ" />
            <p className={hint}>เจอคำใดคำหนึ่งใน summary = ตรง เจอแค่ในรายละเอียดจะได้คะแนนน้อยกว่า ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่าง</p>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Type of Issue
              <select value={f.typeOfIssue ?? ''} onChange={e => set('typeOfIssue', e.target.value || null)} className="field mt-1">
                <option value="">ทุกแบบ</option>
                {TYPE_OF_ISSUE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className={label}>ระบบ
              <select value={f.system ?? ''} onChange={e => set('system', e.target.value || null)} className="field mt-1">
                <option value="">ทุกระบบ</option>
                {['CMP', 'VMP', 'CP TMS'].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="space-y-4">
          <label className={label}>ขั้นตอนสั้น ๆ ให้ L1 ทำ (บรรทัดละขั้น)
            <textarea value={f.steps} onChange={e => set('steps', e.target.value)} rows={7} className="field mt-1 resize-y leading-snug"
              placeholder={'เช็คว่ากล่อง GPS มีไฟ\nให้คนขับปิดเปิดแอป\nถ้ายังไม่ได้ ส่งต่อ L2 พร้อมเลขทะเบียนรถ'} />
            <p className={hint}>ขั้นตอนจะอยู่ใน comment เลย L1 ไม่ต้องเปิด Confluence ก็ทำได้</p>
          </label>
          <div className="space-y-2 rounded-md border border-line bg-sunken p-3">
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" checked={f.enabled} onChange={e => set('enabled', e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>เปิดใช้ <span className="text-muted">(ปิด = ไม่แนะนำคู่มือนี้เลย)</span></span>
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" checked={f.autoSend} onChange={e => set('autoSend', e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>ส่งอัตโนมัติเมื่อมี ticket ใหม่ที่ตรง <span className="text-muted">(ไม่เลือก = แนะนำในหน้า ticket ให้กดส่งเอง)</span></span>
            </label>
          </div>
        </div>
      </div>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={save} disabled={saving || !f.title.trim()} className="btn-primary">{saving ? 'กำลังบันทึก...' : 'บันทึกคู่มือ'}</button>
        <button onClick={onCancel} className="btn-quiet">ยกเลิก</button>
      </div>
    </div>
  )
}

function ConfluenceList({ pages, minScore }: { pages: ConfluencePage[]; minScore: number }) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {pages.map(pg => (
        <li key={pg.id} className="flex gap-3 px-3 py-2">
          <span className={`w-10 shrink-0 text-right text-[13px] num ${pg.score >= minScore ? 'text-ok' : 'text-faint'}`}>{Math.round(pg.score * 100)}%</span>
          <span className="min-w-0">
            <a href={pg.url} target="_blank" rel="noreferrer" className="block text-[13px] text-accent hover:underline">{pg.title}</a>
            {pg.excerpt && <span className="block truncate text-[12px] text-muted">{pg.excerpt}</span>}
            {(pg.reasons?.length ?? 0) > 0 ? <span className="block text-[12px] text-faint">{pg.reasons!.join(' · ')}</span>
              : pg.matched.length > 0 && <span className="block text-[12px] text-faint">เจอคำ: {pg.matched.join(', ')}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ── Confluence search: status + admin settings ────────────────
function ConfluencePanel({ status, stats, isAdmin, onSaved }: { status: ConfluenceStatus; stats: PlaybookList['confluence']['stats']; isAdmin: boolean; onSaved: () => void }) {
  const st = status.settings
  const [auto, setAuto] = useState(st.autoSend)
  const [min, setMin] = useState(String(Math.round(st.minScore * 100)))
  const [links, setLinks] = useState(String(st.maxLinks))
  const [spaces, setSpaces] = useState(st.spaces.join(', '))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setAuto(st.autoSend); setMin(String(Math.round(st.minScore * 100))); setLinks(String(st.maxLinks)); setSpaces(st.spaces.join(', ')) }, [st.autoSend, st.minScore, st.maxLinks, st.spaces])

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      await saveConfluenceSettings({ autoSend: auto, minScore: Number(min) / 100, maxLinks: Number(links), spaces: spaces.split(',').map(x => x.trim()).filter(Boolean) })
      setMsg({ ok: true, text: 'บันทึกแล้ว' }); onSaved()
    } catch (e) { setMsg({ ok: false, text: errMsg(e, 'บันทึกไม่สำเร็จ') }) } finally { setBusy(false) }
  }
  const check = async () => {
    setBusy(true); setMsg(null)
    try { const r = await checkConfluence(); setMsg({ ok: r.ok, text: r.message }) } catch (e) { setMsg({ ok: false, text: errMsg(e, 'ตรวจไม่สำเร็จ') }) } finally { setBusy(false) }
  }

  return (
    <div className="panel panel-pad mb-6" data-testid="confluence-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">ค้นคู่มือจาก Confluence อัตโนมัติ</h2>
          <p className="section-note mt-0.5">
            ถ้าไม่มีคู่มือที่เขียนไว้ตรงเรื่อง ระบบจะค้น Confluence ด้วย summary ของ ticket แล้วแนบลิงก์หน้าที่ตรงที่สุดเป็น comment ภายใน
          </p>
        </div>
        {status.configured && (
          <span className={`chip ${st.autoSend ? 'text-ok' : ''}`}>{st.autoSend ? 'ส่งอัตโนมัติอยู่' : 'ยังไม่ส่งอัตโนมัติ'}</span>
        )}
      </div>
      {!status.configured ? (
        <p className="mt-3 text-[13px] text-muted">
          ยังไม่ได้เชื่อม Confluence ตั้ง <span className="key">CONFLUENCE_BASE_URL</span>, <span className="key">CONFLUENCE_EMAIL</span>, <span className="key">CONFLUENCE_API_TOKEN</span> บน Render ก่อน (ดู PLAYBOOKS-README.md)
        </p>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-muted">
            เชื่อมกับ <span className="key">{status.site}</span>, ค้นใน space {st.spaces.length ? st.spaces.map(x => <span key={x} className="key mx-0.5">{x}</span>) : 'ทุก space ที่บัญชีนี้เห็น'}
            {stats.sent > 0 && <> · ส่งไปแล้ว {stats.sent} ครั้ง, L1 บอกว่าตรง {stats.helpful} ไม่ตรง {stats.wrong}{stats.knownLevel ? `, จบที่ L1 ${Math.round((stats.stayedL1 / stats.knownLevel) * 100)}%` : ''}</>}
          </p>
          {isAdmin && (
            <div className="mt-4 rounded-md border border-line bg-sunken p-3">
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="accent-[var(--accent)]" />
                  ส่งลิงก์อัตโนมัติเมื่อมี ticket ใหม่
                </label>
                <label className="text-[12px] text-muted">ความตรงขั้นต่ำ (%)
                  <input type="number" min={20} max={95} step={5} value={min} onChange={e => setMin(e.target.value)} className="field mt-1 w-24" />
                </label>
                <label className="text-[12px] text-muted">ลิงก์สูงสุดต่อ ticket
                  <select value={links} onChange={e => setLinks(e.target.value)} className="field mt-1 w-24">
                    {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="text-[12px] text-muted">Space keys (คั่นด้วย ,)
                  <input value={spaces} onChange={e => setSpaces(e.target.value)} className="field mt-1 w-48" placeholder="ANLTS" />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={save} disabled={busy} className="btn-primary">บันทึกการตั้งค่า</button>
                <button onClick={check} disabled={busy} className="btn">ทดสอบการเชื่อมต่อ</button>
                {msg && <span className={`text-[13px] ${msg.ok ? 'text-ok' : 'text-danger'}`}>{msg.text}</span>}
              </div>
              <p className="mt-2 text-[12px] text-faint">แนะนำให้ลองกับ ticket สมมติด้านล่างหลาย ๆ แบบก่อนเปิดส่งอัตโนมัติ ถ้าเจอลิงก์ผิดบ่อยให้เพิ่มความตรงขั้นต่ำ</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Tester: paste a summary, see which manual would be sent ──
function Tester({ minScore }: { minScore: number }) {
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [r, setR] = useState<PlaybookTestResult | null>(null)
  const [error, setError] = useState('')
  const run = async () => {
    setError('')
    try { setR(await testPlaybooks({ summary, description })) } catch (e) { setError(errMsg(e, 'ทดสอบไม่สำเร็จ')) }
  }
  return (
    <div className="panel panel-pad">
      <h2 className="section-title">ลองกับ ticket สมมติ</h2>
      <p className="section-note mt-0.5">วาง summary ของ ticket แล้วดูว่าคู่มือไหนจะถูกส่ง และ comment จะหน้าตาแบบไหน</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <input value={summary} onChange={e => setSummary(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && summary.trim()) run() }}
            className="field" placeholder="summary เช่น รถทะเบียน 1กก-1234 GPS ไม่อัปเดต" aria-label="summary ที่จะทดสอบ" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="field resize-y" placeholder="รายละเอียด (ไม่ใส่ก็ได้)" aria-label="รายละเอียด" />
          <button onClick={run} disabled={!summary.trim()} className="btn">ทดสอบ</button>
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {r && (
            <div className="space-y-3 pt-2" data-testid="tester-result">
              <p className={`text-[13px] font-medium ${r.wouldSend ? 'text-ok' : 'text-attention'}`}>
                {r.wouldSend === 'playbook' ? 'จะส่งคู่มือนี้อัตโนมัติ'
                  : r.wouldSend === 'confluence' ? 'จะส่งลิงก์ Confluence อัตโนมัติ'
                  : r.matches.length || r.confluence.pages.length ? 'ไม่ส่งอัตโนมัติ แต่จะแนะนำในหน้าต่าง ticket ให้กดส่งเอง'
                  : 'ไม่มีคู่มือหรือหน้า Confluence ที่ตรง ticket นี้จะไม่ได้ comment'}
              </p>
              {r.matches.length > 0 && (
                <div>
                  <p className="mb-1 text-[12px] text-muted">คู่มือที่เขียนไว้ (ส่งอัตโนมัติเมื่อได้ {Math.round(minScore * 100)}% ขึ้นไป)</p>
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {r.matches.map(m => (
                      <li key={m.playbookId} className="flex gap-3 px-3 py-2">
                        <span className="w-10 shrink-0 text-right text-[13px] num text-muted">{Math.round(m.score * 100)}%</span>
                        <span className="min-w-0">
                          <span className="block text-[13px] text-ink">{m.title}{m.autoSend && <span className="chip ml-2">อัตโนมัติ</span>}</span>
                          <span className="block text-[12px] text-muted">{m.reasons.join(' · ')}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.confluence.configured && (
                <div data-testid="tester-confluence">
                  <p className="mb-1 text-[12px] text-muted">ค้นใน Confluence (ส่งอัตโนมัติเมื่อได้ {Math.round((r.confluence.minScore ?? 0.5) * 100)}% ขึ้นไป{r.confluence.autoSend ? '' : ', ตอนนี้ปิดส่งอัตโนมัติอยู่'})</p>
                  {r.confluence.error ? <p className="text-[13px] text-danger">{r.confluence.error}</p>
                    : r.confluence.pages.length === 0 ? <p className="text-[13px] text-muted">ไม่พบหน้าที่เกี่ยวข้อง</p>
                    : <ConfluenceList pages={r.confluence.pages} minScore={r.confluence.minScore ?? 0.5} />}
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[12px] text-muted">ตัวอย่าง comment ภายใน (ลูกค้าไม่เห็น)</p>
          <div className="min-h-[8rem] rounded-md border border-dashed border-line-strong bg-sunken p-3">
            {r?.preview ? <AdfPreview doc={r.preview} /> : <p className="text-[13px] text-faint">ยังไม่มีตัวอย่าง</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlaybooksInner() {
  const { canEdit, isAdmin } = useAuth()
  const params = useSearchParams()
  const deliveryId = params.get('delivery')
  const [data, setData] = useState<PlaybookList | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Playbook | 'new' | null>(null)

  const load = useCallback(() => {
    listPlaybooks().then(d => { setData(d); setError('') }).catch(e => setError(errMsg(e, 'โหลดคู่มือไม่สำเร็จ')))
  }, [])
  useEffect(load, [load])

  const remove = async (b: Playbook) => {
    if (!confirm(`ลบคู่มือ "${b.title}"? ประวัติการส่งยังอยู่ใน Jira`)) return
    try { await deletePlaybook(b.id); load() } catch (e) { setError(errMsg(e, 'ลบไม่สำเร็จ')) }
  }
  const toggleAuto = async (b: Playbook) => {
    try { await updatePlaybook(b.id, { ...b, autoSend: !b.autoSend }); load() } catch (e) { setError(errMsg(e, 'บันทึกไม่สำเร็จ')) }
  }

  return (
    <AppShell>
      <PageHeader
        title="คู่มือ L1"
        description="ระบบดึง ticket ใหม่จาก Jira เอง เทียบกับคู่มือที่เขียนไว้และเนื้อหาหน้า Confluence แล้วใส่ขั้นตอนหรือลิงก์ที่ตรงที่สุดเป็น comment ภายใน ให้ L1 ทำต่อเองได้ ลูกค้าไม่เห็น comment นี้"
        actions={canEdit && !editing ? <button onClick={() => setEditing('new')} className="btn-primary">เพิ่มคู่มือ</button> : undefined}
      />

      {deliveryId && <FeedbackCard id={deliveryId} onDone={load} />}

      <TicketChecks canEdit={canEdit} onChanged={load} />

      {editing && (
        <Editor
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          onSaved={() => { setEditing(null); load() }}
          onCancel={() => setEditing(null)}
        />
      )}

      {error && <p className="mb-4 text-[13px] text-danger">{error}</p>}

      <div className="panel mb-6 overflow-x-auto">
        {!data ? (
          <div className="m-4 h-24 animate-pulse rounded bg-sunken" />
        ) : data.playbooks.length === 0 ? (
          <div className="panel-pad text-[14px] text-muted">
            ยังไม่มีคู่มือ {canEdit ? 'เริ่มจากเรื่องที่ L1 ส่งต่อมาบ่อยที่สุด แล้วกด "เพิ่มคู่มือ"' : 'ให้ editor เพิ่มคู่มือก่อน'}
          </div>
        ) : (
          <table className="w-full min-w-[760px] text-[13px]" data-testid="playbook-table">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                <th className="px-4 py-2 font-medium">คู่มือ</th>
                <th className="px-2 py-2 font-medium">จับคู่เมื่อเจอคำ</th>
                <th className="px-2 py-2 text-right font-medium">ส่งแล้ว</th>
                <th className="px-2 py-2 text-right font-medium" title="จาก feedback ของ L1">ตรง / ไม่ตรง</th>
                <th className="px-2 py-2 text-right font-medium" title="ticket ที่ได้คู่มือแล้วจบที่ L1 ไม่ต้องส่งต่อ (ดูจาก report ที่ sync แล้ว)">จบที่ L1</th>
                <th className="px-2 py-2 font-medium">การส่ง</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.playbooks.map(b => {
                const s = data.stats.find(x => x.id === b.id)
                return (
                  <tr key={b.id} className={`border-b border-line last:border-b-0 ${b.enabled ? '' : 'text-faint'}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{b.title}</p>
                      {b.confluenceUrl && <a href={b.confluenceUrl} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">เปิดใน Confluence</a>}
                      {(b.typeOfIssue || b.system) && <p className="text-[12px] text-muted">{[b.system, b.typeOfIssue].filter(Boolean).join(' · ')} เท่านั้น</p>}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex max-w-[16rem] flex-wrap gap-1">
                        {kwChips(b.keywords).slice(0, 6).map(k => <span key={k} className="chip">{k}</span>)}
                        {!kwChips(b.keywords).length && <span className="text-[12px] text-faint">ใช้ชื่อคู่มือ</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right num">{s?.sent ?? 0}</td>
                    <td className="px-2 py-2.5 text-right num">
                      <span className={s?.helpful ? "text-ok" : ""}>{s?.helpful ?? 0}</span> / <span className={s?.wrong ? 'text-danger' : ''}>{s?.wrong ?? 0}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right num">{s?.knownLevel ? `${Math.round((s.stayedL1 / s.knownLevel) * 100)}% (${s.stayedL1}/${s.knownLevel})` : <span className="text-faint">—</span>}</td>
                    <td className="px-2 py-2.5">
                      {!b.enabled ? 'ปิดอยู่' : canEdit ? (
                        <button onClick={() => toggleAuto(b)} className="btn-quiet -ml-2" title="กดเพื่อสลับ">
                          {b.autoSend ? 'อัตโนมัติ' : 'กดส่งเอง'}
                        </button>
                      ) : b.autoSend ? 'อัตโนมัติ' : 'กดส่งเอง'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {canEdit && <>
                        <button onClick={() => setEditing(b)} className="btn-quiet">แก้</button>
                        <button onClick={() => remove(b)} className="btn-quiet text-danger">ลบ</button>
                      </>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {data?.confluence && <ConfluencePanel status={data.confluence} stats={data.confluence.stats} isAdmin={isAdmin} onSaved={load} />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Tester minScore={data?.autoMinScore ?? 0.6} />

        <div className="panel panel-pad">
          <h2 className="section-title">ส่งล่าสุด</h2>
          {!data || data.recent.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">ยังไม่มีการส่งคู่มือ</p>
          ) : (
            <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]">
              <tbody>
                {data.recent.map(d => (
                  <tr key={d.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 text-faint num whitespace-nowrap">{fmtDateTime(d.createdAt)}</td>
                    <td className="py-2 pr-3"><a href={jiraBrowseUrl(d.ticketKey)} target="_blank" rel="noreferrer" className="key text-accent hover:underline">{d.ticketKey}</a></td>
                    <td className="py-2 pr-3 text-ink">{d.title}</td>
                    <td className="py-2 pr-3 text-muted">{d.mode === 'auto' ? 'อัตโนมัติ' : d.sentBy}</td>
                    <td className="py-2 pr-3">{d.escalation ? <span className={d.escalation === 'L1' ? 'text-ok' : 'text-muted'}>{d.escalation === 'L1' ? 'จบที่ L1' : `ไปถึง ${d.escalation}`}</span> : <span className="text-faint">—</span>}</td>
                    <td className="py-2 text-right">{d.feedback === 'helpful' ? <span className="text-ok">ตรง</span> : d.feedback === 'wrong' ? <span className="text-danger">ไม่ตรง</span> : <span className="text-faint">ยังไม่มี feedback</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

export default function PlaybooksPage() {
  return <Suspense><PlaybooksInner /></Suspense>
}
