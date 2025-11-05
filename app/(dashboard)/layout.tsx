'use client'

import { DashboardLayout } from '@/components/dashboard-layout'
import { AIProvider } from '@/contexts/AIContext'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SharedDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter();
  
  // Prefetch critical routes on mount for instant navigation
  useEffect(() => {
    router.prefetch('/dashboard');
    router.prefetch('/analytics');
    router.prefetch('/calendar');
    router.prefetch('/timer');
  }, [router]);
  
  return (
    <AIProvider>
      <DashboardLayout>
        {children}
      </DashboardLayout>
    </AIProvider>
  )
}

