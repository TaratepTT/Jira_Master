'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// App-styled replacements for window.confirm / window.alert.
//   const { confirm, notify } = useDialog()
//   if (!(await confirm({ title: 'ลบ report?', message: '…', confirmLabel: 'ลบ report', tone: 'danger' }))) return
//   await notify({ title: 'ลบไม่สำเร็จ', message: '…', tone: 'danger' })

type Tone = 'danger' | 'primary'
export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** what is affected, shown in a quiet box (e.g. the report name and its ticket count) */
  detail?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: Tone
}
export interface NotifyOptions { title: string; message?: ReactNode; tone?: Tone | 'ok'; okLabel?: string }

interface Ctx { confirm: (o: ConfirmOptions) => Promise<boolean>; notify: (o: NotifyOptions) => Promise<void> }
const DialogCtx = createContext<Ctx | null>(null)

type Open =
  | { kind: 'confirm'; o: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'notify'; o: NotifyOptions; resolve: () => void }

const PATH = {
  danger: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0',
  primary: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
  ok: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  dangerAlert: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>(resolve => setOpen({ kind: 'confirm', o, resolve })), [])
  const notify = useCallback((o: NotifyOptions) => new Promise<void>(resolve => setOpen({ kind: 'notify', o, resolve })), [])
  return (
    <DialogCtx.Provider value={{ confirm, notify }}>
      {children}
      {open && <DialogView open={open} onDone={() => setOpen(null)} />}
    </DialogCtx.Provider>
  )
}

export function useDialog(): Ctx {
  const c = useContext(DialogCtx)
  if (c) return c
  // outside the provider (tests, storybook): fall back to the browser's own boxes
  return {
    confirm: async o => window.confirm([o.title, typeof o.message === 'string' ? o.message : ''].filter(Boolean).join('\n')),
    notify: async o => { window.alert(o.title) },
  }
}

function DialogView({ open, onDone }: { open: Open; onDone: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const primaryBtn = useRef<HTMLButtonElement>(null)
  const cancelBtn = useRef<HTMLButtonElement>(null)
  const isConfirm = open.kind === 'confirm'
  const tone = open.o.tone ?? 'primary'
  const close = useCallback((v: boolean) => {
    if (open.kind === 'confirm') open.resolve(v); else open.resolve()
    onDone()
  }, [open, onDone])

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    // destructive: start on "cancel" so Enter never deletes by accident
    ;(isConfirm && tone === 'danger' ? cancelBtn.current : primaryBtn.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false) }
      if (e.key === 'Tab' && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>('button')]
        const i = f.indexOf(document.activeElement as HTMLElement)
        e.preventDefault()
        f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length]?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.() }
  }, [close, isConfirm, tone])

  const iconPath = tone === 'danger' ? (isConfirm ? PATH.danger : PATH.dangerAlert) : tone === 'ok' ? PATH.ok : PATH.primary
  const iconTone = tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent'
  const o = open.o

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center" data-testid="app-dialog">
      <div className="dialog-backdrop absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => close(false)} aria-hidden />
      <div
        ref={panel}
        role={isConfirm ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby={o.message ? 'app-dialog-msg' : undefined}
        className="dialog-panel pop relative w-full max-w-[420px] rounded-[14px] border border-line bg-surface p-5 sm:p-6"
      >
        <div className="flex gap-4">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconTone}`} aria-hidden>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}><path strokeLinecap="round" strokeLinejoin="round" d={iconPath} /></svg>
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="app-dialog-title" className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">{o.title}</h2>
            {o.message && <div id="app-dialog-msg" className="mt-1.5 text-[14px] leading-relaxed text-muted">{o.message}</div>}
            {isConfirm && (o as ConfirmOptions).detail && (
              <div className="mt-3 rounded-md border border-line bg-sunken px-3 py-2 text-[13px] text-ink [overflow-wrap:anywhere]">{(o as ConfirmOptions).detail}</div>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {isConfirm && (
            <button ref={cancelBtn} type="button" onClick={() => close(false)} className="btn h-9 px-4">
              {(o as ConfirmOptions).cancelLabel ?? 'ยกเลิก'}
            </button>
          )}
          <button
            ref={primaryBtn}
            type="button"
            onClick={() => close(true)}
            className={`${tone === 'danger' && isConfirm ? 'btn-danger' : 'btn-primary'} h-9 px-4`}
            data-testid="app-dialog-confirm"
          >
            {isConfirm ? (o as ConfirmOptions).confirmLabel ?? 'ยืนยัน' : (o as NotifyOptions).okLabel ?? 'ตกลง'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
