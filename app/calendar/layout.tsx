import { DashboardLayoutClient } from '@/app/(dashboard)/dashboard-layout-client'

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>
} 