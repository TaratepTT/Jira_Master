'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import AppShell, { PageHeader } from '@/components/layout/AppShell'
import { useAuth } from '@/components/auth/AuthContext'

type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'error'; message: string }

const PRESET_JQL = [
  { label: 'ทั้งหมด (CTS)', jql: 'project = CTS ORDER BY created DESC', desc: 'ดึงทุก ticket ในโปรเจกต์ CTS' },
  { label: '7 วันล่าสุด',   jql: 'project = CTS AND created >= -7d ORDER BY created DESC', desc: 'เฉพาะ ticket ที่สร้างใน 7 วันที่ผ่านมา' },
  { label: '30 วันล่าสุด',  jql: 'project = CTS AND created >= -30d ORDER BY created DESC', desc: 'เฉพาะ ticket ที่สร้างใน 30 วันที่ผ่านมา' },
  { label: 'เฉพาะ Closed',  jql: 'project = CTS AND status = Closed ORDER BY created DESC', desc: 'ดูเฉพาะ ticket ที่ปิดแล้ว' },
  { label: 'เฉพาะ L3',      jql: 'project = CTS AND status = "L3-INVESTIGATE" ORDER BY created DESC', desc: 'ดูเฉพาะ ticket ที่กำลังสอบสวนระดับ L3' },
]

const JQL_EXAMPLES = [
  { jql: 'created >= "2026-02-20" AND created <= "2026-02-27" AND project = CTS ORDER BY created ASC', use: 'ดึงเฉพาะช่วงวันที่ที่กำหนด (แก้วันที่ในช่อง Date range ด้านบนแทนได้เลย)' },
  { jql: 'project = CTS AND assignee = currentUser()', use: 'ดูเฉพาะ ticket ที่มอบหมายให้ตัวเอง' },
  { jql: 'project = CTS AND "Business Unit[Short text]" ~ "VM"', use: 'กรองเฉพาะ Business Unit ที่มีคำว่า VM' },
  { jql: 'project = CTS AND priority in (High, Highest)', use: 'ดูเฉพาะ ticket priority สูง' },
  { jql: 'project = CTS AND status changed to "L3-INVESTIGATE" AFTER -7d', use: 'ticket ที่เพิ่งเข้าสถานะ L3 ใน 7 วัน' },
  { jql: 'project = CTS AND summary ~ "GPS"', use: 'ค้นหาคำใน Summary เช่น GPS' },
  { jql: 'project = CTS AND resolutiondate is EMPTY', use: 'ticket ที่ยังไม่ถูกปิด/resolve' },
  { jql: 'project = CTS ORDER BY updated DESC', use: 'เรียงตาม ticket ที่อัปเดตล่าสุด' },
]

