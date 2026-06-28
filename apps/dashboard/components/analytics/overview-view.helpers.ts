import type { ComputerSnapshot } from '@/hooks/use-computer-snapshot-query';
import type {
  ComputerDailyResponseRow as ComputerDailyRow,
  ComputerSummaryResponse as ComputerSummaryState,
} from '@/lib/computerActivity';

export interface MetricLogEntry {
  habitId: string;
  localDate: string;
  amount: number | null;
  duration: number | null;
}

export const EMPTY_OVERVIEW_LOGS: MetricLogEntry[] = [];

export interface HabitMetricStatsData {
  unitLabel: string;
  sumFormatted: string;
  avgFormatted: string;
  minFormatted: string;
  maxFormatted: string;
  stdDevFormatted: string;
  daysWithData: number;
  trackedDays: number;
}

export interface HabitMetricData {
  display: string;
  stats: HabitMetricStatsData;
}

function formatMetricAmount(value: number, unitType: string): string {
  const rounded = Math.round(value * 100) / 100;
  const unitLower = unitType.toLowerCase();

  if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
    return Math.round(rounded).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  if (['miles', 'km', 'kilometers'].includes(unitLower)) {
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  if (['hours', 'minutes'].includes(unitLower)) {
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return Number.isInteger(rounded)
    ? rounded.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function isPercentLikeUnit(unitType: string): boolean {
  const normalized = unitType.trim().toLowerCase();
  return normalized.includes('percentage') || normalized === 'percent' || normalized === '%';
}

export function buildComputerSummaryFromRows(rows: ComputerDailyRow[]): ComputerSummaryState {
  const totalActiveMs = rows.reduce((sum, row) => sum + Number(row.active_ms || 0), 0);
  const totalHours = rows.reduce((sum, row) => sum + Number(row.active_hours || 0), 0);
  const totalEvents = rows.reduce((sum, row) => sum + Number(row.events_count || 0), 0);
  const daysTracked = rows.filter((row) => Number(row.active_ms || 0) > 0).length;

  return {
    total_active_ms: totalActiveMs,
    total_afk_ms: 0,
    total_hours: totalHours,
    total_events: totalEvents,
    days_tracked: daysTracked,
    avg_daily_hours: daysTracked > 0 ? totalHours / daysTracked : 0,
  };
}

export function getComputerSummaryHours(summary: ComputerSummaryState): number {
  const totalHours = Number(summary.total_hours || 0);
  if (Number.isFinite(totalHours) && totalHours > 0) return totalHours;

  const totalActiveMs = Number(summary.total_active_ms || 0);
  return Number.isFinite(totalActiveMs) && totalActiveMs > 0
    ? totalActiveMs / (1000 * 60 * 60)
    : 0;
}

export function isProjectTimeRollupSnapshot(snapshot?: ComputerSnapshot | null): boolean {
  const source = String(snapshot?.source || snapshot?.summary?.source || '').trim().toLowerCase();
  return source === 'project_time_rollups';
}

export function calculateTrackedSpanDays(dateKeys: string[]): number {
  const validDates = dateKeys
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .sort();

  if (validDates.length === 0) return 0;
  if (validDates.length === 1) return 1;

  const first = new Date(`${validDates[0]}T00:00:00`);
  const last = new Date(`${validDates[validDates.length - 1]}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return validDates.length;
  return Math.max(1, Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1);
}

export function formatMetricDisplay(value: number, unitType: string): string {
  if (isPercentLikeUnit(unitType)) return `${formatMetricAmount(value, unitType)}%`;
  return `${formatMetricAmount(value, unitType)} ${unitType}`;
}
