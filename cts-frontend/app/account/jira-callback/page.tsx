'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { completeJiraConnection } from '@/lib/api'

// Atlassian sends the browser here after the user approved (or declined) access.
// This page — already logged in to the Dashboard — hands code+state to the backend, which
// checks that the state was created by THIS user before saving the connection.
function JiraCallbackInner() {
  const params = useSearchParams()
  const router = useRouter()
  const [error, setError] = useState('')
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    const denied = params.get('error')
    const code = params.get('code')
    const state = params.get('state')
    if (denied) { setError(denied === 'access_denied' ? 'คุณกดไม่อนุญาตที่หน้า Atlassian — ยังไม่ได้เชื่อมต่อ' : `Atlassian แจ้งข้อผิดพลาด: ${denied}`); return }
    if (!code || !state) { setError('ไม่พบรหัสยืนยันจาก Atlassian'); return }
    completeJiraConnection(code, state)
      .then(r => router.replace(`/account?jira=${encodeURIComponent(r.message)}`))
      .catch(e => setError(e?.response?.data?.message ?? 'เชื่อมต่อไม่สำเร็จ'))
  }, [params, router])

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="max-w-sm text-center space-y-3">
        {error ? (
          <>
            <p className="text-red-600 dark:text-red-400 font-medium">{error}</p>
            <Link href="/account" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">กลับไปหน้าบัญชีของฉัน</Link>
          </>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">กำลังเชื่อมบัญชี Jira...</p>
        )}
      </div>
    </div>
  )
}

export default function JiraCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-900" />}>
      <JiraCallbackInner />
    </Suspense>
  )
}
