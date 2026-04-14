import { QueryClient, dehydrate } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
import {
  getAnalyticsSummary,
  getAuthenticatedUserId,
  getHabits,
  getHabitLogs,
} from '@/lib/server/data';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';
import type {
  DashboardInitialData,
} from './dashboard-initial-data';
import {
  buildDashboardSnapshot,
  dashboardSnapshotKeys,
} from '@/lib/dashboard/dashboard-snapshot';
import { getAnalyticsRangeKey } from '@/lib/dashboard/analytics-range';

type DashboardSearchParams = Record<string, string | string[] | undefined> | undefined;
type HabitLogLike = Awaited<ReturnType<typeof getHabitLogs>>[number];

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

export async function loadDashboardInitialData(
  searchParams?: Promise<DashboardSearchParams> | DashboardSearchParams,
): Promise<DashboardInitialData> {
  return Sentry.startSpan(
    {
      name: 'dashboard.load_initial_data',
      op: 'function.nextjs',
    },
    async () => {
      const resolvedSearchParams = searchParams instanceof Promise
        ? await searchParams
        : searchParams;
      const initialViewMode = resolveInitialViewMode(resolvedSearchParams);
      const shouldPreloadMetrics = initialViewMode === 'metrics';
      const queryClient = new QueryClient();

      // Overview first paint should not wait on server-side auth + habits fetch.
      // The client can hydrate from persisted React Query cache and refetch in
      // the background once Clerk is ready.
      if (!shouldPreloadMetrics) {
        return {
          dehydratedState: dehydrate(queryClient),
          initialViewMode,
          initialUserId: null,
        };
      }

      const userId = await getAuthenticatedUserId();

      const [habits, habitLogs, analyticsSummary] = await Sentry.startSpan(
        {
          name: 'dashboard.fetch_initial_queries',
          op: 'ui.load',
          attributes: {
            initial_view_mode: initialViewMode,
            preload_habit_logs: shouldPreloadMetrics,
          },
        },
        async () => Promise.all([
          getHabits(userId),
          shouldPreloadMetrics
            ? getHabitLogs(undefined, userId)
            : Promise.resolve([] as HabitLogLike[]),
          shouldPreloadMetrics
            ? getAnalyticsSummary(1095, userId).catch(() => null)
            : Promise.resolve(null),
        ]),
      );

      queryClient.setQueryData(['habits', 'list', userId], habits);
      if (habitLogs.length > 0) {
        queryClient.setQueryData(['habit-logs', 'list', userId], habitLogs);
      }
      if (analyticsSummary) {
        queryClient.setQueryData(['analytics-summary', userId], analyticsSummary);
      }

      const dashboardSnapshot = Sentry.startSpan(
        {
          name: 'dashboard.build_snapshot',
          op: 'ui.compute',
          attributes: {
            habit_count: habits.length,
            habit_log_count: habitLogs.length,
            initial_view_mode: initialViewMode,
            preload_metrics: shouldPreloadMetrics,
          },
        },
        () => {
          return buildDashboardSnapshot(habits, habitLogs, {
            userId,
            hydratedFrom: 'server',
            snapshotKey: getAnalyticsRangeKey(undefined),
          });
        },
      );
      queryClient.setQueryData(
        dashboardSnapshotKeys.detail(userId, dashboardSnapshot.meta.snapshotKey),
        dashboardSnapshot,
      );

      return {
        dehydratedState: dehydrate(queryClient),
        initialViewMode,
        initialUserId: userId,
      };
    },
  );
}
