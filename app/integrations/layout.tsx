import { SidebarLayout } from '@/components/sidebar-layout'

export default function IntegrationsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <SidebarLayout>{children}</SidebarLayout>
} 