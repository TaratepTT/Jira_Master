'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import CommandPalette, { useCommandPaletteShortcut } from './CommandPalette'
import ShortcutsHelp from './ShortcutsHelp'
import { useAuth } from '@/components/auth/AuthContext'
import { useTheme } from '@/components/theme/ThemeProvider'
import { listChecks, type WatchState } from '@/lib/api'
import { useDialog } from '@/components/ui/Dialog'

// ── Icons (24px outline, drawn at 16px) ─────────────────────────
const ICON: Record<string, string> = {
  reports: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h12a2.25 2.25 0 002.25-2.25V3M3.75 3h16.5M3.75 3H2.25m18 0h1.5M9 21l3-4.5 3 4.5M8.25 12V9m3.75 3V6.75m3.75 5.25v-2.25',
  sync: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99',
  compare: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  playbooks: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  users: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
  audit: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  search: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
  moon: 'M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z',
  sun: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z',
  logout: 'M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H3',
  menu: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  close: 'M6 18L18 6M6 6l12 12',
  back: 'M15.75 19.5L8.25 12l7.5-7.5',
  pulse: 'M3.75 12h3l2.25-6 4.5 12 2.25-6h4.5',
}
export function Icon({ name, className = 'h-4 w-4' }: { name: keyof typeof ICON | string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON[name]} />
    </svg>
  )
}

type NavItem = { href: string; label: string; icon: string; match: (p: string) => boolean; show: boolean }

// The watcher line at the foot of the sidebar is read once a minute at most, shared by every page.
let watchCache: { at: number; watch: WatchState; waiting: number } | null = null
function useWatchPulse(enabled: boolean) {
  const [pulse, setPulse] = useState(watchCache)
  useEffect(() => {
    if (!enabled) return
    if (watchCache && Date.now() - watchCache.at < 60_000) { setPulse(watchCache); return }
    let live = true
    listChecks()
      .then(r => {
        watchCache = { at: Date.now(), watch: r.watch, waiting: r.checks.filter(c => c.sent.length === 0 && c.decision === 'suggested').length }
        if (live) setPulse(watchCache)
      })
      .catch(() => undefined)
    return () => { live = false }
  }, [enabled])
  return pulse
}

const timeTh = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

