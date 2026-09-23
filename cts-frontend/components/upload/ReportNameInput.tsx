'use client'

interface Props {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

export default function ReportNameInput({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1">
      <label htmlFor="report-name" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        ชื่อ Report
      </label>
      <input
        id="report-name"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="เช่น CTS Weekly Report — W38 2026"
        maxLength={100}
        className={[
          'w-full rounded-lg border px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-100',
          'placeholder:text-slate-400 dark:placeholder:text-slate-500',
          'outline-none transition-colors',
          'focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/50',
          disabled
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
            : 'border-slate-300 bg-white hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500',
        ].join(' ')}
      />
    </div>
  )
}
