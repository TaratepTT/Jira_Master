import type { ReactNode } from 'react'

// An empty list says what to do next, with the action right there.
export default function EmptyState({ title, text, action, className = '' }: { title: string; text?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-start gap-3 px-5 py-8 sm:px-6 ${className}`}>
      <div>
        <p className="text-[14.5px] font-medium text-ink">{title}</p>
        {text && <p className="mt-1 max-w-[36rem] text-[13px] leading-relaxed text-muted">{text}</p>}
      </div>
      {action}
    </div>
  )
}
