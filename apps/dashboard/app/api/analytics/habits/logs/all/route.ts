import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { addDays, format, subDays } from 'date-fns';
import { API_CONFIG } from '@/lib/api-config';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';
import {
  getWearableMetricCategory,
  humanizeWearableMetric,
  isDailyWearableTimelineItem,
  type WearableTimelineItem,
  type WearableTimelineResponse,
} from '@/lib/wearables-dashboard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type HabitMeta = {
  id: string;
  name?: string;
  category: string;
  icon?: string;
  unit_type?: string;
  integration_source?: string;
  metric_type?: string;
};

type NormalizedLog = {
  id: string;
  habit_id?: string;
  habit_name: string;
  category: string;
  icon?: string;
  date: string;
  raw_date?: string;
  completed_at?: string;
  duration?: number;
  amount?: number;
  unit_type?: string;
  status: 'completed' | 'skipped' | 'missed';
  notes?: string;
  integration_source?: string;
  metric_type?: string | null;
  time_precision: 'exact' | 'day';
  metadata?: Record<string, unknown>;
  editable: boolean;
  record_kind: 'habit_log' | 'wearable_sample' | 'wearable_event';
  start_time?: string;
  end_time?: string;
  rollup_level?: string | null;
  aggregation_kind?: string | null;
  source_device_name?: string | null;
};

function parseCompletedAt(value?: string | null): Date | null {
  if (!value || typeof value !== 'string') return null;

  try {
    if (value.includes('T')) {
      const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
      const normalized = hasTimezone ? value : `${value}Z`;
      const parsed = new Date(normalized);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    if (value.includes(' ')) {
      const parsed = new Date(value.replace(' ', 'T') + 'Z');
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
  } catch {
    return null;
  }

  return null;
}

function formatDateInTimeZone(value: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall through to UTC formatting.
  }

  return format(value, 'yyyy-MM-dd');
}

function shiftDateKey(dateValue: string, deltaDays: number): string {
  const anchor = new Date(`${dateValue}T12:00:00Z`);
  return format(addDays(anchor, deltaDays), 'yyyy-MM-dd');
}

function buildHabitLookup(habits: HabitMeta[]) {
  const byId = new Map<string, HabitMeta>();
  const byProviderMetric = new Map<string, HabitMeta>();
  const byMetric = new Map<string, HabitMeta>();

  for (const habit of habits) {
    byId.set(habit.id, habit);
    const metricType = String(habit.metric_type || '').trim().toLowerCase();
    const provider = String(habit.integration_source || '').trim().toLowerCase();
    if (metricType) {
      const metricKey = `${provider}:${metricType}`;
      if (!byProviderMetric.has(metricKey)) {
        byProviderMetric.set(metricKey, habit);
      }
      if (!byMetric.has(metricType)) {
        byMetric.set(metricType, habit);
      }
    }
  }

  return { byId, byProviderMetric, byMetric };
}

function getMatchedHabit(
  item: WearableTimelineItem,
  habitLookup: ReturnType<typeof buildHabitLookup>,
): HabitMeta | null {
  if (item.kind === 'habit_log' && item.habit_id) {
    return habitLookup.byId.get(item.habit_id) || null;
  }

  const provider = String(item.provider || '').trim().toLowerCase();
  const metricType = String(item.metric_type || item.event_type || '').trim().toLowerCase();
  if (!metricType) return null;

  return (
    habitLookup.byProviderMetric.get(`${provider}:${metricType}`)
    || habitLookup.byMetric.get(metricType)
    || null
  );
}

function parseMetadataObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function getTimelineDate(
  item: WearableTimelineItem,
  timeZone: string,
): { date: string; rawDate: string } {
  const rawDate = String(item.attributed_date || '').slice(0, 10);
  if (isDailyWearableTimelineItem(item)) {
    return { date: rawDate, rawDate };
  }

  const parsed = parseCompletedAt(item.start_time || item.timestamp);
  if (parsed) {
    const normalized = formatDateInTimeZone(parsed, timeZone);
    return { date: normalized, rawDate };
  }

  return { date: rawDate, rawDate };
}

function normalizeTimelineItem(
  item: WearableTimelineItem,
  habits: ReturnType<typeof buildHabitLookup>,
  timeZone: string,
): NormalizedLog | null {
  const matchedHabit = getMatchedHabit(item, habits);
  const metricType = String(item.metric_type || item.event_type || matchedHabit?.metric_type || '').trim().toLowerCase() || null;
  const source = String(item.provider || matchedHabit?.integration_source || 'manual').trim().toLowerCase();
  const title = matchedHabit?.name || item.habit_name || item.title || humanizeWearableMetric(metricType);
  const { date, rawDate } = getTimelineDate(item, timeZone);

  if (!date) return null;

  const start = item.start_time || item.timestamp;
  const end = item.end_time || item.start_time || item.timestamp;
  const startDate = parseCompletedAt(start);
  const endDate = parseCompletedAt(end);
  const durationSeconds = startDate && endDate
    ? Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000))
    : undefined;

  const metadata = {
    ...(parseMetadataObject((item as any).metadata) || {}),
    provider: item.provider || null,
    record_kind: item.kind,
    metric_type: metricType,
    aggregation_kind: item.aggregation_kind || null,
    rollup_level: item.rollup_level || null,
    rollup_window_minutes: item.rollup_window_minutes ?? null,
    source_device_name: item.source_device_name || null,
    start_time: start || null,
    end_time: end || null,
  };

  return {
    id: item.id,
    habit_id: matchedHabit?.id || item.habit_id || undefined,
    habit_name: title,
    category: matchedHabit?.category || getWearableMetricCategory(metricType),
    icon: matchedHabit?.icon,
    date,
    raw_date: rawDate,
    completed_at: start || undefined,
    duration: item.kind === 'wearable_event' && durationSeconds && durationSeconds > 0 ? durationSeconds : undefined,
    amount: Number.isFinite(Number(item.value)) ? Number(item.value) : undefined,
    unit_type: matchedHabit?.unit_type || item.unit || undefined,
    status: (item.status as 'completed' | 'skipped' | 'missed') || 'completed',
    notes: item.notes || undefined,
    integration_source: source,
    metric_type: metricType,
    time_precision: isDailyWearableTimelineItem(item) ? 'day' : 'exact',
    metadata,
    editable: item.kind === 'habit_log' && Boolean(item.habit_id || matchedHabit?.id),
    record_kind:
      item.kind === 'wearable_sample'
        ? 'wearable_sample'
        : item.kind === 'wearable_event'
          ? 'wearable_event'
          : 'habit_log',
    start_time: start || undefined,
    end_time: end || undefined,
    rollup_level: item.rollup_level || null,
    aggregation_kind: item.aggregation_kind || null,
    source_device_name: item.source_device_name || null,
  };
}

