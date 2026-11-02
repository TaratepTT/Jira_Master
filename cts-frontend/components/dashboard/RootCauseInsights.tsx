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

  // Feature off (no ANTHROPIC_API_KEY on the server) or not yet known -> render nothing, for every role.
  // The card appears on its own once the server has the key.
  if (loading || !status?.enabled) return null

  return (
    <div className="panel panel-pad">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="section-title">Root Cause ที่เกิดซ้ำ</h2>
          <p className="section-note mt-0.5">AI จัดกลุ่มจากข้อความ Root Cause และ Resolution ของ report นี้ ควรตรวจกับ ticket จริงก่อนใช้</p>
        </div>
        {canEdit && status?.enabled && !confirming && (
          <button
            onClick={() => { setError(''); setConfirming(true) }}
            disabled={!canRun || generating}
            title={!canRun ? (status.dailyRemaining <= 0 ? 'ใช้โควตาวันนี้ครบแล้ว' : 'ต้องมี ticket ที่กรอก Root Cause/Resolution อย่างน้อย 2 รายการ') : undefined}
            className="btn"
          >
            {latest ? 'สร้างสรุปใหม่' : 'สร้างสรุปด้วย AI'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-16 animate-pulse rounded-lg bg-sunken" />
      ) : (
        <div className="space-y-4">
          {/* Confirm-before-sending panel */}
          {confirming && status && preview && (
            <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
              <p className="text-sm font-medium text-ink">ข้อมูลที่จะถูกส่งออกไปยัง Anthropic API</p>
              <ul className="list-disc pl-5 space-y-1 text-xs text-muted">
                <li>
                  ข้อความ <strong>Root Cause / Resolution / Summary</strong> ของ <strong>{preview.willAnalyse}</strong> ticket
                  (รวมข้อความที่ซ้ำกันแล้วเหลือ <strong>{preview.uniqueEntries}</strong> รายการ)
                </li>
                <li>ระบบปกปิด <strong>อีเมล เบอร์โทร ลิงก์ และเลขยาว 9 หลักขึ้นไป</strong> (เช่น เลขบัตร) ก่อนส่ง</li>
                <li>ไม่ส่งชื่อผู้รับผิดชอบ ผู้แจ้ง หรือ ticket key</li>
                <li className="text-attention">
                  <strong>ปกปิดชื่อคนในข้อความอิสระไม่ได้</strong> — หาก Root Cause มีชื่อบุคคล ชื่อนั้นจะถูกส่งไปด้วย
                </li>
              </ul>
              {preview.truncated && (
                <p className="text-xs text-muted">
                  ข้อความที่ไม่ซ้ำกันมีมากเกินเพดาน ระบบจะส่งเฉพาะข้อความที่ซ้ำมากที่สุดก่อน
                </p>
              )}
              <p className="text-[11px] text-faint">
                โมเดล: {status.model} · โควตาวันนี้เหลือ {status.dailyRemaining} ครั้ง · ใช้เวลาประมาณ 20–60 วินาที
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={generate}
                  disabled={generating}
                  className="btn-primary"
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
                  className="btn"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-line bg-sunken px-3 py-2">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}

          {!status?.enabled && !error && (
            <p className="text-sm text-faint">
              ยังไม่ได้เปิดใช้ฟีเจอร์ AI — ผู้ดูแลระบบต้องตั้งค่า <code className="rounded bg-sunken px-1">ANTHROPIC_API_KEY</code> บน server
            </p>
          )}

          {status?.enabled && !latest && !confirming && (
            <p className="text-sm text-faint">
              {canEdit
                ? 'ยังไม่มีสรุปของ report นี้ — กด "สร้างสรุปด้วย AI" เพื่อให้ AI จัดกลุ่ม Root Cause ที่เกิดซ้ำ'
                : 'ยังไม่มีสรุปของ report นี้ — ให้ Editor หรือ Admin เป็นผู้สร้าง'}
            </p>
          )}

          {latest && (
            <>
              {latest.result.overview && (
                <p className="rounded-lg bg-sunken px-4 py-3 text-sm leading-relaxed text-ink">
                  {latest.result.overview}
                </p>
              )}

              {latest.result.themes.length === 0 ? (
                <p className="text-sm text-faint">AI ไม่พบรูปแบบที่เกิดซ้ำอย่างชัดเจนใน report นี้</p>
              ) : (
                <div className="space-y-3">
                  {latest.result.themes.map((t, i) => (
                    <div key={i} className="rounded-lg border border-line p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-ink">
                          {t.title}
                        </p>
                        <span className="flex-shrink-0 text-[13px] text-muted num">{t.count} tickets</span>
                      </div>
                      {t.description && <p className="text-xs leading-relaxed text-muted">{t.description}</p>}
                      {t.suggestedAction && (
                        <p className="text-xs leading-relaxed text-ink">
                          <span className="font-semibold">ควรทำ: </span>{t.suggestedAction}
                        </p>
                      )}
                      <ExpandableKeys keys={t.ticketKeys} />
                    </div>
                  ))}
                </div>
              )}

              {latest.result.ungroupedCount > 0 && (
                <p className="text-xs text-faint">
                  อีก {latest.result.ungroupedCount} ticket (จาก {latest.result.analysed} ที่วิเคราะห์) เป็นปัญหาเดี่ยวที่ไม่ซ้ำกับรายการอื่น
                </p>
              )}

              <p className="border-t border-line pt-3 text-[11px] text-faint">
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
