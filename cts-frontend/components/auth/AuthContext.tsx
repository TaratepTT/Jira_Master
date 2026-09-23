'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
const TOKEN_KEY = 'cts-auth-token'

interface AuthContextValue {
  isAuthenticated: boolean
  isChecking: boolean
  username: string | null
  login: (username: string, password: string) => Promise<{ ok: boolean; message?: string }>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Routes that don't require login
const PUBLIC_PATHS = ['/login']

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    const verify = async () => {
      const token = localStorage.getItem(TOKEN_KEY)
      if (!token) {
        setIsChecking(false)
        if (!PUBLIC_PATHS.includes(pathname)) router.replace('/login')
        return
      }
      try {
        const { data } = await axios.get(`${API_BASE}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        setIsAuthenticated(true)
        setUsername(data.username)
        if (pathname === '/login') router.replace('/')
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        setIsAuthenticated(false)
        if (!PUBLIC_PATHS.includes(pathname)) router.replace('/login')
      } finally {
        setIsChecking(false)
      }
    }
    verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const login = async (u: string, p: string) => {
    try {
      const { data } = await axios.post(`${API_BASE}/api/auth/login`, { username: u, password: p })
      localStorage.setItem(TOKEN_KEY, data.token)
      setIsAuthenticated(true)
      setUsername(data.username)
      router.push('/')
      return { ok: true }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Login ไม่สำเร็จ'
      return { ok: false, message: msg }
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setIsAuthenticated(false)
    setUsername(null)
    router.push('/login')
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isChecking, username, login, logout }}>
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
