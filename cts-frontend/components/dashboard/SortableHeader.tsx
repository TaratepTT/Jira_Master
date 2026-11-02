import type { SortDir, SortKey } from './types'

// ── Sortable column header ─────────────────────────────────────
export default function SortableHeader({
  label, sortKey, activeKey, dir, onSort, onResizeStart,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey | null
  dir: SortDir
  onSort: (key: SortKey) => void
  onResizeStart?: (e: React.MouseEvent) => void
}) {
  const isActive = activeKey === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className="relative text-left py-2 px-3 text-xs font-medium text-muted cursor-pointer select-none hover:text-ink transition-colors"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="flex flex-col -space-y-1">
          <svg
            className={`h-2.5 w-2.5 ${isActive && dir === 'asc' ? 'text-accent' : 'text-faint'}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path d="M10 5l5 6H5l5-6z" />
          </svg>
          <svg
            className={`h-2.5 w-2.5 ${isActive && dir === 'desc' ? 'text-accent' : 'text-faint'}`}
            fill="currentColor" viewBox="0 0 20 20"
          >
            <path d="M10 15l-5-6h10l-5 6z" />
          </svg>
        </span>
      </span>
      {onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-accent active:bg-accent z-10"
        />
      )}
    </th>
  )
}
