import type { Metadata } from 'next'
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
    <html lang="en" className="desktop">
      <head>
        <meta name="view-transition" content="same-origin" />
      </head>
      <body>
        <ChunkErrorBoundary>
          <RootProviders>
            {children}
          </RootProviders>
        </ChunkErrorBoundary>
      </body>
    </html>
  )
} 
