'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'

type SyncState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'syncing' }
  | { state: 'success'; reportId: string; totalTickets: number }
  | { state: 'error'; message: string }

const PRESET_JQL = [
  { label: 'ทั้งหมด (CTS)', jql: 'project = CTS ORDER BY created DESC' },
  { label: '7 วันล่าสุด',   jql: 'project = CTS AND created >= -7d ORDER BY created DESC' },
  { label: '30 วันล่าสุด',  jql: 'project = CTS AND created >= -30d ORDER BY created DESC' },
  { label: 'เฉพาะ Closed',  jql: 'project = CTS AND status = Closed ORDER BY created DESC' },
  { label: 'เฉพาะ L3',      jql: 'project = CTS AND status = "L3-INVESTIGATE" ORDER BY created DESC' },
]

export default function JiraSyncPage() {
  const router = useRouter()
  const [jql, setJql]               = useState(PRESET_JQL[0].jql)
  const [reportName, setReportName]  = useState(`Jira Sync — ${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}`)
  const [syncState, setSyncState]    = useState<SyncState>({ state: 'idle' })
  const [connected, setConnected]    = useState<boolean | null>(null)

  const testConnection = async () => {
    setSyncState({ state: 'testing' })
    try {
      await api.get('/api/jira/test')
      setConnected(true)
      setSyncState({ state: 'idle' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'เชื่อมต่อ Jira ไม่ได้'
      setConnected(false)
      setSyncState({ state: 'error', message: msg })
    }
  }

  const sync = async () => {
    setSyncState({ state: 'syncing' })
    try {
      const { data } = await api.post('/api/jira/sync', { jql, reportName })
      setSyncState({ state: 'success', reportId: data.reportId, totalTickets: data.totalTickets })
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Sync ไม่สำเร็จ'
      setSyncState({ state: 'error', message: msg })
    }
  }

  const isBusy = syncState.state === 'testing' || syncState.state === 'syncing'

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
              </svg>
            </Link>
            <div className="flex items-center gap-2">
              {/* Jira logo color */}
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
                <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.75 2C6.365 2 2 6.365 2 11.75S6.365 21.5 11.75 21.5 21.5 17.135 21.5 11.75 17.135 2 11.75 2zm.917 14.583l-4.167-4.166 4.167-4.167 4.166 4.167-4.166 4.166z"/>
                </svg>
              </div>
              <span className="text-sm font-semibold text-slate-800">Jira Sync</span>
            </div>
          </div>
          {/* Connection status */}
          {connected !== null && (
            <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${connected ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              <div className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}/>
              {connected ? 'เชื่อมต่อแล้ว' : 'เชื่อมต่อไม่ได้'}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">

        {/* Title */}
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">ดึงข้อมูลจาก Jira</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sync tickets จาก <span className="font-mono text-slate-700">ascendcommerce-support.atlassian.net</span> โดยตรง ไม่ต้องอัปโหลดไฟล์
          </p>
        </div>

        {/* Test connection */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-700">ทดสอบการเชื่อมต่อ</h2>
            <button
              onClick={testConnection}
              disabled={isBusy}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              {syncState.state === 'testing' ? 'กำลังทดสอบ...' : 'ทดสอบ'}
            </button>
          </div>
          <p className="text-xs text-slate-400">ตรวจสอบว่า backend เชื่อมต่อกับ Jira ได้ก่อน sync</p>
        </div>

        {/* Report name */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">ชื่อ Report</h2>
          <input
            type="text"
            value={reportName}
            onChange={e => setReportName(e.target.value)}
            disabled={isBusy}
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors disabled:opacity-50"
            placeholder="ชื่อ report"
          />
        </div>

        {/* JQL */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">JQL Filter</h2>

          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            {PRESET_JQL.map(p => (
              <button
                key={p.label}
                onClick={() => setJql(p.jql)}
                disabled={isBusy}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${jql === p.jql ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom JQL */}
          <textarea
            value={jql}
            onChange={e => setJql(e.target.value)}
            disabled={isBusy}
            rows={3}
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors disabled:opacity-50"
            placeholder="project = CTS AND created >= -7d ORDER BY created DESC"
          />
          <p className="text-xs text-slate-400">ปรับ JQL ได้อิสระ — ดึงสูงสุด 500 tickets ต่อครั้ง</p>
        </div>

        {/* Error */}
        {syncState.state === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <p className="text-sm font-medium text-red-800">เกิดข้อผิดพลาด</p>
            <p className="text-sm text-red-600 mt-0.5">{syncState.message}</p>
            <button onClick={() => setSyncState({ state: 'idle' })} className="mt-3 text-xs text-red-600 underline">ลองใหม่</button>
          </div>
        )}

        {/* Success */}
        {syncState.state === 'success' && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-5 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <p className="text-sm font-semibold text-green-800">Sync สำเร็จ — {syncState.totalTickets} tickets</p>
            <div className="flex justify-center gap-2">
              <button
                onClick={() => router.push(`/dashboard/${syncState.reportId}`)}
                className="rounded-lg bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 transition-colors"
              >
                ดู Dashboard
              </button>
              <button
                onClick={() => setSyncState({ state: 'idle' })}
                className="rounded-lg border border-green-300 bg-white px-5 py-2 text-sm font-medium text-green-700 hover:bg-green-50 transition-colors"
              >
                Sync ใหม่
              </button>
            </div>
          </div>
        )}

        {/* Sync button */}
        {syncState.state !== 'success' && (
          <button
            onClick={sync}
            disabled={isBusy || !jql.trim()}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {syncState.state === 'syncing' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                กำลัง Sync จาก Jira...
              </span>
            ) : 'Sync จาก Jira'}
          </button>
        )}

      </main>
    </div>
  )
}