// ── App navigation: fixed sidebar on wide screens, top bar + drawer on small ones ──
export function AppNav() {
  const pathname = usePathname() ?? '/'
  const { user, canEdit, isAdmin, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const { confirm } = useDialog()
  const openPalette = useCallback(() => { setDrawer(false); setPaletteOpen(true) }, [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  useCommandPaletteShortcut(openPalette)
  const pulse = useWatchPulse(!!user)

  useEffect(() => { setDrawer(false) }, [pathname])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  const groups: Array<{ label: string; items: NavItem[] }> = [
    { label: 'รายงาน', items: [
      { href: '/', label: 'รายงาน', icon: 'reports', match: p => p === '/' || p.startsWith('/dashboard') || p.startsWith('/history'), show: true },
      { href: '/jira', label: 'ดึงข้อมูลจาก Jira', icon: 'sync', match: p => p.startsWith('/jira') || p.startsWith('/upload'), show: canEdit },
      { href: '/compare', label: 'เปรียบเทียบ', icon: 'compare', match: p => p.startsWith('/compare'), show: true },
    ] },
    { label: 'ช่วยทีม L1', items: [
      { href: '/playbooks', label: 'คู่มือ L1', icon: 'playbooks', match: p => p.startsWith('/playbooks'), show: true },
    ] },
    { label: 'ผู้ดูแลระบบ', items: [
      { href: '/admin/users', label: 'ผู้ใช้', icon: 'users', match: p => p.startsWith('/admin/users'), show: isAdmin },
      { href: '/admin/audit', label: 'ประวัติการใช้งาน', icon: 'audit', match: p => p.startsWith('/admin/audit'), show: isAdmin },
      { href: '/admin/system', label: 'สถานะระบบ', icon: 'pulse', match: p => p.startsWith('/admin/system'), show: isAdmin },
    ] },
  ]

  const initials = (user?.name ?? '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  const body = (
    <>
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Link href="/" className="flex items-center gap-2.5 rounded-md">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[13px] font-bold tracking-[-0.03em] text-on-accent" aria-hidden>C</span>
          <span className="leading-tight">
            <span className="block text-[14px] font-semibold tracking-[-0.01em] text-ink">CTS Report</span>
            <span className="block text-[11px] text-faint">Support console</span>
          </span>
        </Link>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={openPalette}
          aria-label="ค้นหา (Ctrl+K)"
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-faint transition-colors hover:border-line-strong hover:text-muted"
        >
          <Icon name="search" className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">ค้นหา ticket หรือหน้า</span>
          <kbd className="key rounded border border-line px-1 text-[10.5px]">Ctrl K</kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="เมนูหลัก">
        {groups.map(g => {
          const items = g.items.filter(i => i.show)
          if (!items.length) return null
          return (
            <div key={g.label} className="mb-4">
              <p className="px-2 pb-1 text-[11.5px] font-medium text-faint">{g.label}</p>
              <ul className="space-y-0.5">
                {items.map(i => {
                  const active = i.match(pathname)
                  return (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        aria-current={active ? 'page' : undefined}
                        className={`relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors ${
                          active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-sunken hover:text-ink'
                        }`}
                      >
                        <Icon name={i.icon} />
                        {i.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* live line: when new tickets were last checked, and how many good matches still wait for a person */}
      {pulse?.watch.enabled && (
        <Link href="/playbooks" className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-line bg-surface px-2.5 py-2 text-[12px] leading-snug transition-colors hover:border-line-strong" data-testid="watch-pulse">
          <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${pulse.watch.lastError ? 'bg-danger' : 'bg-ok'}`} aria-hidden />
          <span className="min-w-0 text-muted">
            {pulse.watch.lastError ? <span className="text-danger">ดึง ticket จาก Jira ไม่สำเร็จ</span>
              : pulse.watch.lastRunAt ? <>ตรวจ ticket ใหม่ล่าสุด {timeTh(pulse.watch.lastRunAt)}</> : 'รอตรวจ ticket รอบแรก'}
            {pulse.waiting > 0 && <span className="block text-accent">ตรงแต่ยังไม่ส่ง {pulse.waiting} ใบ</span>}
          </span>
        </Link>
      )}

      {user && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-3">
          <Link
            href="/account"
            title="บัญชีของฉัน"
            aria-current={pathname.startsWith('/account') ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-sunken"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-muted ring-1 ring-line" aria-hidden>{initials}</span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
              <span className="block text-[11.5px] text-faint">{user.role}</span>
            </span>
          </Link>
          <button type="button" onClick={toggleTheme} aria-label={theme === 'light' ? 'สลับเป็นโหมดมืด' : 'สลับเป็นโหมดสว่าง'} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-ink">
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>
          <button type="button" onClick={async () => { if (await confirm({ title: 'ออกจากระบบ?', message: 'งานที่ยังไม่ได้บันทึกในหน้านี้จะหายไป', confirmLabel: 'ออกจากระบบ' })) logout() }} title="ออกจากระบบ" aria-label="ออกจากระบบ" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-soft hover:text-danger">
            <Icon name="logout" />
          </button>
        </div>
      )}
    </>
  )

  return (
    <>
      {/* wide screens: fixed sidebar (body gets padding-left from globals.css) */}
      <aside id="app-sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-sidebar lg:flex">
        {body}
      </aside>

      {/* small screens: top bar + slide-in drawer */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-surface px-3 lg:hidden">
        <button type="button" onClick={() => setDrawer(true)} aria-label="เปิดเมนู" aria-expanded={drawer} className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink">
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-accent text-[11px] font-bold text-on-accent" aria-hidden>C</span>
          <span className="text-[14px] font-semibold text-ink">CTS Report</span>
        </Link>
        <span className="flex-1" />
        <button type="button" onClick={openPalette} aria-label="ค้นหา" className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-ink">
          <Icon name="search" />
        </button>
      </header>
      {drawer && (
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="เมนู">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="pop absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col bg-sidebar">
            <button type="button" onClick={() => setDrawer(false)} aria-label="ปิดเมนู" className="absolute right-2 top-3 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-sunken">
              <Icon name="close" />
            </button>
            {body}
          </div>
        </div>
      )}
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <ShortcutsHelp />
    </>
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
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted transition-colors hover:text-ink">
          <Icon name="back" className="h-3.5 w-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.022em] text-ink">{title}</h1>
          {description && <p className="mt-1.5 max-w-[44rem] text-[14px] leading-relaxed text-muted">{description}</p>}
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
      <main className={`mx-auto px-4 py-8 sm:px-8 lg:py-10 ${width === 'narrow' ? 'max-w-[800px]' : 'max-w-[1240px]'}`}>
        {children}
      </main>
    </div>
  )
}
