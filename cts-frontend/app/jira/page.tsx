'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import ThemeToggle from '@/components/theme/ThemeToggle'

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
  const [jql, setJql]               = useState(PRESET_JQL[0].jql)
  const [reportName, setReportName]  = useState(`Jira Sync — ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}`)
  const [testState, setTestState]    = useState<TestState>({ state: 'idle' })
  const [connected, setConnected]    = useState<boolean | null>(null)
  const [showJqlHelp, setShowJqlHelp] = useState(false)

  // ── Date range picker ───────────────────────────────────────
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
              </svg>
            </Link>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
                <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.75 2C6.365 2 2 6.365 2 11.75S6.365 21.5 11.75 21.5 21.5 17.135 21.5 11.75 17.135 2 11.75 2zm.917 14.583l-4.167-4.166 4.167-4.167 4.166 4.167-4.166 4.166z"/>
                </svg>
              </div>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Jira Sync</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {connected !== null && (
              <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-50 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-400'}`}>
                <div className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}/>
                {connected ? 'เชื่อมต่อแล้ว' : 'เชื่อมต่อไม่ได้'}
              </div>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">

        {/* Title */}
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">ดึงข้อมูลจาก Jira</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sync tickets จาก <span className="font-mono text-slate-700 dark:text-slate-300">ascendcommerce-support.atlassian.net</span> — ขั้นตอนถัดไปจะให้ตรวจสอบข้อมูลก่อนสร้าง Dashboard จริง
          </p>
        </div>

        {/* Test connection */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">ทดสอบการเชื่อมต่อ</h2>
            <button
              onClick={testConnection}
              disabled={isBusy}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
            >
              {testState.state === 'testing' ? 'กำลังทดสอบ...' : 'ทดสอบ'}
            </button>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">ตรวจสอบว่า backend เชื่อมต่อกับ Jira ได้ก่อนดำเนินการ</p>
        </div>

        {/* Report name */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">ชื่อ Report</h2>
          <input
            type="text"
            value={reportName}
            onChange={e => setReportName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 transition-colors"
            placeholder="ชื่อ report"
          />
        </div>

        {/* JQL */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">JQL Filter</h2>

          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESET_JQL.map(p => (
              <button
                key={p.label}
                onClick={() => setJql(p.jql)}
                title={p.desc}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${jql === p.jql ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Date range picker */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">กรองตามช่วงวันที่ (Created)</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50"
              />
              <span className="text-xs text-slate-400">ถึง</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50"
              />
              <button
                onClick={applyDateRange}
                disabled={!dateFrom || !dateTo}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ใช้ช่วงวันที่นี้
              </button>
            </div>
          </div>

          {/* Custom JQL */}
          <textarea
            value={jql}
            onChange={e => setJql(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3.5 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50 transition-colors"
            placeholder="project = CTS AND created >= -7d ORDER BY created DESC"
          />

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              ดึงสูงสุด 500 tickets ต่อครั้ง — เงื่อนไขยกเว้นปรับได้อีกครั้งในหน้าตรวจสอบถัดไป
            </p>
            <button
              onClick={() => setShowJqlHelp(o => !o)}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              {showJqlHelp ? 'ซ่อนตัวอย่าง JQL' : 'ดูตัวอย่าง JQL เพิ่มเติม'}
            </button>
          </div>

          {/* JQL examples help panel */}
          {showJqlHelp && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">ตัวอย่าง JQL ที่ใช้บ่อย</p>
              <div className="space-y-2.5">
                {JQL_EXAMPLES.map(ex => (
                  <div key={ex.jql} className="flex items-start justify-between gap-3 group">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all">{ex.jql}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{ex.use}</p>
                    </div>
                    <button
                      onClick={() => setJql(ex.jql)}
                      className="flex-shrink-0 text-[11px] font-medium text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 hover:underline transition-opacity whitespace-nowrap"
                    >
                      ใช้ query นี้
                    </button>
                  </div>
                ))}
              </div>
              <a
                href="https://support.atlassian.com/jira-service-management-cloud/docs/jql-fields/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
              >
                อ่านเอกสาร JQL เพิ่มเติมจาก Atlassian →
              </a>
            </div>
          )}
        </div>

        {/* Info: two-step flow */}
        <div className="rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 px-5 py-4 flex gap-3">
          <svg className="h-5 w-5 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          <p className="text-sm text-blue-800 dark:text-blue-300">
            ขั้นถัดไปจะ<strong>ดึงข้อมูลมาให้ตรวจสอบก่อน</strong> ยังไม่บันทึกลง Dashboard ทันที — คุณจะเห็นรายการที่ข้อมูลไม่ครบ แก้ไขได้โดยตรง และเลือกได้เองว่าจะรวมรายการไหนบ้าง
          </p>
        </div>

        {/* Continue button */}
        <button
          onClick={goToValidate}
          disabled={!jql.trim()}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          ดึงข้อมูลมาตรวจสอบ
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
        </button>

      </main>
    </div>
  )
}
