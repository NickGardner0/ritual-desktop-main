import { DashboardLayout } from '@/components/dashboard-layout'

export default function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DashboardLayout>{children}</DashboardLayout>
} 