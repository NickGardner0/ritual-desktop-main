import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/contexts/AuthContext'
import { HabitsProvider } from '@/contexts/HabitsContext'
import ChunkErrorBoundary from '@/components/ChunkErrorBoundary'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Ritual Desktop',
  description: 'Your habits, tracked beautifully',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="desktop">
      <body className={inter.className}>
        <ChunkErrorBoundary>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthProvider>
              <HabitsProvider>
                {children}
              </HabitsProvider>
            </AuthProvider>
          </ThemeProvider>
        </ChunkErrorBoundary>
      </body>
    </html>
  )
} 