export default function JiraSyncPage() {
  const router = useRouter()
  const { canEdit } = useAuth()
  const [jql, setJql]               = useState(PRESET_JQL[0].jql)
  const [reportName, setReportName]  = useState(`Jira Sync — ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}`)
  const [testState, setTestState]    = useState<TestState>({ state: 'idle' })
  const [connected, setConnected]    = useState<boolean | null>(null)
  const [showJqlHelp, setShowJqlHelp] = useState(false)

  // ── Date range picker ───────────────────────────────────────
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

  // "เริ่มรอบสัปดาห์นี้" (?week=last): last full week, Monday to Sunday
  const [weekRound, setWeekRound] = useState(false)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('week') !== 'last') return
    const d = new Date()
    const dow = d.getDay() === 0 ? 7 : d.getDay()
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow - 6)
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)
    const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    const th = (x: Date, withYear = false) => x.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
    setDateFrom(iso(mon)); setDateTo(iso(sun))
    setJql(`created >= "${iso(mon)}" AND created <= "${iso(sun)} 23:59" AND project = CTS ORDER BY created ASC`)
    setReportName(`สัปดาห์ ${th(mon)} – ${th(sun, true)}`)
    setWeekRound(true)
  }, [])

  const applyDateRange = () => {
    if (!dateFrom || !dateTo) return
    const newJql = `created >= "${dateFrom}" AND created <= "${dateTo}" AND project = CTS ORDER BY created ASC`
    setJql(newJql)
  }

  const testConnection = async () => {
    setTestState({ state: 'testing' })
    try {
      await api.get('/api/jira/test')
      setConnected(true)
      setTestState({ state: 'idle' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'เชื่อมต่อ Jira ไม่ได้'
      setConnected(false)
      setTestState({ state: 'error', message: msg })
    }
  }

  const goToValidate = () => {
    const q = new URLSearchParams({ jql, reportName })
    router.push(`/jira/validate?${q.toString()}`)
  }

  const isBusy = testState.state === 'testing'

  return (
    <AppShell width="narrow">
      <PageHeader
        title="Sync จาก Jira"
        description={<>ดึง ticket จาก <span className="text-ink">ascendcommerce-support.atlassian.net</span> มาตรวจในขั้นถัดไปก่อน ยังไม่บันทึกเป็น report จนกว่าคุณจะยืนยัน</>}
      />

      {!canEdit && (
        <p className="mb-6 rounded-lg border border-line bg-attention-soft px-4 py-3 text-[14px] text-attention">
          บัญชีของคุณมีสิทธิ์ดูอย่างเดียว จึง sync จาก Jira ไม่ได้ ขอสิทธิ์ Editor จากผู้ดูแลระบบ
        </p>
      )}

      {weekRound && (
        <p className="mb-4 rounded-lg border border-line bg-accent-soft px-4 py-3 text-[14px] text-ink">
          ตั้งค่าให้แล้วสำหรับรอบสัปดาห์ที่แล้ว ({dateFrom} ถึง {dateTo}) ตรวจชื่อ report แล้วกด &quot;ดึงข้อมูลมาตรวจ&quot;
        </p>
      )}

      <div className="panel divide-y divide-line">
        {/* Connection */}
        <section className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-[14px] font-semibold">การเชื่อมต่อ</h2>
            <p className="text-[13px] text-muted">
              {connected === null && testState.state !== 'error' && 'ยังไม่ได้ทดสอบ'}
              {connected === true && <span className="text-ok">เชื่อมต่อกับ Jira ได้</span>}
              {testState.state === 'error' && <span className="text-danger">เชื่อมต่อไม่ได้: {testState.message}</span>}
            </p>
          </div>
          <button onClick={testConnection} disabled={isBusy} aria-busy={testState.state === 'testing'} className="btn">
            {testState.state === 'testing' ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
          </button>
        </section>

        {/* Report name */}
        <section className="px-5 py-4">
          <label htmlFor="report-name" className="text-[14px] font-semibold">ชื่อ report</label>
          <p className="mb-2 text-[13px] text-muted">ตั้งให้รู้ว่าเป็นรอบไหน เช่น สัปดาห์ที่ 45</p>
          <input id="report-name" type="text" value={reportName} onChange={e => setReportName(e.target.value)} className="field py-2 text-[14px]" />
        </section>

        {/* Which tickets */}
        <section className="space-y-4 px-5 py-4">
          <div>
            <h2 className="text-[14px] font-semibold">ticket ที่จะดึง</h2>
            <p className="text-[13px] text-muted">เลือกแบบสำเร็จรูป กำหนดช่วงวันที่สร้าง หรือแก้ JQL เองในช่องด้านล่าง</p>
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="แบบสำเร็จรูป">
            {PRESET_JQL.map(p => (
              <button
                key={p.label}
                onClick={() => setJql(p.jql)}
                title={p.desc}
                aria-pressed={jql === p.jql}
                className={jql === p.jql ? 'btn border-accent bg-accent-soft text-accent hover:bg-accent-soft' : 'btn'}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-[13px] text-muted">
              สร้างตั้งแต่
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="field mt-1 w-auto" />
            </label>
            <label className="flex flex-col text-[13px] text-muted">
              ถึง
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="field mt-1 w-auto" />
            </label>
            <button onClick={applyDateRange} disabled={!dateFrom || !dateTo} className="btn">ใช้ช่วงวันที่นี้</button>
          </div>

          <div>
            <label htmlFor="jql" className="mb-1 block text-[13px] text-muted">JQL</label>
            <textarea
              id="jql"
              value={jql}
              onChange={e => setJql(e.target.value)}
              rows={3}
              spellCheck={false}
              className="field font-mono text-[12.5px] leading-relaxed"
              placeholder="project = CTS AND created >= -7d ORDER BY created DESC"
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-faint">ดึงได้สูงสุดตามที่ตั้งไว้บน server (ค่าเริ่มต้น 2,000 tickets ต่อครั้ง)</p>
              <button onClick={() => setShowJqlHelp(o => !o)} className="btn-quiet" aria-expanded={showJqlHelp}>
                {showJqlHelp ? 'ซ่อนตัวอย่าง JQL' : 'ตัวอย่าง JQL'}
              </button>
            </div>
          </div>

          {showJqlHelp && (
            <div className="rounded-md border border-line bg-sunken">
              <ul className="divide-y divide-line">
                {JQL_EXAMPLES.map(ex => (
                  <li key={ex.jql} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-[12px] text-ink">{ex.jql}</p>
                      <p className="mt-0.5 text-[12px] text-muted">{ex.use}</p>
                    </div>
                    <button onClick={() => setJql(ex.jql)} className="btn-quiet shrink-0">ใช้</button>
                  </li>
                ))}
              </ul>
              <a
                href="https://support.atlassian.com/jira-service-management-cloud/docs/jql-fields/"
                target="_blank"
                rel="noopener noreferrer"
                className="link block border-t border-line px-3 py-2 text-[12px]"
              >
                เอกสาร JQL ของ Atlassian
              </a>
            </div>
          )}
        </section>

        {/* Next step */}
        <section className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="max-w-[28rem] text-[13px] text-muted">ขั้นถัดไปจะแสดง ticket ที่ดึงมาให้ตรวจ แก้ช่องที่ขาด และเลือกว่าจะบันทึกใบไหน</p>
          <button onClick={goToValidate} disabled={!jql.trim() || !canEdit} className="btn-primary px-4 py-2 text-[14px]">
            ดึงข้อมูลมาตรวจ
          </button>
        </section>
      </div>
    </AppShell>
  )
}
