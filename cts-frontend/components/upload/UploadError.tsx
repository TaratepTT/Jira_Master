'use client'

interface Props {
  message: string
  onRetry: () => void
}

export default function UploadError({ message, onRetry }: Props) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-6 space-y-4">
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-red-800">เกิดข้อผิดพลาด</p>
          <p className="text-sm text-red-600">{message}</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="w-full rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
      >
        ลองใหม่
      </button>
    </div>
  )
}
