/**
 * Analytics API Service - Frontend client for Python analytics backend
 *
 * Python analytics is used as a fallback path when Tinybird analytics
 * endpoints are unavailable.
 */

import { apiFetch } from '@/lib/api/client';

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

class AnalyticsApiClient {
  private async fetch<T>(endpoint: string, token: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const searchParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });
    }

    const query = searchParams.toString();
    const path = query ? `${endpoint}?${query}` : endpoint;

    const response = await apiFetch(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Analytics API rate limited (429). Please retry shortly.');
      }
      const errorText = await response.text();
      console.error(`Analytics API error: ${response.status} - ${errorText}`);
      throw new Error(`Analytics API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  async getHabitStats(
    token: string,
    options?: {
      habitId?: string;
      habitName?: string;
      startDate?: string;
      endDate?: string;
      daysBack?: number;
    }
  ): Promise<HabitStatsResponse> {
    return this.fetch<HabitStatsResponse>('/api/analytics/stats', token, {
      habit_id: options?.habitId,
      habit_name: options?.habitName,
      start_date: options?.startDate,
      end_date: options?.endDate,
      days_back: options?.daysBack,
    });
  }

  async getDailyBreakdown(
    token: string,
    options: {
      habitId?: string;
      habitName?: string;
      startDate?: string;
      endDate?: string;
      daysBack?: number;
      timezone?: string;
    }
  ): Promise<DailyBreakdownResponse> {
    return this.fetch<DailyBreakdownResponse>('/api/analytics/daily-breakdown', token, {
      habit_id: options.habitId,
      habit_name: options.habitName,
      start_date: options.startDate,
      end_date: options.endDate,
      days_back: options.daysBack,
      timezone: options.timezone,
    });
  }
}

export const analyticsApi = new AnalyticsApiClient();
