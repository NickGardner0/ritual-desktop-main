import type { DateRange } from 'react-day-picker';
import { format } from 'date-fns';

export type AnalyticsRangeKey = 'all-time' | `${string}:${string}`;

export type AnalyticsRangeWindow = {
  rangeKey: AnalyticsRangeKey;
  startDate?: string;
  endDate?: string;
  hasExplicitRange: boolean;
};

export function getAnalyticsRangeKey(dateRange?: DateRange): AnalyticsRangeKey {
  if (!dateRange?.from) {
    return 'all-time';
  }

  const fromKey = format(dateRange.from, 'yyyy-MM-dd');
  const toKey = format(dateRange.to ?? dateRange.from, 'yyyy-MM-dd');
  return `${fromKey}:${toKey}`;
}

export function getAnalyticsRangeWindow(dateRange?: DateRange): AnalyticsRangeWindow {
  const rangeKey = getAnalyticsRangeKey(dateRange);
  if (rangeKey === 'all-time') {
    return {
      rangeKey,
      hasExplicitRange: false,
    };
  }

  const [startDate, endDate] = rangeKey.split(':');
  return {
    rangeKey,
    startDate,
    endDate,
    hasExplicitRange: true,
  };
}
