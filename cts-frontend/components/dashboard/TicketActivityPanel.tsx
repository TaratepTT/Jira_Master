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

// Short file-type tag shown in place of an icon (e.g. PDF, PNG, XLSX)
function fileTag(mimeType: string, filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toUpperCase() : ''
  if (ext && ext.length <= 4) return ext
  if (mimeType.startsWith('image/')) return 'IMG'
  if (mimeType.includes('pdf')) return 'PDF'
  return 'FILE'
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
      <div className="mt-2 rounded-lg overflow-hidden border border-line bg-sunken">
        {previewLoading ? (
          <div className="flex items-center justify-center h-40">
            <svg className="h-5 w-5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
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
          <pre className="text-[11px] text-ink p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words font-mono">
            {previewText.slice(0, 20000)}{previewText.length > 20000 ? '\n\n… (ตัดข้อความที่เกิน 20,000 ตัวอักษร)' : ''}
          </pre>
        ) : type === 'office' && previewText === '__office__' ? (
          <div className="flex flex-col items-center justify-center h-36 gap-2 text-faint text-xs">
            <span className="rounded border border-line-strong px-2 py-1 text-[11px] font-semibold text-muted">{fileTag(a.mimeType, a.filename)}</span>
            <p>ไม่สามารถ preview ไฟล์ Office ได้โดยตรง</p>
            <button
              onClick={() => handleDownload(a)}
              disabled={downloadingId === a.id}
              className="rounded-lg border border-line-strong px-3 py-1 text-[11px] font-medium text-muted hover:bg-sunken disabled:opacity-40 transition-colors"
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
    <div className="rounded-lg border border-line overflow-hidden">
      <div className="flex border-b border-line">
        <button
          onClick={() => setTab('comments')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'comments'
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:bg-sunken'
          }`}
        >
          Comments {comments.length > 0 && `(${comments.length})`}
        </button>
        <button
          onClick={() => setTab('changelog')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'changelog'
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:bg-sunken'
          }`}
        >
          History {changelog.length > 0 && `(${changelog.length})`}
        </button>
        <button
          onClick={() => setTab('attachments')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'attachments'
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:bg-sunken'
          }`}
        >
          Files {attachments.length > 0 && `(${attachments.length})`}
        </button>
      </div>

      <div className="p-3 max-h-[32rem] overflow-y-auto space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-sunken animate-pulse" />)}
          </div>
        ) : error ? (
          <p className="text-xs text-danger text-center py-4">{error}</p>
        ) : tab === 'comments' ? (
          comments.length === 0 ? (
            <p className="text-xs text-faint text-center py-4">ยังไม่มี comment</p>
          ) : (
            comments.map(c => (
              <div key={c.id} className="rounded-lg bg-sunken p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-ink">{c.author}</span>
                  <span className="text-[11px] text-faint">{formatActivityDate(c.created)}</span>
                </div>
                <p className="text-xs text-muted whitespace-pre-wrap">{c.body}</p>
              </div>
            ))
          )
        ) : tab === 'changelog' ? (
          changelog.length === 0 ? (
            <p className="text-xs text-faint text-center py-4">ไม่มีประวัติการเปลี่ยนแปลง</p>
          ) : (
            changelog.map(entry => (
              <div key={entry.id} className="rounded-lg bg-sunken p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-ink">{entry.author}</span>
                  <span className="text-[11px] text-faint">{formatActivityDate(entry.created)}</span>
                </div>
                {entry.changes.map((c, i) => (
                  <p key={i} className="text-xs text-muted">
                    <span className="font-medium">{c.field}</span>: {c.from} → <span className="text-accent">{c.to}</span>
                  </p>
                ))}
              </div>
            ))
          )
        ) : (
          // ── Files / Attachments tab ────────────────────────────
          attachments.length === 0 ? (
            <p className="text-xs text-faint text-center py-4">ไม่มีไฟล์แนบ</p>
          ) : (
            attachments.map(a => (
              <div key={a.id}>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-sunken p-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-11 shrink-0 rounded border border-line-strong py-1 text-center text-[10px] font-semibold text-muted">{fileTag(a.mimeType, a.filename)}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink truncate">{a.filename}</p>
                      <p className="text-[11px] text-faint">{formatFileSize(a.size)} · {a.author} · {formatActivityDate(a.created)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Preview toggle */}
                    <button
                      onClick={() => handleTogglePreview(a)}
                      disabled={previewLoading && previewId === a.id}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                        previewId === a.id
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line-strong text-muted hover:bg-sunken'
                      }`}
                    >
                      {previewLoading && previewId === a.id ? '...' : previewId === a.id ? 'ปิด' : 'ดู'}
                    </button>
                    {/* Download */}
                    <button
                      onClick={() => handleDownload(a)}
                      disabled={downloadingId === a.id}
                      className="rounded-lg border border-line-strong px-2 py-1 text-[11px] font-medium text-muted hover:bg-sunken disabled:opacity-40 transition-colors"
                    >
                      {downloadingId === a.id ? '...' : 'ดาวน์โหลด'}
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
        <div className="border-t border-line p-2 flex items-center gap-2">
          <input
            type="text"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePostComment()}
            placeholder="เพิ่ม comment..."
            disabled={posting}
            className="flex-1 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
          />
          <button
            onClick={handlePostComment}
            disabled={posting || !newComment.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-strong disabled:opacity-40 transition-colors"
          >
            {posting ? '...' : 'ส่ง'}
          </button>
        </div>
      )}
    </div>
    </>
  )
}
