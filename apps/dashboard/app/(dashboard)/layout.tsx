/**
 * Dashboard Layout - Server Component
 * 
 * CRITICAL: This must be a Server Component (NO 'use client')
 * to allow child pages to be Server Components.
 * 
 * We wrap client-only parts in a separate client component.
 */

import { DashboardLayoutClient } from './dashboard-layout-client';

export default function SharedDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardLayoutClient>
      {children}
    </DashboardLayoutClient>
  );
}
