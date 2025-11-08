import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import './globals.css'
import ChunkErrorBoundary from '@/components/ChunkErrorBoundary'
import { RootProviders } from '@/components/root-providers'

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
    <html lang="en" className="desktop" style={{ fontFamily: GeistSans.style.fontFamily }}>
      <head>
        <meta name="view-transition" content="same-origin" />
      </head>
      <body className={GeistSans.className}>
        <ChunkErrorBoundary>
          <RootProviders>
            {children}
          </RootProviders>
        </ChunkErrorBoundary>
      </body>
    </html>
  )
} 