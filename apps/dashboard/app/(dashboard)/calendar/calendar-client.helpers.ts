import { format } from 'date-fns';
import type { HabitLog } from './tracker-events';
import type { WeekScheduledItem } from './calendar-week-view';

export type ScheduledBlockApi = {
  id: string;
  title: string;
  notes?: string | null;
  day: string;
  start_minutes: number;
  end_minutes: number;
};

export type ScheduledBlockPayload = {
  title: string;
  notes: string | null;
  day: string;
  start_minutes: number;
  end_minutes: number;
};

export type ProjectTimeSessionRow = {
  session_uid: string;
  project_name?: string;
  task_name?: string;
  start_ts?: number;
  end_ts?: number;
  active_ms?: number;
  confidence?: number;
  apps?: Array<{ name?: string; active_ms?: number }>;
  domains?: Array<{ name?: string; active_ms?: number }>;
};

export type ProjectTimeSessionsResponse = {
  success: boolean;
  data?: ProjectTimeSessionRow[];
};

export const LEGACY_SCHEDULED_BLOCK_KEYS = [
  'calendar-scheduled-blocks',
  'calendar-week-scheduled-blocks',
  'ritual-calendar-scheduled-blocks',
  'scheduled-blocks',
  'week-scheduled-items',
] as const;

export const LEGACY_SCHEDULED_BLOCK_KEY_PATTERN = /(calendar|week).*(scheduled|block)|scheduled.*block/i;
export const LEGACY_SCHEDULED_BLOCK_MIGRATION_VERSION = 'v1';

export type TooltipMetricSummary = {
  key: string;
  habitName: string;
  metricType?: string;
  unitType?: string;
  totalDuration: number;
  totalAmount: number;
};

const METRIC_TYPE_LABELS: Record<string, string> = {
  active_energy: 'Active Calories',
  basal_energy: 'Resting Calories',
  exercise_time: 'Exercise Minutes',
  flights_climbed: 'Flights Climbed',
  hr: 'Heart Rate',
  hrv: 'HRV',
  mindful_minutes: 'Mindful Minutes',
  oxygen_saturation: 'Blood Oxygen',
  respiratory_rate: 'Respiratory Rate',
  resting_hr: 'Resting Heart Rate',
  sleep_core: 'Core Sleep',
  sleep_deep: 'Deep Sleep',
  sleep_rem: 'REM Sleep',
  sleep_session: 'Sleep Session',
  stand_time: 'Stand Time',
  walking_hr: 'Walking Heart Rate',
};

