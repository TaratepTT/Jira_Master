'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState, type ReactNode } from 'react'
import CommandPalette, { useCommandPaletteShortcut } from './CommandPalette'
import ThemeToggle from '@/components/theme/ThemeToggle'
import LogoutButton from '@/components/auth/LogoutButton'
import { useAuth } from '@/components/auth/AuthContext'

// ── The app's top navigation — the same on every signed-in page ──
// Wordmark, the main sections, and the signed-in user on the right.
export function AppNav() {
  const pathname = usePathname() ?? '/'
  const { user, canEdit, isAdmin } = useAuth()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  useCommandPaletteShortcut(openPalette)

  const items: Array<{ href: string; label: string; match: (p: string) => boolean; show: boolean }> = [
    { href: '/', label: 'Reports', match: p => p === '/' || p.startsWith('/dashboard') || p.startsWith('/history'), show: true },
    { href: '/jira', label: 'Sync จาก Jira', match: p => p.startsWith('/jira') || p.startsWith('/upload'), show: canEdit },
    { href: '/compare', label: 'เปรียบเทียบ', match: p => p.startsWith('/compare'), show: true },
    { href: '/admin/users', label: 'ผู้ใช้', match: p => p.startsWith('/admin/users'), show: isAdmin },
    { href: '/admin/audit', label: 'ประวัติการใช้งาน', match: p => p.startsWith('/admin/audit'), show: isAdmin },
  ]

  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-surface" aria-label="เมนูหลัก">
      <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-6 px-4 sm:px-8">
        <Link href="/" className="shrink-0 text-[15px] font-bold tracking-[-0.02em] text-ink">
          CTS<span className="font-medium text-muted"> Report</span>
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {items.filter(i => i.show).map(i => {
            const active = i.match(pathname)
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active ? 'page' : undefined}
                className={`relative whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                  active ? 'text-ink' : 'text-muted hover:bg-sunken hover:text-ink'
                }`}
              >
                {i.label}
                {active && <span className="absolute inset-x-2.5 -bottom-[7px] h-[2px] rounded-full bg-accent" aria-hidden />}
              </Link>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openPalette}
            className="hidden items-center gap-2 rounded-md border border-line-strong px-2.5 py-1 text-[13px] text-muted transition-colors hover:bg-sunken hover:text-ink md:flex"
            aria-label="ค้นหา (Ctrl+K)"
          >
            ค้นหา
            <kbd className="key rounded border border-line px-1 text-[11px] text-faint">Ctrl K</kbd>
          </button>
          <button type="button" onClick={openPalette} className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-sunken md:hidden" aria-label="ค้นหา">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>
          </button>
          {user && (
            <Link
              href="/account"
              title="บัญชีของฉัน"
              aria-current={pathname.startsWith('/account') ? 'page' : undefined}
              className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-sunken hover:text-ink sm:flex"
            >
              <span className="max-w-[160px] truncate text-ink">{user.name}</span>
              <span className="text-[12px] text-faint">{user.role}</span>
            </Link>
          )}
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </nav>
  )
}

// ── Page title row: optional back link, title, one line of context, actions ──
export function PageHeader({
  title, description, back, actions, children,
}: {
  title: ReactNode
  description?: ReactNode
  back?: { href: string; label: string }
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link href={back.href} className="btn-quiet -ml-2 mb-2">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-[42rem] text-[14px] leading-relaxed text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

// ── Full page frame ─────────────────────────────────────────────
export default function AppShell({ children, width = 'wide' }: { children: ReactNode; width?: 'wide' | 'narrow' }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <AppNav />
      <main className={`mx-auto px-4 py-8 sm:px-8 ${width === 'narrow' ? 'max-w-[760px]' : 'max-w-[1200px]'}`}>
        {children}
      </main>
    </div>
  )
}
