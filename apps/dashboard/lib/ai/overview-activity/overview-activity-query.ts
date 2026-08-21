import { getComputerTimeDaily, getTopApps, getTopDomains } from '@/lib/computerActivity';
import { getStrictThisWeekRange } from '@/lib/ai/overview-activity/weekly-overview-utils.mjs';
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
  source: 'local' | 'synced' | 'unavailable';
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
): bundle is LocalOverviewActivityBundle {
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

function resolveOverviewReadSource(
  rows: Array<{ source?: string }>,
): LocalOverviewActivityBundle['source'] {
  const sources = rows.map((row) => row?.source);
  if (sources.includes('local')) return 'local';
  if (sources.includes('unavailable')) return 'unavailable';
  return 'synced';
}

export async function buildLocalOverviewActivityBundle(
  startDate: string,
  endDate: string,
): Promise<LocalOverviewActivityBundle> {
  const [apps, domains, daily] = await Promise.all([
    getTopApps({ startDate, endDate }, 25),
    getTopDomains({ startDate, endDate }, 25),
    getComputerTimeDaily({ startDate, endDate }),
  ]);

  return {
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
    source: resolveOverviewReadSource([...daily, ...apps, ...domains]),
  };
}

export async function getOverviewActivityBundle(
  rangeKey: OverviewActivityRangeKey,
  timezone: string,
): Promise<LocalOverviewActivityBundle | null> {
  if (!isDesktopRuntime()) return null;
  const { startDate, endDate } = getOverviewActivityRangeWindow(rangeKey, timezone);
  return buildLocalOverviewActivityBundle(startDate, endDate);
}
