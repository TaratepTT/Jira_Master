'use client'

import { useEffect, useRef, useState } from 'react'
import {
  getTicketActivity, addTicketComment, getTicketAttachments, downloadTicketAttachment,
  fetchAttachmentBlobUrl, fetchAttachmentText,
  type TicketComment, type TicketChangelogEntry, type TicketAttachment,
} from '@/lib/api'
import { useAuth } from '@/components/auth/AuthContext'

// ── Ticket Activity Panel (Comments + Changelog + Files) ────────
function formatActivityDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊'
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝'
  return '📎'
}

function getPreviewType(mimeType: string, filename: string): 'image' | 'pdf' | 'text' | 'office' | 'none' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.includes('pdf')) return 'pdf'
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['txt', 'csv', 'json', 'xml', 'log', 'md'].includes(ext)) return 'text'
  if (['xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt'].includes(ext)) return 'office'
  return 'none'
}

export default function TicketActivityPanel({ reportId, ticketKey }: { reportId: string; ticketKey: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [comments, setComments] = useState<TicketComment[]>([])
  const [changelog, setChangelog] = useState<TicketChangelogEntry[]>([])
  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const { canEdit } = useAuth()
  const [tab, setTab] = useState<'comments' | 'changelog' | 'attachments'>('comments')
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  // ── Preview state ─────────────────────────────────────────────
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const prevBlobRef = useRef<string | null>(null)
  // ── Lightbox state ────────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError('')
    Promise.all([
      getTicketActivity(reportId, ticketKey),
      getTicketAttachments(reportId, ticketKey),
    ])
      .then(([activity, attach]) => {
        setComments(activity.comments)
        setChangelog(activity.changelog)
        setAttachments(attach.attachments)
      })
      .catch(() => setError('โหลดประวัติไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [reportId, ticketKey])

  // Revoke blob URL on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (prevBlobRef.current) window.URL.revokeObjectURL(prevBlobRef.current)
    }
  }, [])

  const handlePostComment = async () => {
    if (!newComment.trim()) return
    setPosting(true)
    try {
      const result = await addTicketComment(reportId, ticketKey, newComment.trim())
      setComments(result.comments)
      setNewComment('')
    } catch {
      setError('เพิ่ม comment ไม่สำเร็จ')
    } finally {
      setPosting(false)
    }
  }

  const handleDownload = async (attachment: TicketAttachment) => {
    setDownloadingId(attachment.id)
    try {
      await downloadTicketAttachment(reportId, ticketKey, attachment)
    } catch {
      setError('ดาวน์โหลดไฟล์ไม่สำเร็จ')
    } finally {
      setDownloadingId(null)
    }
  }

  const handleTogglePreview = async (a: TicketAttachment) => {
    // Close preview if already open
    if (previewId === a.id) {
      setPreviewId(null)
      setPreviewBlobUrl(null)
      setPreviewText(null)
      if (prevBlobRef.current) {
        window.URL.revokeObjectURL(prevBlobRef.current)
        prevBlobRef.current = null
      }
      return
    }

    setPreviewId(a.id)
    setPreviewBlobUrl(null)
    setPreviewText(null)
    setPreviewLoading(true)

    try {
      const type = getPreviewType(a.mimeType, a.filename)
      if (type === 'text') {
        const text = await fetchAttachmentText(reportId, ticketKey, a.id)
        setPreviewText(text)
      } else if (type === 'image' || type === 'pdf') {
        const url = await fetchAttachmentBlobUrl(reportId, ticketKey, a.id)
        if (prevBlobRef.current) window.URL.revokeObjectURL(prevBlobRef.current)
        prevBlobRef.current = url
        setPreviewBlobUrl(url)
      } else if (type === 'office') {
        // Office files require a public URL for external viewers — fall back to download
        setPreviewText('__office__')
      } else {
        // Unknown type — just download
        await handleDownload(a)
        setPreviewId(null)
      }
    } catch {
      setError('โหลด preview ไม่สำเร็จ')
      setPreviewId(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const renderPreview = (a: TicketAttachment) => {
    if (previewId !== a.id) return null
    const type = getPreviewType(a.mimeType, a.filename)

    return (
      <div className="mt-2 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900">
        {previewLoading ? (
          <div className="flex items-center justify-center h-40">
            <svg className="h-5 w-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : type === 'image' && previewBlobUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewBlobUrl}
            alt={a.filename}
            onClick={() => setLightboxUrl(previewBlobUrl)}
            className="max-w-full max-h-96 object-contain mx-auto block p-2 cursor-zoom-in hover:opacity-90 transition-opacity"
          />
        ) : type === 'pdf' && previewBlobUrl ? (
          <iframe
            src={previewBlobUrl}
            title={a.filename}
            className="w-full h-96 border-0"
          />
        ) : type === 'text' && previewText ? (
          <pre className="text-[11px] text-slate-700 dark:text-slate-300 p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words font-mono">
            {previewText.slice(0, 20000)}{previewText.length > 20000 ? '\n\n… (ตัดข้อความที่เกิน 20,000 ตัวอักษร)' : ''}
          </pre>
        ) : type === 'office' && previewText === '__office__' ? (
          <div className="flex flex-col items-center justify-center h-36 gap-2 text-slate-400 text-xs">
            <span className="text-3xl">{attachmentIcon(a.mimeType)}</span>
            <p>ไม่สามารถ preview ไฟล์ Office ได้โดยตรง</p>
            <button
              onClick={() => handleDownload(a)}
              disabled={downloadingId === a.id}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
            >
              {downloadingId === a.id ? '...' : 'ดาวน์โหลดแทน'}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
    {/* ── Lightbox overlay ───────────────────────────────────────── */}
    {lightboxUrl && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
        onClick={() => setLightboxUrl(null)}
      >
        <button
          onClick={() => setLightboxUrl(null)}
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
        >
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={lightboxUrl}
          alt="preview"
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        />
      </div>
    )}
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setTab('comments')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'comments'
              ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
          }`}
        >
          Comments {comments.length > 0 && `(${comments.length})`}
        </button>
        <button
          onClick={() => setTab('changelog')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'changelog'
              ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
          }`}
        >
          History {changelog.length > 0 && `(${changelog.length})`}
        </button>
        <button
          onClick={() => setTab('attachments')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'attachments'
              ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
          }`}
        >
          Files {attachments.length > 0 && `(${attachments.length})`}
        </button>
      </div>

      <div className="p-3 max-h-[32rem] overflow-y-auto space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-slate-100 dark:bg-slate-700 animate-pulse" />)}
          </div>
        ) : error ? (
          <p className="text-xs text-red-500 text-center py-4">{error}</p>
        ) : tab === 'comments' ? (
          comments.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">ยังไม่มี comment</p>
          ) : (
            comments.map(c => (
              <div key={c.id} className="rounded-lg bg-slate-50 dark:bg-slate-700/50 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{c.author}</span>
                  <span className="text-[11px] text-slate-400">{formatActivityDate(c.created)}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))
          )
        ) : tab === 'changelog' ? (
          changelog.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">ไม่มีประวัติการเปลี่ยนแปลง</p>
          ) : (
            changelog.map(entry => (
              <div key={entry.id} className="rounded-lg bg-slate-50 dark:bg-slate-700/50 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{entry.author}</span>
                  <span className="text-[11px] text-slate-400">{formatActivityDate(entry.created)}</span>
                </div>
                {entry.changes.map((c, i) => (
                  <p key={i} className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium">{c.field}</span>: {c.from} → <span className="text-blue-600 dark:text-blue-400">{c.to}</span>
                  </p>
                ))}
              </div>
            ))
          )
        ) : (
          // ── Files / Attachments tab ────────────────────────────
          attachments.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">ไม่มีไฟล์แนบ</p>
          ) : (
            attachments.map(a => (
              <div key={a.id}>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 p-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg flex-shrink-0">{attachmentIcon(a.mimeType)}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{a.filename}</p>
                      <p className="text-[11px] text-slate-400">{formatFileSize(a.size)} · {a.author} · {formatActivityDate(a.created)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Preview toggle */}
                    <button
                      onClick={() => handleTogglePreview(a)}
                      disabled={previewLoading && previewId === a.id}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                        previewId === a.id
                          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                          : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'
                      }`}
                    >
                      {previewLoading && previewId === a.id ? '...' : previewId === a.id ? 'ปิด' : 'ดู'}
                    </button>
                    {/* Download */}
                    <button
                      onClick={() => handleDownload(a)}
                      disabled={downloadingId === a.id}
                      className="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 disabled:opacity-40 transition-colors"
                    >
                      {downloadingId === a.id ? '...' : '⬇'}
                    </button>
                  </div>
                </div>
                {renderPreview(a)}
              </div>
            ))
          )
        )}
      </div>

      {tab === 'comments' && canEdit && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-2 flex items-center gap-2">
          <input
            type="text"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePostComment()}
            placeholder="เพิ่ม comment..."
            disabled={posting}
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500"
          />
          <button
            onClick={handlePostComment}
            disabled={posting || !newComment.trim()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {posting ? '...' : 'ส่ง'}
          </button>
        </div>
      )}
    </div>
    </>
  )
}
