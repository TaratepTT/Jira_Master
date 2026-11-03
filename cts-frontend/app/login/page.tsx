'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import ThemeToggle from '@/components/theme/ThemeToggle'

export default function LoginPage() {
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await login(identifier, password)
    if (!result.ok) setError(result.message ?? 'Login ไม่สำเร็จ')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4 transition-colors">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">CTS<span className="font-medium text-muted"> Report</span></p>
          <h1 className="mt-6 text-[24px] font-semibold leading-tight text-ink">เข้าสู่ระบบ</h1>
          <p className="mt-1 text-[14px] text-muted">รายงาน ticket ของทีม Tech Support จาก Jira</p>
        </div>

        <form onSubmit={handleSubmit} className="panel space-y-4 p-6">
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-ink">อีเมล หรือ Username</label>
            <input
              type="text"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              required
              autoFocus
              className="field py-2.5 text-[14px]"
              placeholder="you@allnow.co.th"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-ink">รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="field py-2.5 text-[14px]"
              
            />
          </div>

          {error && (
            <div className="rounded-md border border-line bg-danger-soft px-3 py-2">
              <p className="text-[13px] text-danger">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="btn-primary w-full py-2.5 text-[14px]"
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p className="mt-5 text-[14px] text-muted">
          ยังไม่มีบัญชี?{' '}
          <Link href="/register" className="link font-medium">ขอสร้างบัญชี</Link>
        </p>
      </div>
    </div>
  )
}
