'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarPreferences } from '@ritual/shared-contracts';

import { useUIPreferences } from '@/hooks/use-ui-preferences';

const localKey = 'ritual:calendar-preferences:v3';

function systemTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function localeWeekStart(): 0 | 1 {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const firstDay = locale.weekInfo?.firstDay ?? locale.getWeekInfo?.().firstDay;
    return firstDay === 1 ? 1 : 0;
  } catch {
    return 0;
  }
}

export function defaultCalendarPreferences(): CalendarPreferences {
  return {
    version: 3,
    view: 'week',
    mode: 'plan',
    tasks_open: false,
    side_panel_open: true,
    show_weekends: true,
    time_format: '12h',
    visible_source_ids: [],
    default_write_source_id: null,
    timezone: systemTimezone(),
    week_starts_on: localeWeekStart(),
    workday_start_minutes: 8 * 60,
    workday_end_minutes: 18 * 60,
    snap_minutes: 30,
    default_duration_minutes: 30,
  };
}

function normalizePreferences(value: Partial<CalendarPreferences> & { version?: number } | null): CalendarPreferences {
  const defaults = defaultCalendarPreferences();
  if (!value) return defaults;
  const legacy = value.version !== 3;
  return {
    ...defaults,
    ...value,
    version: 3,
    view: legacy && value.view === 'day' ? 'week' : value.view ?? defaults.view,
    tasks_open: legacy ? false : value.tasks_open ?? false,
    side_panel_open: value.side_panel_open ?? true,
    show_weekends: value.show_weekends ?? true,
    time_format: value.time_format === '24h' ? '24h' : '12h',
    snap_minutes: legacy ? 30 : value.snap_minutes ?? defaults.snap_minutes,
  };
}

function readLocal(): CalendarPreferences | null {
  try {
    const current = JSON.parse(window.localStorage.getItem(localKey) || 'null') as CalendarPreferences | null;
    if (current) return normalizePreferences(current);
    const legacy = JSON.parse(window.localStorage.getItem('ritual:calendar-preferences:v2') || 'null') as Partial<CalendarPreferences> | null;
    return legacy ? normalizePreferences(legacy) : null;
  } catch {
    return null;
  }
}

export function useCalendarPreferences() {
  const { calendarPreferences: remote, setCalendarPreferences } = useUIPreferences();
  const [preferences, setPreferences] = useState<CalendarPreferences>(() => {
    if (typeof window === 'undefined') return defaultCalendarPreferences();
    return readLocal() ?? defaultCalendarPreferences();
  });
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current || !remote) return;
    hydrated.current = true;
    setPreferences(normalizePreferences(remote));
  }, [remote]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(localKey, JSON.stringify(preferences));
    const timer = window.setTimeout(() => void setCalendarPreferences(preferences).catch(() => undefined), 350);
    return () => window.clearTimeout(timer);
  }, [preferences, setCalendarPreferences]);

  const patchPreferences = useCallback((patch: Partial<CalendarPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  return useMemo(() => ({ preferences, patchPreferences, setPreferences }), [patchPreferences, preferences]);
}
