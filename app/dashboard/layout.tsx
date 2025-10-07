'use client'

import { DashboardLayout } from '@/components/dashboard-layout'
import { AIProvider } from '@/contexts/AIContext'

export default function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AIProvider>
      <DashboardLayout>
        {children}
      </DashboardLayout>
    </AIProvider>
  )
} 