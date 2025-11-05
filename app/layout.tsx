import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ChunkErrorBoundary from '@/components/ChunkErrorBoundary'
import { RootProviders } from '@/components/root-providers'

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
      <head>
        <meta name="view-transition" content="same-origin" />
      </head>
      <body className={inter.className}>
        <ChunkErrorBoundary>
          <RootProviders>
            {children}
          </RootProviders>
        </ChunkErrorBoundary>
      </body>
    </html>
  )
} 