'use client'

interface Props {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

export default function ReportNameInput({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1">
      <label htmlFor="report-name" className="block text-sm font-medium text-ink">
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
          'w-full rounded-lg border px-3.5 py-2.5 text-sm text-ink',
          'placeholder:text-slate-400 dark:placeholder:text-slate-500',
          'outline-none transition-colors',
          'focus:border-accent  ',
          disabled
            ? 'cursor-not-allowed border-line bg-sunken text-faint'
            : 'border-line-strong bg-surface hover:border-slate-400',
        ].join(' ')}
      />
    </div>
  )
}
