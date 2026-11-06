'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Short confirmations in the bottom-right corner ("บันทึกแล้ว", "ส่งให้ L1 แล้ว").
//   const toast = useToast()
//   toast.show({ text: 'บันทึกเป้าเวลาแล้ว' })
//   // delete with undo: nothing is sent to the server until the toast runs out
//   toast.undoable({ text: 'ลบคู่มือแล้ว', commit: () => deletePlaybook(id), onUndo: () => restoreRow() })

type Tone = 'ok' | 'danger' | 'info'
interface ToastItem { id: number; text: ReactNode; tone: Tone; action?: { label: string; onClick: () => void }; ms: number }
interface ShowOptions { text: ReactNode; tone?: Tone; action?: { label: string; onClick: () => void }; ms?: number }
interface UndoOptions { text: ReactNode; commit: () => Promise<unknown> | void; onUndo?: () => void; onError?: (e: unknown) => void; ms?: number }
interface Ctx { show: (o: ShowOptions) => void; undoable: (o: UndoOptions) => void }

const ToastCtx = createContext<Ctx | null>(null)
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dismiss = useCallback((id: number) => setItems(list => list.filter(t => t.id !== id)), [])
  const show = useCallback((o: ShowOptions) => {
    const id = ++seq
    setItems(list => [...list.slice(-3), { id, text: o.text, tone: o.tone ?? 'ok', action: o.action, ms: o.ms ?? 4000 }])
  }, [])
  const undoable = useCallback((o: UndoOptions) => {
    const id = ++seq
    let undone = false
    const ms = o.ms ?? 6000
    const timer = setTimeout(async () => {
      if (undone) return
      try { await o.commit() } catch (e) { o.onError?.(e) }
    }, ms)
    setItems(list => [...list.slice(-3), {
      id, text: o.text, tone: 'info', ms,
      action: { label: 'เลิกทำ', onClick: () => { undone = true; clearTimeout(timer); o.onUndo?.(); setItems(l => l.filter(t => t.id !== id)) } },
    }])
  }, [])

  return (
    <ToastCtx.Provider value={{ show, undoable }}>
      {children}
      {mounted && createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex flex-col items-center gap-2 p-4 sm:items-end" role="region" aria-label="การแจ้งเตือน">
          {items.map(t => <ToastView key={t.id} item={t} onDone={() => dismiss(t.id)} />)}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function useToast(): Ctx {
  return useContext(ToastCtx) ?? { show: () => undefined, undoable: o => { void o.commit() } }
}

function ToastView({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const [paused, setPaused] = useState(false)
  const left = useRef(item.ms)
  const started = useRef(Date.now())
  useEffect(() => {
    if (paused) { left.current -= Date.now() - started.current; return }
    started.current = Date.now()
    const t = setTimeout(onDone, left.current)
    return () => clearTimeout(t)
  }, [paused, onDone])
  const dot = item.tone === 'danger' ? 'bg-danger' : item.tone === 'ok' ? 'bg-ok' : 'bg-accent'
  return (
    <div
      role={item.tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="toast pop pointer-events-auto flex w-full max-w-[380px] items-center gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13.5px] text-ink"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="min-w-0 flex-1">{item.text}</span>
      {item.action && (
        <button type="button" onClick={() => { item.action!.onClick(); onDone() }} className="btn-quiet h-7 shrink-0 text-accent hover:text-accent">{item.action.label}</button>
      )}
      <button type="button" onClick={onDone} aria-label="ปิด" className="shrink-0 rounded p-1 text-faint hover:bg-sunken hover:text-ink">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}
