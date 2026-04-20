/**
 * Overview tool executors (weekly, daily, monthly).
 *
 * Extracted from orchestrator.ts (lines 2694-2910) during Phase 1 refactoring.
 */

import { fetchPythonApi, getTimezoneYmd, shiftYmd } from './shared-api.js';
import type { LocalOverviewActivityBundle } from '../types.js';
import { buildWeeklyOverviewCanvasPayload, getStrictThisWeekRange } from '../weekly-overview-utils.js';

const MAX_WEEKLY_OVERVIEW_HABIT_DETAILS = 6;
const WEEKLY_OVERVIEW_STATS_TIMEOUT_MS = 12000;
const WEEKLY_OVERVIEW_WATCHER_TIMEOUT_MS = 4000;
const WEEKLY_OVERVIEW_BREAKDOWN_TIMEOUT_MS = 12000;

// ---------------------------------------------------------------------------
// Local activity bundle selector
// ---------------------------------------------------------------------------

function selectLocalOverviewActivityBundle(
  bundles: unknown,
  startDate: string,
  endDate: string,
): LocalOverviewActivityBundle | null {
  if (!Array.isArray(bundles)) return null;
  const match = bundles.find((bundle) => {
    const candidate = bundle as LocalOverviewActivityBundle;
    return candidate?.startDate === startDate && candidate?.endDate === endDate;
  });
  return (match as LocalOverviewActivityBundle) || null;
}

