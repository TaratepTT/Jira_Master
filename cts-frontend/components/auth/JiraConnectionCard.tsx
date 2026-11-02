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
    <section className="panel panel-pad space-y-3">
      <h2 className="text-sm font-semibold text-ink">บัญชี Jira ของฉัน</h2>
      <p className="text-xs text-muted">
        เมื่อเชื่อมแล้ว ทุกการแก้ไข / เปลี่ยนสถานะ / comment ที่ทำผ่าน Dashboard จะขึ้นใน Jira เป็นชื่อของคุณ
        และใช้สิทธิ์ workflow ของบัญชีคุณเอง (ถ้าไม่เชื่อม จะใช้บัญชีกลางของระบบ)
      </p>

      {st === null ? (
        <div className="h-10 rounded-lg bg-sunken animate-pulse" />
      ) : !st.enabled ? (
        <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-muted">
          ผู้ดูแลระบบยังไม่ได้เปิดใช้การเชื่อมบัญชี Jira (ต้องตั้งค่า ATLASSIAN_CLIENT_ID / ATLASSIAN_CLIENT_SECRET / ATLASSIAN_REDIRECT_URI ที่ backend)
        </p>
      ) : st.connected && st.account ? (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-line bg-sunken px-3 py-2">
          <div className="text-sm">
            <p className="font-medium text-ok">เชื่อมต่อแล้ว: {st.account.displayName}</p>
            <p className="text-xs text-muted">{[st.account.email, st.account.siteUrl].filter(Boolean).join(', ')}</p>
          </div>
          <button onClick={disconnect} disabled={busy} className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-muted hover:bg-white disabled:opacity-50">
            ยกเลิกการเชื่อมต่อ
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {st.needsReconnect && (
            <p className="rounded-lg bg-attention-soft border border-line px-3 py-2 text-xs text-attention">
              การเชื่อมต่อเดิม ({st.account?.displayName}) หมดอายุหรือถูกยกเลิก — ตอนนี้ใช้บัญชีกลางอยู่ กดเชื่อมต่อใหม่
            </p>
          )}
          <button onClick={connect} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:opacity-50">
            {busy ? 'กำลังไปที่ Atlassian...' : st.needsReconnect ? 'เชื่อมต่อใหม่' : 'เชื่อมบัญชี Jira'}
          </button>
        </div>
      )}

      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-ok' : 'text-danger'}`}>{msg.text}</p>
      )}
      {st?.connected && (
        <p className="text-[11px] text-faint">
          การยกเลิกที่นี่จะลบ token ออกจากระบบ ถ้าต้องการถอนสิทธิ์ที่ฝั่ง Atlassian ด้วย ไปที่ id.atlassian.com → Connected apps
        </p>
      )}
    </section>
  )
}
