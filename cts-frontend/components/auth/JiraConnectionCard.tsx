'use client'

import { useEffect, useState } from 'react'
import { disconnectJira, getJiraConnection, startJiraConnection, type JiraConnectionStatus } from '@/lib/api'

// "เชื่อมบัญชี Jira" — when connected, everything this user does in Jira through the
// Dashboard (edit, change status, comment) is recorded under THEIR Jira name and follows
// THEIR Jira permissions, instead of the shared API-token account.
export default function JiraConnectionCard({ notice }: { notice?: string }) {
  const [st, setSt] = useState<JiraConnectionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(notice ? { ok: true, text: notice } : null)

  useEffect(() => {
    getJiraConnection().then(setSt).catch(() => setSt(null))
  }, [])

  const connect = async () => {
    setBusy(true)
    setMsg(null)
    try {
      window.location.href = await startJiraConnection()
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'เริ่มเชื่อมต่อไม่สำเร็จ' })
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!confirm('ยกเลิกการเชื่อมบัญชี Jira? ต่อจากนี้การแก้ไขจะใช้บัญชีกลางของระบบ')) return
    setBusy(true)
    try {
      const r = await disconnectJira()
      setSt(r)
      setMsg({ ok: true, text: r.message })
    } catch {
      setMsg({ ok: false, text: 'ยกเลิกไม่สำเร็จ' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">บัญชี Jira ของฉัน</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        เมื่อเชื่อมแล้ว ทุกการแก้ไข / เปลี่ยนสถานะ / comment ที่ทำผ่าน Dashboard จะขึ้นใน Jira เป็นชื่อของคุณ
        และใช้สิทธิ์ workflow ของบัญชีคุณเอง (ถ้าไม่เชื่อม จะใช้บัญชีกลางของระบบ)
      </p>

      {st === null ? (
        <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-700 animate-pulse" />
      ) : !st.enabled ? (
        <p className="rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
          ผู้ดูแลระบบยังไม่ได้เปิดใช้การเชื่อมบัญชี Jira (ต้องตั้งค่า ATLASSIAN_CLIENT_ID / ATLASSIAN_CLIENT_SECRET / ATLASSIAN_REDIRECT_URI ที่ backend)
        </p>
      ) : st.connected && st.account ? (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/20 px-3 py-2">
          <div className="text-sm">
            <p className="font-medium text-green-800 dark:text-green-300">เชื่อมต่อแล้ว: {st.account.displayName}</p>
            <p className="text-xs text-green-700/80 dark:text-green-400/70">{st.account.email ?? ''} · {st.account.siteUrl}</p>
          </div>
          <button onClick={disconnect} disabled={busy} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50">
            ยกเลิกการเชื่อมต่อ
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {st.needsReconnect && (
            <p className="rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/50 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
              การเชื่อมต่อเดิม ({st.account?.displayName}) หมดอายุหรือถูกยกเลิก — ตอนนี้ใช้บัญชีกลางอยู่ กดเชื่อมต่อใหม่
            </p>
          )}
          <button onClick={connect} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'กำลังไปที่ Atlassian...' : st.needsReconnect ? 'เชื่อมต่อใหม่' : 'เชื่อมบัญชี Jira'}
          </button>
        </div>
      )}

      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{msg.text}</p>
      )}
      {st?.connected && (
        <p className="text-[11px] text-slate-400">
          การยกเลิกที่นี่จะลบ token ออกจากระบบ ถ้าต้องการถอนสิทธิ์ที่ฝั่ง Atlassian ด้วย ไปที่ id.atlassian.com → Connected apps
        </p>
      )}
    </section>
  )
}
