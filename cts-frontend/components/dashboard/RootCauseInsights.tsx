'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/auth/AuthContext'
import ExpandableKeys from '@/components/dashboard/ExpandableKeys'
import {
  getRootCauseInsight, generateRootCauseInsight,
  type InsightStatus, type RootCauseInsight,
} from '@/lib/api'

function errMsg(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string } }; code?: string }
  if (err?.code === 'ECONNABORTED') return 'AI ใช้เวลานานเกินไป — ลองใหม่อีกครั้ง'
  return err?.response?.data?.message ?? fallback
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const SparkIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
  </svg>
)

export default function RootCauseInsights({ reportId }: { reportId: string }) {
  const { canEdit } = useAuth()
  const [status, setStatus] = useState<InsightStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    try {
      setStatus(await getRootCauseInsight(reportId))
      setError('')
    } catch (e) {
      setError(errMsg(e, 'โหลดสรุป AI ไม่สำเร็จ'))
    } finally {
      setLoading(false)
    }
  }, [reportId])

  useEffect(() => { load() }, [load])

  const generate = async () => {
    setGenerating(true)
    setError('')
    try {
      const insight: RootCauseInsight = await generateRootCauseInsight(reportId)
      setStatus(s => s && { ...s, latest: insight, dailyRemaining: Math.max(0, s.dailyRemaining - 1) })
      setConfirming(false)
    } catch (e) {
      setError(errMsg(e, 'สร้างสรุปไม่สำเร็จ'))
    } finally {
      setGenerating(false)
    }
  }

  const latest = status?.latest ?? null
  const preview = status?.preview
  const canRun = !!status?.enabled && !!preview && preview.willAnalyse >= 2 && status.dailyRemaining > 0

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <span className="text-violet-500"><SparkIcon /></span>
          AI สรุป Root Cause ที่เกิดซ้ำ
          <span className="rounded-full bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">Beta</span>
        </h2>
        {canEdit && status?.enabled && !confirming && (
          <button
            onClick={() => { setError(''); setConfirming(true) }}
            disabled={!canRun || generating}
            title={!canRun ? (status.dailyRemaining <= 0 ? 'ใช้โควตาวันนี้ครบแล้ว' : 'ต้องมี ticket ที่กรอก Root Cause/Resolution อย่างน้อย 2 รายการ') : undefined}
            className="rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 px-3 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {latest ? 'สร้างสรุปใหม่' : 'สร้างสรุปด้วย AI'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-700" />
      ) : (
        <div className="space-y-4">
          {/* Confirm-before-sending panel */}
          {confirming && status && preview && (
            <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/60 dark:bg-violet-950/20 p-4 space-y-3">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">ข้อมูลที่จะถูกส่งออกไปยัง Anthropic API</p>
              <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <li>
                  ข้อความ <strong>Root Cause / Resolution / Summary</strong> ของ <strong>{preview.willAnalyse}</strong> ticket
                  (รวมข้อความที่ซ้ำกันแล้วเหลือ <strong>{preview.uniqueEntries}</strong> รายการ)
                </li>
                <li>ระบบปกปิด <strong>อีเมล เบอร์โทร ลิงก์ และเลขยาว 9 หลักขึ้นไป</strong> (เช่น เลขบัตร) ก่อนส่ง</li>
                <li>ไม่ส่งชื่อผู้รับผิดชอบ ผู้แจ้ง หรือ ticket key</li>
                <li className="text-orange-700 dark:text-orange-300">
                  <strong>ปกปิดชื่อคนในข้อความอิสระไม่ได้</strong> — หาก Root Cause มีชื่อบุคคล ชื่อนั้นจะถูกส่งไปด้วย
                </li>
              </ul>
              {preview.truncated && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ข้อความที่ไม่ซ้ำกันมีมากเกินเพดาน ระบบจะส่งเฉพาะข้อความที่ซ้ำมากที่สุดก่อน
                </p>
              )}
              <p className="text-[11px] text-slate-400">
                โมเดล: {status.model} · โควตาวันนี้เหลือ {status.dailyRemaining} ครั้ง · ใช้เวลาประมาณ 20–60 วินาที
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={generate}
                  disabled={generating}
                  className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60 transition-colors"
                >
                  {generating && (
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {generating ? 'กำลังวิเคราะห์...' : 'ยืนยันและสร้างสรุป'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={generating}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-3 py-2">
              <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {!status?.enabled && !error && (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              ยังไม่ได้เปิดใช้ฟีเจอร์ AI — ผู้ดูแลระบบต้องตั้งค่า <code className="rounded bg-slate-100 dark:bg-slate-700 px-1">ANTHROPIC_API_KEY</code> บน server
            </p>
          )}

          {status?.enabled && !latest && !confirming && (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              {canEdit
                ? 'ยังไม่มีสรุปของ report นี้ — กด "สร้างสรุปด้วย AI" เพื่อให้ AI จัดกลุ่ม Root Cause ที่เกิดซ้ำ'
                : 'ยังไม่มีสรุปของ report นี้ — ให้ Editor หรือ Admin เป็นผู้สร้าง'}
            </p>
          )}

          {latest && (
            <>
              {latest.result.overview && (
                <p className="rounded-xl bg-slate-50 dark:bg-slate-700/40 px-4 py-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  {latest.result.overview}
                </p>
              )}

              {latest.result.themes.length === 0 ? (
                <p className="text-sm text-slate-400">AI ไม่พบรูปแบบที่เกิดซ้ำอย่างชัดเจนใน report นี้</p>
              ) : (
                <div className="space-y-3">
                  {latest.result.themes.map((t, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          <span className="mr-2 text-slate-400">{i + 1}.</span>{t.title}
                        </p>
                        <span className="flex-shrink-0 rounded-full bg-violet-100 dark:bg-violet-900/40 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                          {t.count} tickets
                        </span>
                      </div>
                      {t.description && <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{t.description}</p>}
                      {t.suggestedAction && (
                        <p className="text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
                          <span className="font-semibold">ข้อเสนอแนะ: </span>{t.suggestedAction}
                        </p>
                      )}
                      <ExpandableKeys keys={t.ticketKeys} />
                    </div>
                  ))}
                </div>
              )}

              {latest.result.ungroupedCount > 0 && (
                <p className="text-xs text-slate-400">
                  อีก {latest.result.ungroupedCount} ticket (จาก {latest.result.analysed} ที่วิเคราะห์) เป็นปัญหาเดี่ยวที่ไม่ซ้ำกับรายการอื่น
                </p>
              )}

              <p className="border-t border-slate-100 dark:border-slate-700 pt-3 text-[11px] text-slate-400">
                สร้างโดย AI เมื่อ {fmt(latest.createdAt)}{latest.createdBy ? ` · ${latest.createdBy}` : ''} · {latest.model}
                {latest.inputTokens != null && latest.outputTokens != null
                  ? ` · ใช้ ${latest.inputTokens.toLocaleString()} + ${latest.outputTokens.toLocaleString()} tokens` : ''}
                {' '}· ควรตรวจสอบกับ ticket จริงก่อนนำไปใช้ตัดสินใจ
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
