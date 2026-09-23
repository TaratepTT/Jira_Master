'use client'

import { useAuth } from '@/components/auth/AuthContext'

export default function LogoutButton() {
  const { logout, username } = useAuth()

  return (
    <button
      onClick={() => { if (confirm('ออกจากระบบ?')) logout() }}
      title={username ? `Logout (${username})` : 'Logout'}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-500 dark:hover:text-red-400 transition-colors"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H3" />
      </svg>
    </button>
  )
}
