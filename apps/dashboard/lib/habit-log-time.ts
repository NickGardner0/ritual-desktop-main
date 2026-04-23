import { format, parseISO } from 'date-fns';

export type HabitLogTimeLike = {
  date?: string | null;
  completed_at?: string | null;
  integration_source?: string | null;
  metric_type?: string | null;
  time_precision?: string | null;
};

function extractDateOnly(value?: string | null): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 10)
    : '';
}

function parseCompletedAt(completedAt?: string | null): Date | null {
  if (!completedAt || typeof completedAt !== 'string') return null;

  try {
    if (completedAt.includes('T')) {
      const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(completedAt);
      const normalized = hasTimezone ? completedAt : `${completedAt}Z`;
      const parsed = parseISO(normalized);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    if (completedAt.includes(' ')) {
      const parsed = new Date(completedAt.replace(' ', 'T') + 'Z');
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function isDayLevelAggregateHabitLog(log: HabitLogTimeLike): boolean {
  const timePrecision = String(log.time_precision || '').trim().toLowerCase();
  if (timePrecision === 'day') return true;
  if (timePrecision === 'exact') return false;

  const integrationSource = String(log.integration_source || '').trim().toLowerCase();
  const metricType = String(log.metric_type || '').trim().toLowerCase();

  if (!metricType) return false;
  return integrationSource === 'apple_health'
    && metricType !== 'sleep_total'
    && metricType !== 'workout';
}

export function getHabitLogLocalDate(log: HabitLogTimeLike): string {
  if (isDayLevelAggregateHabitLog(log)) {
    return extractDateOnly(log.date);
  }

  const parsed = parseCompletedAt(log.completed_at);
  if (parsed) {
    return format(parsed, 'yyyy-MM-dd');
  }

  return extractDateOnly(log.date);
}

export function formatHabitLogDisplayDate(log: HabitLogTimeLike, pattern: string): string {
  const localDate = getHabitLogLocalDate(log);
  if (!localDate) return '—';

  try {
    return format(parseISO(localDate), pattern);
  } catch {
    return localDate;
  }
}

export function formatHabitLogDisplayTime(log: HabitLogTimeLike): string {
  if (isDayLevelAggregateHabitLog(log)) {
    return '—';
  }

  const parsed = parseCompletedAt(log.completed_at);
  if (parsed) {
    return format(parsed, 'h:mm a');
  }

  return typeof log.completed_at === 'string' && log.completed_at.trim()
    ? log.completed_at.trim()
    : '—';
}
