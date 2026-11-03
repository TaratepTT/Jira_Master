import type { Metadata } from 'next'
// Self-hosted fonts (no Google Fonts call at build time).
// Geist sets Latin text and numbers; it has no Thai, so Thai falls through to Anuphan, a Thai face
// drawn to sit with modern grotesques. Geist Mono is used only for ticket keys.
import '@fontsource-variable/geist'
import '@fontsource-variable/anuphan'
import '@fontsource-variable/geist-mono'
import './globals.css'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { AuthProvider } from '@/components/auth/AuthContext'
import { DialogProvider } from '@/components/ui/Dialog'

export const metadata: Metadata = {
  title: 'CTS Support Console',
  description: 'อัปโหลด Jira/CTS export และดู dashboard ได้ทันที',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="th"
      suppressHydrationWarning
      style={{ ['--font-sans' as string]: "'Geist Variable', 'Anuphan Variable'", ['--font-mono' as string]: "'Geist Mono Variable'" }}
    >
      <body className="font-sans bg-paper text-ink">
        <ThemeProvider>
          <DialogProvider><AuthProvider>{children}</AuthProvider></DialogProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
