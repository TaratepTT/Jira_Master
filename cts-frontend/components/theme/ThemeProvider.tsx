'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('cts-theme') as Theme | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initial = stored ?? (prefersDark ? 'dark' : 'light')
    setTheme(initial)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('cts-theme', theme)
  }, [theme, mounted])

  const toggleTheme = () => setTheme(t => (t === 'light' ? 'dark' : 'light'))

  // Always provide the context — during SSR/build, theme defaults to 'light'
  // and toggleTheme is a no-op until mounted. This prevents "useTheme must be
  // used within ThemeProvider" errors during Next.js static generation.
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div style={mounted ? undefined : { visibility: 'hidden' }}>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