function dedupeDailyRowsWhenGranularExists(items: WearableTimelineItem[]): WearableTimelineItem[] {
  const granularKeys = new Set(
    items
      .filter((item) => item.kind === 'wearable_sample')
      .filter((item) => !isDailyWearableTimelineItem(item))
      .map((item) => `${item.provider || ''}|${item.metric_type || ''}|${item.attributed_date || ''}`),
  );

  return items.filter((item) => {
    if (item.kind !== 'wearable_sample') return true;
    if (!isDailyWearableTimelineItem(item)) return true;
    if (!item.attributed_date) return true;
    const duplicateKey = `${item.provider || ''}|${item.metric_type || ''}|${item.attributed_date || ''}`;
    return !granularKeys.has(duplicateKey);
  });
}

export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const token = await getToken();
    const { searchParams } = new URL(request.url);

    const q = searchParams.get('q');
    const startDate = searchParams.get('start_date') || format(subDays(new Date(), 90), 'yyyy-MM-dd');
    const endDate = searchParams.get('end_date') || format(new Date(), 'yyyy-MM-dd');
    const categories = searchParams.get('categories')?.split(',').filter(Boolean) || [];
    const habits = searchParams.get('habits')?.split(',').filter(Boolean) || [];
    const statuses = searchParams.get('statuses')?.split(',').filter(Boolean) || [];
    const sources = searchParams.get('sources')?.split(',').filter(Boolean) || [];
    const sort = searchParams.get('sort') || 'time';
    const order = searchParams.get('order') || 'desc';
    const timezone = searchParams.get('timezone') || 'UTC';
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '200', 10);
    const requestedOffset = Number.parseInt(searchParams.get('offset') || '0', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const queryStartDate = shiftDateKey(startDate, -1);
    const queryEndDate = shiftDateKey(endDate, 1);
    const includeManualLogs = !sources.length || sources.some((source) => source.toLowerCase() === 'manual');

    const [habitsResponse, timelineResponse] = await Promise.all([
      fetch(`${API_CONFIG.PYTHON_API_URL}/api/habits`, {
        headers: buildBackendAuthHeaders({ userId, token }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }),
      fetch(
        `${API_CONFIG.PYTHON_API_URL}/api/wearables/timeline?start_time=${encodeURIComponent(`${queryStartDate}T00:00:00Z`)}&end_time=${encodeURIComponent(`${queryEndDate}T23:59:59Z`)}&include_manual_logs=${includeManualLogs ? 'true' : 'false'}&limit=5000`,
        {
          headers: buildBackendAuthHeaders({ userId, token }),
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        },
      ),
    ]);

    if (!habitsResponse.ok) {
      throw new Error(`Failed to fetch habits metadata (${habitsResponse.status})`);
    }
    if (!timelineResponse.ok) {
      throw new Error(`Failed to fetch wearable timeline (${timelineResponse.status})`);
    }

    const rawHabits = await habitsResponse.json();
    const habitsList: HabitMeta[] = Array.isArray(rawHabits)
      ? rawHabits.map((habit: any) => ({
          id: habit.id,
          name: habit.name,
          category: habit.category || 'uncategorized',
          icon: habit.icon,
          unit_type: habit.unit_type,
          integration_source: habit.integration_source,
          metric_type: habit.metric_type,
        }))
      : [];
    const habitLookup = buildHabitLookup(habitsList);

    const timelinePayload = (await timelineResponse.json()) as WearableTimelineResponse;
    let logs = dedupeDailyRowsWhenGranularExists(timelinePayload.items || [])
      .map((item) => normalizeTimelineItem(item, habitLookup, timezone))
      .filter((item): item is NormalizedLog => Boolean(item));

    logs = logs.filter((log) => log.date >= startDate && log.date <= endDate);

    if (q) {
      const searchLower = q.toLowerCase();
      logs = logs.filter((log) =>
        log.habit_name?.toLowerCase().includes(searchLower)
        || log.notes?.toLowerCase().includes(searchLower),
      );
    }

    if (categories.length > 0) {
      logs = logs.filter((log) =>
        categories.some((category) => log.category?.toLowerCase() === category.toLowerCase()),
      );
    }

    if (habits.length > 0) {
      logs = logs.filter((log) => log.habit_id && habits.includes(log.habit_id));
    }

    if (statuses.length > 0) {
      logs = logs.filter((log) => statuses.includes(log.status));
    }

    if (sources.length > 0) {
      logs = logs.filter((log) => {
        const logSource = log.integration_source || 'manual';
        return sources.some((source) => logSource.toLowerCase() === source.toLowerCase());
      });
    }

    logs.sort((left, right) => {
      let leftValue: any;
      let rightValue: any;

      switch (sort) {
        case 'date':
          leftValue = new Date(left.date).getTime();
          rightValue = new Date(right.date).getTime();
          break;
        case 'habit':
          leftValue = left.habit_name?.toLowerCase() || '';
          rightValue = right.habit_name?.toLowerCase() || '';
          break;
        case 'value':
          leftValue = left.amount || left.duration || 0;
          rightValue = right.amount || right.duration || 0;
          break;
        case 'category':
          leftValue = left.category?.toLowerCase() || '';
          rightValue = right.category?.toLowerCase() || '';
          break;
        case 'status':
          leftValue = left.status || '';
          rightValue = right.status || '';
          break;
        case 'time':
          leftValue = left.completed_at ? new Date(left.completed_at).getTime() : new Date(left.date).getTime();
          rightValue = right.completed_at ? new Date(right.completed_at).getTime() : new Date(right.date).getTime();
          break;
        default:
          leftValue = (left as any)[sort] || '';
          rightValue = (right as any)[sort] || '';
      }

      if (leftValue < rightValue) return order === 'asc' ? -1 : 1;
      if (leftValue > rightValue) return order === 'asc' ? 1 : -1;
      return 0;
    });

    const totalFiltered = logs.length;
    const totalDuration = logs.reduce((sum, log) => sum + Number(log.duration || 0), 0);
    const totalAmount = logs.reduce((sum, log) => sum + Number(log.amount || 0), 0);
    const completedCount = logs.filter((log) => log.status === 'completed').length;
    const pagedLogs = logs.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      data: pagedLogs,
      meta: {
        total: pagedLogs.length,
        totalFiltered,
        offset,
        limit,
        hasMore: offset + pagedLogs.length < totalFiltered,
        filters: { q, startDate, endDate, categories, habits, statuses, sources },
        sort: { column: sort, order },
        totals: {
          count: totalFiltered,
          totalDuration,
          totalAmount,
          completedCount,
          completionRate: totalFiltered > 0 ? (completedCount / totalFiltered) * 100 : 0,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching habit logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch habit logs',
      },
      { status: 500 },
    );
  }
}
