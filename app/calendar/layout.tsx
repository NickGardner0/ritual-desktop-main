import { SidebarLayout } from '@/components/sidebar-layout'

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <SidebarLayout>{children}</SidebarLayout>
} 