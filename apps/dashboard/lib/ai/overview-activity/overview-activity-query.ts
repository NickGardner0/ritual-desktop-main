import { getComputerTimeDaily, getTopApps, getTopDomains } from '@/lib/computerActivity';
import {
  invokeDailySummariesWithInitRetry,
  invokeDetailedActivityWithInitRetry,
} from '@/lib/computerActivity/tauri-activity';
import { normalizeComputerDailySummaryRow } from '@/lib/computerActivity/normalize';
import { getStrictThisWeekRange } from '@ritual/chat-runtime/weekly-overview-utils';
import { isDesktopRuntime } from '@/lib/desktop-capabilities';

export type LocalOverviewActivityBundle = {
  startDate: string;
  endDate: string;
  daily: Array<{
    day: string;
    active_hours: number;
    events_count: number;
    apps_count: number;
  }>;
  apps: Array<{
    app_bundle_id: string;
    app_name: string;
    hours: number;
    total_events: number;
  }>;
  domains: Array<{
    domain: string;
    hours: number;
    total_events: number;
  }>;
  source: 'cloud_first' | 'tauri_fallback';
};

export type OverviewActivityRangeKey =
  | 'today'
  | 'rolling-week'
  | 'this-week'
  | 'last-week'
  | 'month';

export const overviewActivityKeys = {
  all: ['overview-activity'] as const,
  detail: (userId: string, timezone: string, rangeKey: OverviewActivityRangeKey) =>
    [...overviewActivityKeys.all, userId, timezone, rangeKey] as const,
};

export function hasMeaningfulOverviewActivity(
  bundle: LocalOverviewActivityBundle | null | undefined,
): boolean {
  if (!bundle) return false;

  const hasDailyActivity = Array.isArray(bundle.daily) && bundle.daily.some((row) =>
    Number(row.active_hours || 0) > 0
    || Number(row.events_count || 0) > 0
    || Number(row.apps_count || 0) > 0,
  );
  const hasAppDetail = Array.isArray(bundle.apps) && bundle.apps.some((row) =>
    Number(row.hours || 0) > 0 || Number(row.total_events || 0) > 0,
  );
  const hasDomainDetail = Array.isArray(bundle.domains) && bundle.domains.some((row) =>
    Number(row.hours || 0) > 0 || Number(row.total_events || 0) > 0,
  );

  return hasDailyActivity || hasAppDetail || hasDomainDetail;
}

export function hasCompleteOverviewActivityDetail(
  bundle: LocalOverviewActivityBundle | null | undefined,
): boolean {
  if (!bundle) return false;

  const hasDailyActivity = Array.isArray(bundle.daily) && bundle.daily.some((row) =>
    Number(row.active_hours || 0) > 0
    || Number(row.events_count || 0) > 0
    || Number(row.apps_count || 0) > 0,
  );
  const hasAppDetail = Array.isArray(bundle.apps) && bundle.apps.some((row) =>
    Number(row.hours || 0) > 0 || Number(row.total_events || 0) > 0,
  );
  const hasDomainDetail = Array.isArray(bundle.domains) && bundle.domains.some((row) =>
    Number(row.hours || 0) > 0 || Number(row.total_events || 0) > 0,
  );

  if (!hasDailyActivity) {
    return true;
  }

  return hasAppDetail || hasDomainDetail;
}

function getTimezoneYmd(date: Date, timezone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function isOverviewActivityQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;
  const patterns = [
    'how was my week',
    'how has my week been',
    'how was last week',
    'how has last week been',
    'how was my month',
    'how was my day',
    'weekly overview',
    'weekly summary',
    'weekly recap',
    'daily overview',
    'daily summary',
    'daily recap',
    'monthly overview',
    'monthly summary',
    'monthly recap',
    'this week',
    'last week',
    'this month',
    'last month',
    'today',
  ];
  return patterns.some((pattern) => normalized.includes(pattern));
}

export function getOverviewActivityRangeKeysForText(text: string): OverviewActivityRangeKey[] {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return [];

  if (/month|last month|this month|monthly/.test(normalized)) {
    return ['month'];
  }

  if (/today|daily|yesterday/.test(normalized)) {
    return ['today'];
  }

  if (/week|weekly/.test(normalized)) {
    return ['rolling-week', 'this-week', 'last-week'];
  }

  return isOverviewActivityQuery(normalized)
    ? ['today', 'rolling-week', 'this-week', 'last-week', 'month']
    : [];
}

export function getOverviewActivityRangeWindow(
  rangeKey: OverviewActivityRangeKey,
  timezone: string,
): { startDate: string; endDate: string } {
  const todayYmd = getTimezoneYmd(new Date(), timezone || 'UTC');
  const thisWeek = getStrictThisWeekRange(timezone || 'UTC', new Date());

  switch (rangeKey) {
    case 'today':
      return {
        startDate: todayYmd,
        endDate: todayYmd,
      };
    case 'rolling-week':
      return {
        startDate: shiftYmd(todayYmd, -7),
        endDate: todayYmd,
      };
    case 'this-week':
      return thisWeek;
    case 'last-week':
      return {
        startDate: shiftYmd(thisWeek.startDate, -7),
        endDate: shiftYmd(thisWeek.startDate, -1),
      };
    case 'month':
      return {
        startDate: shiftYmd(todayYmd, -29),
        endDate: todayYmd,
      };
    default:
      return {
        startDate: todayYmd,
        endDate: todayYmd,
      };
  }
}

