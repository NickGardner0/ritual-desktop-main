import type { Metadata } from 'next'
import { Suspense } from 'react'
import Script from 'next/script'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { GeistSans } from 'geist/font/sans'
import { DM_Sans, Inter } from 'next/font/google'
import './globals.css'
import ChunkErrorBoundary from '@/components/ChunkErrorBoundary'
import { RootProviders } from '@/components/root-providers'

/** Mirrors Buzz index.html boot: apply cached theme bg + light/dark before paint. */
const THEME_FOUC_SCRIPT = `(() => {
  try {
    var cached = window.localStorage.getItem("ritual-theme-cache");
    if (!cached) {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.add("light");
        document.documentElement.style.backgroundColor = "#fefefe";
      }
      return;
    }
    var parsed = JSON.parse(cached);
    var bg = parsed.vars && parsed.vars["--background"];
    if (bg) document.documentElement.style.backgroundColor = "hsl(" + bg + ")";
    document.documentElement.classList.add(parsed.isDark ? "dark" : "light");
  } catch (e) {}
})();`

export const metadata: Metadata = {
  title: 'Ritual Desktop',
  description: 'Your habits, tracked beautifully',
}

const geistSans = GeistSans

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-inter',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-sans',
  display: 'swap',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`desktop ${geistSans.variable} ${inter.variable} ${dmSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="view-transition" content="same-origin" />
        <Script id="ritual-theme-fouc" strategy="beforeInteractive">
          {THEME_FOUC_SCRIPT}
        </Script>
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
          <Suspense fallback={null}>
            <RootProviders>
              {children}
            </RootProviders>
          </Suspense>
        </ChunkErrorBoundary>
        <SpeedInsights />
      </body>
    </html>
  )
}
