'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
const TOKEN_KEY = 'cts-auth-token'

export type Role = 'admin' | 'editor' | 'viewer'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
}

interface AuthContextValue {
  isAuthenticated: boolean
  isChecking: boolean
  user: AuthUser | null
  /** display name (kept so older components that read `username` still work) */
  username: string | null
  role: Role | null
  /** editor or admin: may sync, edit tickets, comment, upload */
  canEdit: boolean
  isAdmin: boolean
  login: (identifier: string, password: string) => Promise<{ ok: boolean; message?: string }>
  register: (email: string, name: string, password: string) => Promise<{ ok: boolean; message: string }>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Routes that don't require login
const PUBLIC_PATHS = ['/login', '/register']

function errorMessage(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isChecking, setIsChecking] = useState(true)

  useEffect(() => {
    const verify = async () => {
      const token = localStorage.getItem(TOKEN_KEY)
      if (!token) {
        setUser(null)
        setIsChecking(false)
        if (!PUBLIC_PATHS.includes(pathname)) router.replace('/login')
        return
      }
      try {
        // Re-checked on every navigation, so a role change made by an admin shows up quickly.
        const { data } = await axios.get(`${API_BASE}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        setUser(data.user as AuthUser)
        if (PUBLIC_PATHS.includes(pathname)) router.replace('/')
      } catch (e) {
        // Only a real "not logged in" answer logs the user out. A network error or a
        // sleeping/restarting server must NOT throw away a valid session.
        if ((e as { response?: { status?: number } })?.response?.status === 401) {
          localStorage.removeItem(TOKEN_KEY)
          setUser(null)
          if (!PUBLIC_PATHS.includes(pathname)) router.replace('/login')
        }
      } finally {
        setIsChecking(false)
      }
    }
    verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const login = async (identifier: string, password: string) => {
    try {
      const { data } = await axios.post(`${API_BASE}/api/auth/login`, { identifier, password })
      localStorage.setItem(TOKEN_KEY, data.token)
      setUser(data.user as AuthUser)
      router.push('/')
      return { ok: true }
    } catch (e: unknown) {
      return { ok: false, message: errorMessage(e, 'Login ไม่สำเร็จ') }
    }
  }

  const register = async (email: string, name: string, password: string) => {
    try {
      const { data } = await axios.post(`${API_BASE}/api/auth/register`, { email, name, password })
      return { ok: true, message: (data?.message as string) ?? 'สมัครสำเร็จ' }
    } catch (e: unknown) {
      return { ok: false, message: errorMessage(e, 'สมัครสมาชิกไม่สำเร็จ') }
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    router.push('/login')
  }

  const role = user?.role ?? null

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!user,
        isChecking,
        user,
        username: user?.name ?? null,
        role,
        canEdit: role === 'editor' || role === 'admin',
        isAdmin: role === 'admin',
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}
