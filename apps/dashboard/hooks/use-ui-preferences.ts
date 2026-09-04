'use client';

import { useCallback } from 'react';
import { useAuth, useUser } from '@/lib/desktop-session';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiOperationWithAuth } from '@/lib/api/client';
import type { CalendarPreferences } from '@ritual/shared-contracts';
const LOCAL_STORAGE_KEY = 'ritual:ui-preferences:v1';
const QUERY_KEY = ['ui-preferences'];

export const DEFAULT_HABIT_TEXT_COLOR = '#000000';
export const DEFAULT_OVERVIEW_VIEW_MODE: OverviewViewMode = 'list';

export type OverviewViewMode = 'list' | 'summary';

function isOverviewViewMode(value: unknown): value is OverviewViewMode {
  return value === 'list' || value === 'summary';
}

export interface UIPreferences {
  habit_text_color: string | null;
  overview_view_mode: OverviewViewMode | null;
  calendar_preferences: CalendarPreferences | null;
}

function readCachedPreferences(): UIPreferences | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<UIPreferences> | null;
    if (!parsed || typeof parsed !== 'object') return undefined;
    return {
      habit_text_color:
        typeof parsed.habit_text_color === 'string' ? parsed.habit_text_color : null,
      overview_view_mode: isOverviewViewMode(parsed.overview_view_mode)
        ? parsed.overview_view_mode
        : null,
      calendar_preferences:
        parsed.calendar_preferences && typeof parsed.calendar_preferences === 'object'
          ? parsed.calendar_preferences as CalendarPreferences
          : null,
    };
  } catch {
    return undefined;
  }
}

function writeCachedPreferences(prefs: UIPreferences) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / serialization errors
  }
}

export function useUIPreferences() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<UIPreferences>({
    queryKey: [...QUERY_KEY, user?.id],
    queryFn: async () => {
      const data = await apiOperationWithAuth(
        'get_ui_preferences_api_ui_preferences_get',
        getToken,
        {},
        user?.id,
      ) as { habit_text_color?: string | null; overview_view_mode?: unknown; calendar_preferences?: CalendarPreferences | null };
      const prefs: UIPreferences = {
        habit_text_color:
          typeof data?.habit_text_color === 'string' ? data.habit_text_color : null,
        overview_view_mode: isOverviewViewMode(data?.overview_view_mode)
          ? data.overview_view_mode
          : null,
        calendar_preferences: data?.calendar_preferences ?? null,
      };
      writeCachedPreferences(prefs);
      return prefs;
    },
    enabled: !!user?.id,
    initialData: readCachedPreferences,
    staleTime: 1000 * 60 * 5,
  });

  const habitTextColor = query.data?.habit_text_color ?? DEFAULT_HABIT_TEXT_COLOR;
  const overviewViewMode: OverviewViewMode =
    query.data?.overview_view_mode ?? DEFAULT_OVERVIEW_VIEW_MODE;
  const calendarPreferences = query.data?.calendar_preferences ?? null;

  const setHabitTextColor = useCallback(
    async (color: string | null) => {
      const previous = query.data ?? { habit_text_color: null, overview_view_mode: null, calendar_preferences: null };
      const next: UIPreferences = {
        ...previous,
        habit_text_color: color,
      };
      queryClient.setQueryData<UIPreferences>([...QUERY_KEY, user?.id], next);
      writeCachedPreferences(next);

      try {
        await apiOperationWithAuth(
          'update_ui_preferences_api_ui_preferences_patch',
          getToken,
          { body: { habit_text_color: color } },
          user?.id,
        );
      } catch {
        queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, user?.id] });
        throw new Error('Failed to save UI preferences');
      }
    },
    [getToken, queryClient, query.data, user?.id],
  );

  const setOverviewViewMode = useCallback(
    async (mode: OverviewViewMode) => {
      const previous = query.data ?? { habit_text_color: null, overview_view_mode: null, calendar_preferences: null };
      const next: UIPreferences = {
        ...previous,
        overview_view_mode: mode,
      };
      queryClient.setQueryData<UIPreferences>([...QUERY_KEY, user?.id], next);
      writeCachedPreferences(next);

      try {
        await apiOperationWithAuth(
          'update_ui_preferences_api_ui_preferences_patch',
          getToken,
          { body: { overview_view_mode: mode } },
          user?.id,
        );
      } catch {
        queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, user?.id] });
        throw new Error('Failed to save UI preferences');
      }
    },
    [getToken, queryClient, query.data, user?.id],
  );

  const setCalendarPreferences = useCallback(
    async (preferences: CalendarPreferences) => {
      const previous = query.data ?? { habit_text_color: null, overview_view_mode: null, calendar_preferences: null };
      const next: UIPreferences = { ...previous, calendar_preferences: preferences };
      queryClient.setQueryData<UIPreferences>([...QUERY_KEY, user?.id], next);
      writeCachedPreferences(next);

      try {
        await apiOperationWithAuth(
          'update_ui_preferences_api_ui_preferences_patch',
          getToken,
          { body: { calendar_preferences: preferences } },
          user?.id,
        );
      } catch {
        queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, user?.id] });
        throw new Error('Failed to save calendar preferences');
      }
    },
    [getToken, queryClient, query.data, user?.id],
  );

  return {
    habitTextColor,
    setHabitTextColor,
    overviewViewMode,
    setOverviewViewMode,
    calendarPreferences,
    setCalendarPreferences,
    isLoading: query.isLoading,
  };
}

/**
 * WCAG 2.0 relative luminance + contrast ratio.
 * Returns the contrast ratio of `hex` against white (#FFFFFF).
 * 1 = identical (no contrast). 21 = max contrast.
 */
export function contrastRatioAgainstWhite(hex: string): number {
  const cleaned = hex.replace('#', '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(cleaned)) return 21;
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return 1.05 / (luminance + 0.05);
}
