import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';

export interface HabitStats {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  total: number;
  average: number;
  min: number;
  max: number;
  variance: number;
  std_dev: number;
  days_with_data: number;
  total_entries: number;
  summary: string;
}

export interface HabitStatsResponse {
  success: boolean;
  error?: string;
  available_habits?: string[];
  date_range?: {
    start: string;
    end: string;
    days: number;
  };
  habits?: HabitStats[];
}

export interface DailyDataPoint {
  date: string;
  value: number;
  unit: string;
}

export interface DailyBreakdownResponse {
  success: boolean;
  error?: string;
  available_habits?: string[];
  habit?: {
    id: string;
    name: string;
    unit: string;
    category: string | null;
  };
  date_range?: {
    start: string;
    end: string;
    days: number;
  };
  days_with_data?: number;
  total?: number;
  average_per_day?: number;
  sync_context?: {
    provider?: string;
    provider_label?: string;
    latest_data_date?: string | null;
    latest_sleep_date?: string | null;
    latest_sync_at?: string | null;
    last_successful_sync_at?: string | null;
    is_upstream_stale?: boolean;
    missing_dates?: string[];
    message?: string | null;
  };
  data?: DailyDataPoint[];
  daily_data?: DailyDataPoint[];
}

function tokenGetter(token: string) {
  return async () => token;
}

function omitBlank(value?: string): string | undefined {
  return value ? value : undefined;
}

async function readAnalyticsOperation<T>(
  operation: () => Promise<unknown>,
): Promise<T> {
  try {
    return await operation() as T;
  } catch (error) {
    if (error instanceof BackendClientError && error.status === 429) {
      throw new Error('Analytics API rate limited (429). Please retry shortly.');
    }
    if (error instanceof BackendClientError) {
      console.error(`Analytics API error: ${error.status} - ${error.responseBody}`);
      throw new Error(`Analytics API error (${error.status}): ${error.responseBody}`);
    }
    throw error;
  }
}

export const analyticsApi = {
  getHabitStats(
    token: string,
    options?: {
      habitId?: string;
      habitName?: string;
      startDate?: string;
      endDate?: string;
      daysBack?: number;
    },
  ): Promise<HabitStatsResponse> {
    return readAnalyticsOperation(() => apiOperationWithAuth(
      'get_habit_stats_api_analytics_stats_get',
      tokenGetter(token),
      {
        query: {
          habit_id: omitBlank(options?.habitId),
          habit_name: omitBlank(options?.habitName),
          start_date: omitBlank(options?.startDate),
          end_date: omitBlank(options?.endDate),
          days_back: options?.daysBack,
        },
      },
    ));
  },

  getDailyBreakdown(
    token: string,
    options: {
      habitId?: string;
      habitName?: string;
      startDate?: string;
      endDate?: string;
      daysBack?: number;
      timezone?: string;
    },
  ): Promise<DailyBreakdownResponse> {
    return readAnalyticsOperation(() => apiOperationWithAuth(
      'get_daily_breakdown_api_analytics_daily_breakdown_get',
      tokenGetter(token),
      {
        query: {
          habit_id: omitBlank(options.habitId),
          habit_name: omitBlank(options.habitName),
          start_date: omitBlank(options.startDate),
          end_date: omitBlank(options.endDate),
          days_back: options.daysBack,
          timezone: omitBlank(options.timezone),
        },
      },
    ));
  },
};
