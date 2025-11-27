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
    <html lang="en" className="desktop" suppressHydrationWarning>
      <head>
        <meta name="view-transition" content="same-origin" />
        {/* Preload critical fonts to prevent FOUT (Flash of Unstyled Text) */}
        <link
          rel="preload"
          href="/fonts/fk-grotesk-neue-font-family/FKGroteskNeueTrial-Regular-BF6576818c3af74.otf"
          as="font"
          type="font/otf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/fk-grotesk-neue-font-family/FKGroteskNeueTrial-Medium-BF6576818c3a00a.otf"
          as="font"
          type="font/otf"
          crossOrigin="anonymous"
        />
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
