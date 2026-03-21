/**
 * Analytics API Service - Frontend client for Python analytics backend
 *
 * Python analytics is used as a fallback path when Tinybird analytics
 * endpoints are unavailable.
 */

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// ====================
// TYPES
// ====================

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

export interface CorrelationResponse {
  success: boolean;
  error?: string;
  available_habits?: string[];
  habits?: {
    habit1: { id: string; name: string; unit: string };
    habit2: { id: string; name: string; unit: string };
  };
  date_range?: {
    start: string;
    end: string;
  };
  correlation?: {
    coefficient: number;
    strength: string;
    direction: string;
    interpretation: string;
  };
  data_points?: {
    habit1_days: number;
    habit2_days: number;
    overlapping_days: number;
  };
  habit1_stats?: {
    mean: number;
    total: number;
  };
  habit2_stats?: {
    mean: number;
    total: number;
  };
}

export interface HabitListItem {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  integration_source: string | null;
}

export interface ListHabitsResponse {
  success: boolean;
  total_habits: number;
  by_category: Record<string, HabitListItem[]>;
  habits: HabitListItem[];
}

// ====================
// API CLIENT
// ====================

class AnalyticsApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = PYTHON_API_BASE;
  }

  private async fetch<T>(endpoint: string, token: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Propagate failures so the UI can render explicit error states.
      if (response.status === 429) {
        throw new Error('Analytics API rate limited (429). Please retry shortly.');
      }
      const errorText = await response.text();
      console.error(`Analytics API error: ${response.status} - ${errorText}`);
      throw new Error(`Analytics API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get comprehensive statistics for one or all habits
   */
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

  /**
   * Get day-by-day breakdown for a specific habit
   */
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

  /**
   * Calculate correlation between two habits
   */
  async getCorrelation(
    token: string,
    options: {
      habit1Id?: string;
      habit1Name?: string;
      habit2Id?: string;
      habit2Name?: string;
      daysBack?: number;
    }
  ): Promise<CorrelationResponse> {
    return this.fetch<CorrelationResponse>('/api/analytics/correlation', token, {
      habit1_id: options.habit1Id,
      habit1_name: options.habit1Name,
      habit2_id: options.habit2Id,
      habit2_name: options.habit2Name,
      days_back: options.daysBack,
    });
  }

  /**
   * List all habits for the user
   */
  async listHabits(token: string): Promise<ListHabitsResponse> {
    return this.fetch<ListHabitsResponse>('/api/analytics/list-habits', token);
  }
}

// Export singleton instance
export const analyticsApi = new AnalyticsApiClient();

// ====================
// REACT HOOKS
// ====================

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';

export function useHabitStats(options?: {
  habitId?: string;
  habitName?: string;
  startDate?: string;
  endDate?: string;
  daysBack?: number;
  enabled?: boolean;
}) {
  const { getToken } = useAuth();
  const [data, setData] = useState<HabitStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (options?.enabled === false) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      
      const result = await analyticsApi.getHabitStats(token, options);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [getToken, options?.habitId, options?.habitName, options?.startDate, options?.endDate, options?.daysBack, options?.enabled]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { data, loading, error, refetch: fetchStats };
}

export function useDailyBreakdown(options: {
  habitId?: string;
  habitName?: string;
  daysBack?: number;
  enabled?: boolean;
}) {
  const { getToken } = useAuth();
  const [data, setData] = useState<DailyBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBreakdown = useCallback(async () => {
    if (options?.enabled === false) return;
    if (!options.habitId && !options.habitName) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      
      const result = await analyticsApi.getDailyBreakdown(token, options);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [getToken, options.habitId, options.habitName, options.daysBack, options?.enabled]);

  useEffect(() => {
    fetchBreakdown();
  }, [fetchBreakdown]);

  return { data, loading, error, refetch: fetchBreakdown };
}

export function useCorrelation(options: {
  habit1Id?: string;
  habit1Name?: string;
  habit2Id?: string;
  habit2Name?: string;
  daysBack?: number;
  enabled?: boolean;
}) {
  const { getToken } = useAuth();
  const [data, setData] = useState<CorrelationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCorrelation = useCallback(async () => {
    if (options?.enabled === false) return;
    if ((!options.habit1Id && !options.habit1Name) || (!options.habit2Id && !options.habit2Name)) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      
      const result = await analyticsApi.getCorrelation(token, options);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [getToken, options.habit1Id, options.habit1Name, options.habit2Id, options.habit2Name, options.daysBack, options?.enabled]);

  useEffect(() => {
    fetchCorrelation();
  }, [fetchCorrelation]);

  return { data, loading, error, refetch: fetchCorrelation };
}