function formatMetricTypeLabel(metricType?: string): string | null {
  if (!metricType) return null;
  const normalized = metricType.trim().toLowerCase();
  if (!normalized || normalized === 'none') return null;
  if (METRIC_TYPE_LABELS[normalized]) return METRIC_TYPE_LABELS[normalized];
  return normalized
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

export function formatDurationDisplay(durationSeconds: number): string {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatAmountDisplay(amount: number): string {
  if (Number.isInteger(amount)) return amount.toString();
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return rounded.toString();
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}

export function formatTooltipMetricName(item: TooltipMetricSummary): string {
  const metricLabel = formatMetricTypeLabel(item.metricType);
  if (!metricLabel) return item.habitName;

  const habitNameLower = item.habitName.trim().toLowerCase();
  if (habitNameLower.includes(metricLabel.toLowerCase())) return item.habitName;
  return `${item.habitName} (${metricLabel})`;
}

export function formatTooltipMetricValue(item: TooltipMetricSummary): string {
  if (item.totalDuration > 0) return formatDurationDisplay(item.totalDuration);
  if (item.totalAmount !== 0) {
    const formattedAmount = formatAmountDisplay(item.totalAmount);
    return item.unitType ? `${formattedAmount} ${item.unitType}` : formattedAmount;
  }

  const normalizedUnit = item.unitType?.trim().toLowerCase() ?? '';
  if (normalizedUnit) {
    if (['hour', 'hours', 'hr', 'hrs'].includes(normalizedUnit)) return '0h 0m';
    if (['minute', 'minutes', 'min', 'mins'].includes(normalizedUnit)) return '0m';
    if (['second', 'seconds', 'sec', 'secs'].includes(normalizedUnit)) return '0s';
    if (!['count', 'counts', 'times'].includes(normalizedUnit)) return `0 ${item.unitType}`;
  }

  return 'Completed';
}

export function aggregateTooltipMetrics(dayLogs: HabitLog[]): TooltipMetricSummary[] {
  const grouped = new Map<string, TooltipMetricSummary>();

  dayLogs.forEach((log) => {
    const habitName = (log.habit_name || 'Unknown').trim() || 'Unknown';
    const metricType = log.metric_type?.trim() || undefined;
    const unitType = log.unit_type?.trim() || undefined;
    const key = `${habitName.toLowerCase()}|${metricType || ''}|${unitType || ''}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.totalDuration += log.duration || 0;
      existing.totalAmount += log.amount || 0;
      return;
    }

    grouped.set(key, {
      key,
      habitName,
      metricType,
      unitType,
      totalDuration: log.duration || 0,
      totalAmount: log.amount || 0,
    });
  });

  return Array.from(grouped.values()).sort((a, b) => {
    const labelCompare = formatTooltipMetricName(a).localeCompare(formatTooltipMetricName(b), undefined, {
      sensitivity: 'base',
    });
    if (labelCompare !== 0) return labelCompare;
    if (a.totalDuration !== b.totalDuration) return b.totalDuration - a.totalDuration;
    return b.totalAmount - a.totalAmount;
  });
}

function clampMinutes(minutes: number): number {
  return Math.max(0, Math.min(minutes, 24 * 60));
}

function parseMinutesLoose(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) ? Math.round(numericValue) : null;
  }

  const parts = trimmed.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isFinite(hours) && Number.isFinite(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
    return (hours * 60) + minutes;
  }
  return null;
}

function normalizeDayKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, 'yyyy-MM-dd');
}

export function extractLegacyArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];

  const container = raw as Record<string, unknown>;
  for (const key of ['scheduledBlocks', 'blocks', 'items', 'events', 'value', 'data']) {
    const candidate = container[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function readLegacyMinutes(item: Record<string, unknown>, minuteKeys: string[], hourKeys: string[]): number | null {
  for (const key of minuteKeys) {
    const parsed = parseMinutesLoose(item[key]);
    if (parsed !== null) return parsed;
  }

  for (const key of hourKeys) {
    const rawValue = item[key];
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return Math.round(rawValue * 60);
    if (typeof rawValue === 'string' && rawValue.trim()) {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) return Math.round(parsed * 60);
    }
  }

  return null;
}

export function normalizeLegacyBlock(raw: unknown): ScheduledBlockPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const day = normalizeDayKey(item.day ?? item.dayKey ?? item.date ?? item.dayISO);
  const start = readLegacyMinutes(item, ['startMinutes', 'start_minutes', 'startMinute', 'start'], ['startHour', 'start_hour']);
  const end = readLegacyMinutes(item, ['endMinutes', 'end_minutes', 'endMinute', 'end'], ['endHour', 'end_hour']);

  if (!day || start === null || end === null) return null;
  if (start < 0 || start > 1439 || end < 1 || end > 1440 || end <= start) return null;

  const rawTitle = item.title ?? item.name ?? item.label;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : 'Untitled block';
  const rawNotes = item.notes ?? item.note ?? item.description;
  const notes = typeof rawNotes === 'string' && rawNotes.trim() ? rawNotes.trim() : null;

  return {
    title,
    notes,
    day,
    start_minutes: clampMinutes(start),
    end_minutes: Math.max(clampMinutes(end), clampMinutes(start + 30)),
  };
}

export function signatureFromPayload(item: ScheduledBlockPayload): string {
  return `${item.day}|${item.start_minutes}|${item.end_minutes}|${item.title.toLowerCase()}|${(item.notes ?? '').toLowerCase()}`;
}

export function signatureFromApi(item: ScheduledBlockApi): string {
  return `${item.day}|${item.start_minutes}|${item.end_minutes}|${item.title.toLowerCase()}|${(item.notes ?? '').toLowerCase()}`;
}

export function formatMinutesDisplay(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, 24 * 60));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function formatMinutesInput(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, (23 * 60) + 45));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function parseMinutes(value: string): number | null {
  const [hours, minutes] = value.split(':').map((token) => Number(token));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function mapScheduledBlockFromApi(item: ScheduledBlockApi): WeekScheduledItem {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes ?? undefined,
    day: item.day,
    startMinutes: item.start_minutes,
    endMinutes: item.end_minutes,
  };
}

export function parseCalendarBlockSubtitle(subtitle?: string | null): {
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
} | null {
  const match = (subtitle || "").match(/^(\d{4}-\d{2}-\d{2})\s·\s(\d{2}):(\d{2})[–-](\d{2}):(\d{2})$/);
  if (!match) return null;
  return {
    dayKey: match[1],
    startMinutes: Number(match[2]) * 60 + Number(match[3]),
    endMinutes: Number(match[4]) * 60 + Number(match[5]),
  };
}
