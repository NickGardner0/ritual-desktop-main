/**
 * Dashboard/Index Page - Server Component
 *
 * Unified page with Overview/Metrics toggle.
 * Habit data loads on the client through the FastAPI catch-all,
 * the same path overview already uses.
 *
 * URL params:
 * - ?view=overview - Shows the habit list (default)
 * - ?view=metrics - Shows the charts and spark cards
 * - ?view=chat - Opens the chat panel
 */

import type { Metadata } from 'next';
import { ClientDashboard } from './client-dashboard';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';

export const metadata: Metadata = {
  title: 'Dashboard | Ritual',
  description: 'Track and manage your daily habits',
};

type DashboardSearchParams = Record<string, string | string[] | undefined> | undefined;

function readSingleParam(
  searchParams: DashboardSearchParams,
  key: string,
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function resolveInitialViewMode(searchParams: DashboardSearchParams): ViewMode {
  const viewParam = readSingleParam(searchParams, 'view');
  if (viewParam === 'metrics' || viewParam === 'chat') {
    return viewParam;
  }
  return 'overview';
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<DashboardSearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialViewMode = resolveInitialViewMode(resolvedSearchParams);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[var(--content-bg)]">
      <div className="mx-auto h-full w-full max-w-7xl px-6 pt-7 lg:px-8">
        <ClientDashboard
          initialViewMode={initialViewMode}
        />
      </div>
    </div>
  );
}
