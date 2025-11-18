import { DashboardLayoutClient } from '@/app/(dashboard)/dashboard-layout-client';

export default function TimerLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
} 