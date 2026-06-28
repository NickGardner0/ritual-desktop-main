'use client';

import type {
  BuiltInFilterPresetId,
  FilterState,
  SavedFilterView,
  TableDensity,
} from '@/components/habit-logs/types';

export const defaultFilters: FilterState = {
  q: null,
  start: null,
  end: null,
  categories: null,
  habits: null,
  statuses: null,
  sources: null,
};

export const BUILT_IN_PRESETS: Array<{ id: BuiltInFilterPresetId; label: string }> = [
  { id: 'all', label: 'All logs' },
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'completed', label: 'Completed' },
  { id: 'manual', label: 'Manual source' },
];
export const LOGS_PAGE_SIZE = 200;

export function toLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

export function cloneFilters(filters: FilterState): FilterState {
  return {
    q: filters.q ?? null,
    start: filters.start ?? null,
    end: filters.end ?? null,
    categories: filters.categories ? [...filters.categories] : null,
    habits: filters.habits ? [...filters.habits] : null,
    statuses: filters.statuses ? [...filters.statuses] : null,
    sources: filters.sources ? [...filters.sources] : null,
  };
}

export function parseListParam(value: string | null): string[] | null {
  if (!value) return null;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

export function buildDateTimeForUpdatedDate(nextDate: string, completedAt?: string): string {
  const isoTime = completedAt?.match(/T(\d{2}:\d{2}:\d{2})/)?.[1];
  const spacedTime = completedAt?.match(/ (\d{2}:\d{2}:\d{2})/)?.[1];
  const shortTime = completedAt?.match(/(\d{1,2}:\d{2})(?!:\d{2})/)?.[1];

  const time = isoTime || spacedTime || (shortTime ? `${shortTime}:00` : '12:00:00');
  return `${nextDate} ${time}`;
}

export function readSavedViewsFromStorage(storageKey: string): SavedFilterView[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as SavedFilterView[];
    return parsed
      .filter((view) => view && view.id && view.name)
      .map((view) => ({
        ...view,
        filters: cloneFilters(view.filters),
      }));
  } catch {
    return [];
  }
}

export function readDensityFromStorage(storageKey: string): TableDensity {
  if (typeof window === 'undefined') return 'comfortable';
  const storedDensity = localStorage.getItem(storageKey);
  return storedDensity === 'compact' || storedDensity === 'comfortable'
    ? storedDensity
    : 'comfortable';
}

export function getFiltersForPreset(presetId: BuiltInFilterPresetId): FilterState {
  const now = new Date();

  switch (presetId) {
    case 'today': {
      const today = toLocalDateString(now);
      return {
        ...defaultFilters,
        start: today,
        end: today,
      };
    }
    case 'last7': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return {
        ...defaultFilters,
        start: toLocalDateString(start),
        end: toLocalDateString(now),
      };
    }
    case 'completed':
      return {
        ...defaultFilters,
        statuses: ['completed'],
      };
    case 'manual':
      return {
        ...defaultFilters,
        sources: ['manual'],
      };
    case 'all':
    default:
      return cloneFilters(defaultFilters);
  }
}
