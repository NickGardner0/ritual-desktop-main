import { ClerkProvider } from '@clerk/nextjs'
import ChunkErrorBoundary from '@/components/ChunkErrorBoundary'

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <ChunkErrorBoundary>
        {children}
      </ChunkErrorBoundary>
    </ClerkProvider>
  )
}

