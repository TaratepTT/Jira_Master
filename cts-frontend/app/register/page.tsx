'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/auth/AuthContext'
import ThemeToggle from '@/components/theme/ThemeToggle'

const inputCls =
  'field py-2.5 text-[14px]'

export default function RegisterPage() {
  const { register } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Same rules as the server, so the user gets instant feedback.
    if (password.length < 8) return setError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')
    if (new TextEncoder().encode(password).length > 72) return setError('รหัสผ่านยาวเกินไป (ไม่เกิน 72 ไบต์ — ภาษาไทยได้ประมาณ 24 ตัวอักษร)')
    if (password !== confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')

    setLoading(true)
    const result = await register(email, name, password)
    setLoading(false)
    if (result.ok) setDone(result.message)
    else setError(result.message)
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4 py-10 transition-colors">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">CTS<span className="font-medium text-muted"> Report</span></p>
          <h1 className="mt-6 text-[24px] font-semibold leading-tight text-ink">ขอสร้างบัญชี</h1>
          <p className="mt-1 text-[14px] text-muted">ผู้ดูแลระบบจะอนุมัติก่อนใช้งานได้</p>
        </div>

        {done ? (
          <div className="panel space-y-4 p-6">
            <p className="text-[14px] text-ink">{done}</p>
            <Link href="/login" className="btn-primary">
              กลับไปหน้าเข้าสู่ระบบ
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="panel space-y-4 p-6">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-ink">ชื่อ-นามสกุล</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus maxLength={80} className={inputCls} placeholder="ชื่อที่ใช้แสดงในระบบ" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-ink">อีเมล</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={inputCls} placeholder="you@allnow.co.th" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-ink">รหัสผ่าน</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" className={inputCls} placeholder="อย่างน้อย 8 ตัวอักษร" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-ink">ยืนยันรหัสผ่าน</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" className={inputCls} placeholder="กรอกรหัสผ่านอีกครั้ง" />
              </div>

              {error && (
                <div className="rounded-lg bg-sunken border border-line px-3 py-2">
                  <p className="text-xs text-danger">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} aria-busy={loading} className="btn-primary w-full py-2.5 text-[14px]">
                {loading ? 'กำลังสมัคร...' : 'สมัครสมาชิก'}
              </button>
            </form>

            <p className="mt-5 text-[14px] text-muted">
              มีบัญชีแล้ว?{' '}
              <Link href="/login" className="link font-medium">เข้าสู่ระบบ</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