function normalizeDailyRows(rows: unknown[]): Array<{
  day: string;
  active_hours: number;
  active_ms: number;
  events_count: number;
  apps_count?: number;
  domain_count?: number;
}> {
  return rows
    .map(normalizeComputerDailySummaryRow)
    .filter((row): row is NonNullable<ReturnType<typeof normalizeComputerDailySummaryRow>> => Boolean(row))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row) => ({
      day: row.day,
      active_hours: row.active_hours,
      active_ms: row.active_ms,
      events_count: row.events_count,
      apps_count: row.apps_count ?? 0,
      domain_count: row.domain_count ?? 0,
    }));
}

function getDesktopRangeTimestamps(startDate: string, endDate: string): { startTs: number; endTs: number } {
  return {
    startTs: new Date(`${startDate}T00:00:00`).getTime(),
    endTs: new Date(`${endDate}T23:59:59.999`).getTime(),
  };
}

async function buildDesktopFallbackOverviewActivityBundle(
  startDate: string,
  endDate: string,
): Promise<LocalOverviewActivityBundle> {
  const { startTs, endTs } = getDesktopRangeTimestamps(startDate, endDate);
  const [dailySummaries, detailed] = await Promise.all([
    invokeDailySummariesWithInitRetry(startDate, endDate),
    invokeDetailedActivityWithInitRetry({ startTs, endTs, limit: 25 }),
  ]);

  return {
    startDate,
    endDate,
    daily: normalizeDailyRows(dailySummaries).map((row) => ({
      day: row.day,
      active_hours: Number(row.active_hours || 0),
      events_count: Number(row.events_count || 0),
      apps_count: Number(row.apps_count || 0),
      source: 'tauri_fallback',
    })),
    apps: (Array.isArray(detailed.apps) ? detailed.apps : [])
      .filter((row) => Math.max(0, Number(row.total_duration_ms || 0)) > 0)
      .slice(0, 25)
      .map((row) => ({
        app_bundle_id: row.app_bundle_id,
        app_name: row.app_name || row.app_bundle_id || 'Unknown',
        hours: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60 * 60)),
        total_events: Math.max(0, Number(row.event_count || 0)),
      })),
    domains: (Array.isArray(detailed.domains) ? detailed.domains : [])
      .filter((row) => Math.max(0, Number(row.total_duration_ms || 0)) > 0)
      .slice(0, 25)
      .map((row) => ({
        domain: row.domain || 'Unknown',
        hours: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60 * 60)),
        total_events: Math.max(0, Number(row.event_count || 0)),
      })),
    source: 'tauri_fallback',
  };
}

export async function buildLocalOverviewActivityBundle(
  startDate: string,
  endDate: string,
): Promise<LocalOverviewActivityBundle> {
  let backendBundle: LocalOverviewActivityBundle | null = null;

  try {
    const [detailed, daily] = await Promise.all([
      Promise.all([
        getTopApps({ startDate, endDate }, 25),
        getTopDomains({ startDate, endDate }, 25),
      ]),
      getComputerTimeDaily({ startDate, endDate }),
    ]);
    const [apps, domains] = detailed;
    const source: LocalOverviewActivityBundle['source'] =
      [...daily, ...apps, ...domains].some((row) => row?.source === 'tauri_fallback')
        ? 'tauri_fallback'
        : 'cloud_first';

    backendBundle = {
      startDate,
      endDate,
      daily: daily.map((row) => ({
        day: row.day,
        active_hours: Number(row.active_hours || 0),
        events_count: Number(row.events_count || 0),
        apps_count: Number(row.apps_count || 0),
      })),
      apps: apps.map((row) => ({
        app_bundle_id: row.app_bundle_id,
        app_name: row.app_name,
        hours: Number(row.hours || 0),
        total_events: Number(row.total_events || 0),
      })),
      domains: domains.map((row) => ({
        domain: row.domain,
        hours: Number(row.hours || 0),
        total_events: Number(row.total_events || 0),
      })),
      source,
    };

    if (!isDesktopRuntime() || hasMeaningfulOverviewActivity(backendBundle)) {
      return backendBundle;
    }
  } catch (error) {
    if (!isDesktopRuntime()) throw error;
  }

  try {
    return await buildDesktopFallbackOverviewActivityBundle(startDate, endDate);
  } catch (fallbackError) {
    if (backendBundle) {
      return backendBundle;
    }
    throw fallbackError;
  }
}

export async function getOverviewActivityBundle(
  rangeKey: OverviewActivityRangeKey,
  timezone: string,
): Promise<LocalOverviewActivityBundle | null> {
  if (!isDesktopRuntime()) return null;
  const { startDate, endDate } = getOverviewActivityRangeWindow(rangeKey, timezone);
  return buildLocalOverviewActivityBundle(startDate, endDate);
}
