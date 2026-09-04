'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarPreferences } from '@ritual/shared-contracts';

import { useUIPreferences } from '@/hooks/use-ui-preferences';

const localKey = 'ritual:calendar-preferences:v2';

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
    version: 2,
    view: 'day',
    mode: 'plan',
    tasks_open: true,
    agents_open: true,
    pane_widths: { tasks: 288, agents: 336 },
    visible_source_ids: [],
    default_write_source_id: null,
    timezone: systemTimezone(),
    week_starts_on: localeWeekStart(),
    workday_start_minutes: 8 * 60,
    workday_end_minutes: 18 * 60,
    snap_minutes: 15,
    default_duration_minutes: 30,
  };
}

function readLocal(): CalendarPreferences | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(localKey) || 'null') as CalendarPreferences | null;
    return value?.version === 2 ? value : null;
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
    setPreferences({ ...defaultCalendarPreferences(), ...remote, pane_widths: { ...defaultCalendarPreferences().pane_widths, ...remote.pane_widths } });
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
