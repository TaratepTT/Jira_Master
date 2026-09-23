import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme/ThemeProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'CTS Report Dashboard',
  description: 'อัปโหลด Jira/CTS export และดู dashboard ได้ทันที',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body className={`${inter.className} bg-slate-50 dark:bg-slate-900 transition-colors`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
