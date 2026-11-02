'use client'

import { useEffect, useRef, useState } from 'react'

// ── Dashboard filters kept in the address bar ─────────────────
// So a link like /dashboard/<id>?bu=Makro&st=L1-In+progress&incomplete=1 opens with exactly
// the same view, and the browser's back/refresh does not lose the filters.
// (Reads window.location directly instead of useSearchParams, so the page needs no
// Suspense boundary and the address bar is updated with replaceState — no re-navigation.)

export interface DashboardFilters {
  q: string
  bu: string[]
  status: string[]
  system: string[]
  category: string[]
  assignee: string[]
  incomplete: boolean
  sort: string | null      // SortKey
  dir: 'asc' | 'desc'
  ticket: string | null    // open ticket modal
}

export const EMPTY_FILTERS: DashboardFilters = {
  q: '', bu: [], status: [], system: [], category: [], assignee: [], incomplete: false, sort: null, dir: 'asc', ticket: null,
}

const PARAM = { q: 'q', bu: 'bu', status: 'st', system: 'sys', category: 'cat', assignee: 'as', incomplete: 'incomplete', sort: 'sort', ticket: 't' } as const

export function readFilters(search: string): DashboardFilters {
  const p = new URLSearchParams(search)
  const sortRaw = p.get(PARAM.sort)
  const [sort, dir] = sortRaw ? sortRaw.split(':') : [null, 'asc']
  return {
    q: p.get(PARAM.q) ?? '',
    bu: p.getAll(PARAM.bu),
    status: p.getAll(PARAM.status),
    system: p.getAll(PARAM.system),
    category: p.getAll(PARAM.category),
    assignee: p.getAll(PARAM.assignee),
    incomplete: p.get(PARAM.incomplete) === '1',
    sort: sort || null,
    dir: dir === 'desc' ? 'desc' : 'asc',
    ticket: p.get(PARAM.ticket),
  }
}

export function filtersToQuery(f: DashboardFilters): string {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set(PARAM.q, f.q.trim())
  f.bu.forEach(v => p.append(PARAM.bu, v))
  f.status.forEach(v => p.append(PARAM.status, v))
  f.system.forEach(v => p.append(PARAM.system, v))
  f.category.forEach(v => p.append(PARAM.category, v))
  f.assignee.forEach(v => p.append(PARAM.assignee, v))
  if (f.incomplete) p.set(PARAM.incomplete, '1')
  if (f.sort) p.set(PARAM.sort, `${f.sort}:${f.dir}`)
  if (f.ticket) p.set(PARAM.ticket, f.ticket)
  const s = p.toString()
  return s ? `?${s}` : ''
}

/**
 * Returns [filters, setFilters, ready]. `ready` turns true after the URL was read on the
 * client (the first render uses empty filters, like the server render).
 */
export function useUrlFilters(): [DashboardFilters, (patch: Partial<DashboardFilters>) => void, boolean] {
  const [filters, setState] = useState<DashboardFilters>(EMPTY_FILTERS)
  const [ready, setReady] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setState(readFilters(window.location.search))
    setReady(true)
    const onPop = () => setState(readFilters(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Write to the address bar (debounced so typing in the search box does not spam history)
  useEffect(() => {
    if (!ready) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const next = `${window.location.pathname}${filtersToQuery(filters)}${window.location.hash}`
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, '', next)
      }
    }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [filters, ready])

  const setFilters = (patch: Partial<DashboardFilters>) => setState(prev => ({ ...prev, ...patch }))
  return [filters, setFilters, ready]
}
