/**
 * Dashboard/Index Page - Server Component
 * 
 * Unified page with Overview/Metrics toggle (Midday-style).
 * This is the primary destination combining:
 * - Overview: Habit list with totals and stats
 * - Metrics: Spark cards, charts, and computer activity
 * 
 * URL params:
 * - ?view=overview - Shows the habit list (default)
 * - ?view=metrics - Shows the charts and spark cards
 */

import type { Metadata } from 'next';
import { HydrationBoundary } from '@tanstack/react-query';
import { ClientDashboard } from './client-dashboard';
import { loadDashboardInitialData } from './dashboard-server-data';

export const metadata: Metadata = {
  title: 'Dashboard | Ritual',
  description: 'Track and manage your daily habits',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initialData = await loadDashboardInitialData(searchParams);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--content-bg)]">
      <div className="mx-auto h-full w-full max-w-7xl px-6 pt-7 lg:px-8">
        <HydrationBoundary state={initialData.dehydratedState}>
          <ClientDashboard
            initialViewMode={initialData.initialViewMode}
            initialUserId={initialData.initialUserId}
          />
        </HydrationBoundary>
      </div>
    </div>
  );
}
