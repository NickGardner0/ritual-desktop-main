import { DashboardLayout } from '@/components/dashboard-layout'

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DashboardLayout>{children}</DashboardLayout>
} 