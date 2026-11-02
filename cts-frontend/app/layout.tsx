import type { Metadata } from 'next'
// Self-hosted IBM Plex (no Google Fonts call at build time). Plex Sans Thai covers Thai + Latin;
// Plex Mono is used only for ticket keys.
import '@fontsource/ibm-plex-sans-thai/400.css'
import '@fontsource/ibm-plex-sans-thai/500.css'
import '@fontsource/ibm-plex-sans-thai/600.css'
import '@fontsource/ibm-plex-sans-thai/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './globals.css'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { AuthProvider } from '@/components/auth/AuthContext'

export const metadata: Metadata = {
  title: 'CTS Report Dashboard',
  description: 'อัปโหลด Jira/CTS export และดู dashboard ได้ทันที',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="th"
      suppressHydrationWarning
      style={{ ['--font-sans' as string]: "'IBM Plex Sans Thai'", ['--font-mono' as string]: "'IBM Plex Mono'" }}
    >
      <body className="font-sans bg-paper text-ink">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