function selectWeeklyOverviewDetailHabits<T extends {
  name?: string;
  total?: number;
  average?: number;
  days_with_data?: number;
  total_entries?: number;
}>(habits: T[]): T[] {
  return [...habits]
    .sort((a, b) => {
      const dayDelta = Number(b.days_with_data || 0) - Number(a.days_with_data || 0);
      if (dayDelta !== 0) return dayDelta;

      const entryDelta = Number(b.total_entries || 0) - Number(a.total_entries || 0);
      if (entryDelta !== 0) return entryDelta;

      const magnitudeDelta = Math.abs(Number(b.total || b.average || 0)) - Math.abs(Number(a.total || a.average || 0));
      if (magnitudeDelta !== 0) return magnitudeDelta;

      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, MAX_WEEKLY_OVERVIEW_HABIT_DETAILS);
}

// ---------------------------------------------------------------------------
// executeGetWeeklyOverview
// ---------------------------------------------------------------------------

export async function executeGetWeeklyOverview(token: string, params: {
  startDate?: string;
  endDate?: string;
  daysBack?: number;
  appLimit?: number;
}, timezone?: string, strictThisWeek?: boolean, localOverviewActivity?: unknown) {
  console.log('📊 getWeeklyOverview called:', params, 'timezone:', timezone);

  const safeDaysBack = Number.isFinite(params.daysBack)
    ? Math.min(Math.max(Math.round(params.daysBack as number), 1), 365)
    : 7;
  const safeAppLimit = Number.isFinite(params.appLimit)
    ? Math.min(Math.max(Math.round(params.appLimit as number), 3), 25)
    : 10;

  try {
    const shouldUseStrictThisWeek =
      Boolean(strictThisWeek) &&
      !params.startDate &&
      !params.endDate;

    const strictWeekRange = shouldUseStrictThisWeek
      ? getStrictThisWeekRange(timezone || 'UTC', new Date())
      : null;

    // Compute dates upfront so watcher calls can start immediately
    // without waiting for the stats API to return.
    const earlyStartDate = strictWeekRange?.startDate || params.startDate
      || shiftYmd(getTimezoneYmd(new Date(), timezone || 'UTC'), -(safeDaysBack - 1));
    const earlyEndDate = strictWeekRange?.endDate || params.endDate
      || getTimezoneYmd(new Date(), timezone || 'UTC');

    // Start watcher calls immediately — they only need dates, not habit IDs
    const localActivityBundle = selectLocalOverviewActivityBundle(localOverviewActivity, earlyStartDate, earlyEndDate);

    const watcherPromise = (async () => {
      if (localActivityBundle) {
        return {
          watcherDailyRows: Array.isArray(localActivityBundle.daily)
            ? localActivityBundle.daily.map((row) => ({
                day: row.day,
                active_hours: Number(row.active_hours || 0),
                events_count: Number(row.events_count || 0),
                apps_count: Number(row.apps_count || 0),
                source: localActivityBundle.source || 'cloud_first',
              }))
            : [],
          topApps: Array.isArray(localActivityBundle.apps)
            ? localActivityBundle.apps.slice(0, safeAppLimit).map((row) => ({
                app_bundle_id: row.app_bundle_id,
                app_name: row.app_name,
                hours: Number(row.hours || 0),
                total_events: Number(row.total_events || 0),
                source: localActivityBundle.source || 'cloud_first',
              }))
            : [],
          topDomains: Array.isArray(localActivityBundle.domains)
            ? localActivityBundle.domains.slice(0, safeAppLimit).map((row) => ({
                domain: row.domain,
                hours: Number(row.hours || 0),
                total_events: Number(row.total_events || 0),
                source: localActivityBundle.source || 'cloud_first',
              }))
            : [],
        };
      }

      const watcherRequests = await Promise.allSettled([
        fetchPythonApi('/api/watcher/stats/daily', token, {
          start_date: earlyStartDate,
          end_date: earlyEndDate,
        }, { timeoutMs: WEEKLY_OVERVIEW_WATCHER_TIMEOUT_MS }),
        fetchPythonApi('/api/watcher/stats/top-apps', token, {
          start_date: earlyStartDate,
          end_date: earlyEndDate,
          limit: safeAppLimit,
        }, { timeoutMs: WEEKLY_OVERVIEW_WATCHER_TIMEOUT_MS }),
        fetchPythonApi('/api/watcher/stats/top-domains', token, {
          start_date: earlyStartDate,
          end_date: earlyEndDate,
          limit: safeAppLimit,
        }, { timeoutMs: WEEKLY_OVERVIEW_WATCHER_TIMEOUT_MS }),
      ]);

      const dailyWatcherResult = watcherRequests[0].status === 'fulfilled' ? watcherRequests[0].value : null;
      const topAppsResult = watcherRequests[1].status === 'fulfilled' ? watcherRequests[1].value : null;
      const topDomainsResult = watcherRequests[2].status === 'fulfilled' ? watcherRequests[2].value : null;

      return {
        watcherDailyRows: Array.isArray(dailyWatcherResult?.data) ? dailyWatcherResult.data : [],
        topApps: Array.isArray(topAppsResult?.data) ? topAppsResult.data : [],
        topDomains: Array.isArray(topDomainsResult?.data) ? topDomainsResult.data : [],
      };
    })();

    // Stats + watcher run in parallel now (previously watcher waited for stats)
    const statsPromise = fetchPythonApi('/api/analytics/stats', token, {
      start_date: strictWeekRange?.startDate || params.startDate || '',
      end_date: strictWeekRange?.endDate || params.endDate || '',
      days_back: safeDaysBack,
    }, { timeoutMs: WEEKLY_OVERVIEW_STATS_TIMEOUT_MS });

    const [statsResult, watcherData] = await Promise.all([
      statsPromise,
      watcherPromise,
    ]);

    if (!statsResult.success) {
      return JSON.stringify({
        success: false,
        error: statsResult.error || 'Unable to fetch weekly habit stats.',
        available_habits: statsResult.available_habits,
      });
    }

    const dateRange = statsResult.date_range || {};
    const startDate = dateRange.start || earlyStartDate;
    const endDate = dateRange.end || earlyEndDate;

    const allHabits: Array<{
      id: string;
      name: string;
      category?: string;
      unit?: string;
      total: number;
      average: number;
      min: number;
      max: number;
      days_with_data: number;
      total_entries: number;
    }> = Array.isArray(statsResult.habits) ? statsResult.habits : [];

    // Focus recap on habits with tracked data in this period.
    const habitsWithData = allHabits.filter((habit) => (habit.days_with_data || 0) > 0);
    const detailedHabits = selectWeeklyOverviewDetailHabits(habitsWithData);

    // Breakdowns need habit IDs from stats, so they start after stats completes
    const breakdownResults = await Promise.allSettled(
      detailedHabits.map(async (habit) => {
        const breakdown = await fetchPythonApi('/api/analytics/daily-breakdown', token, {
          habit_id: habit.id,
          start_date: startDate,
          end_date: endDate,
          days_back: safeDaysBack,
          timezone: timezone || '',
        }, { timeoutMs: WEEKLY_OVERVIEW_BREAKDOWN_TIMEOUT_MS });
        return { habitId: habit.id, breakdown };
      }),
    );

    const dailyByHabitId = new Map<string, unknown[]>();
    for (const item of breakdownResults) {
      if (item.status !== 'fulfilled') continue;
      const payload = item.value.breakdown;
      if (payload?.success && Array.isArray(payload.data)) {
        dailyByHabitId.set(item.value.habitId, payload.data);
      }
    }

    const watcherDailyRows = watcherData.watcherDailyRows;
    const topApps = watcherData.topApps;
    const topDomains = watcherData.topDomains;
    const computedDays = Number(dateRange.days || 0) > 0
      ? Number(dateRange.days)
      : (
        strictWeekRange
          ? Math.max(
            1,
            Math.floor(
              (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000),
            ) + 1,
          )
          : safeDaysBack
      );

    const payload = buildWeeklyOverviewCanvasPayload({
      startDate,
      endDate,
      days: computedDays,
      allHabits,
      overviewHabits: detailedHabits,
      dailyByHabitId,
      watcherDailyRows,
      topApps,
      topDomains,
    });

    // Add formatting instruction so the LLM writes a concise narrative
    // instead of dumping all the raw data
    (payload as any).__response_instructions = `IMPORTANT: The side panel already shows the raw tables and numbers. Your text response should be a comprehensive, detailed recap — not a stat dump and not a brief summary. Write a structured narrative with sections (Rhythm, Standout Days, Computer Use, What Shifted) using bold headings. Each section should be 3-4 sentences with specific dates, numbers, app names, and habit names. Include a 2-3 sentence opening and a 2-3 sentence closing that synthesizes the period. Target 350-450 words. Be specific and direct — avoid generic statements like "strong habits" or "productive week". Every claim must reference actual data.`;

    return JSON.stringify(payload);
  } catch (error) {
    console.error('❌ getWeeklyOverview error:', error);
    return JSON.stringify({ success: false, error: String(error) });
  }
}

// ---------------------------------------------------------------------------
// executeGetDailyOverview
// ---------------------------------------------------------------------------

export async function executeGetDailyOverview(
  token: string,
  params: { appLimit?: number },
  timezone?: string,
  localOverviewActivity?: unknown,
) {
  const todayYmd = getTimezoneYmd(new Date(), timezone || 'UTC');
  return executeGetWeeklyOverview(
    token,
    {
      startDate: todayYmd,
      endDate: todayYmd,
      daysBack: 1,
      appLimit: params.appLimit,
    },
    timezone,
    false,
    localOverviewActivity,
  );
}

// ---------------------------------------------------------------------------
// executeGetMonthlyOverview
// ---------------------------------------------------------------------------

export async function executeGetMonthlyOverview(
  token: string,
  params: { appLimit?: number },
  timezone?: string,
  localOverviewActivity?: unknown,
) {
  const endDate = getTimezoneYmd(new Date(), timezone || 'UTC');
  const startDate = shiftYmd(endDate, -29);
  return executeGetWeeklyOverview(
    token,
    {
      startDate,
      endDate,
      daysBack: 30,
      appLimit: params.appLimit,
    },
    timezone,
    false,
    localOverviewActivity,
  );
}
