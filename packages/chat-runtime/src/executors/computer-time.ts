/**
 * Computer time spent breakdown executor.
 *
 * Extracted from orchestrator.ts (lines 4403-4576) during Phase 1 refactoring.
 */

import {
  fetchPythonApi,
  clampDaysBack,
  clampSearchLimit,
  formatTzTimestamp,
  getTimezoneYmd,
  shiftYmd,
} from './shared-api.js';

export async function executeGetComputerTimeSpentBreakdown(
  token: string,
  params: { query: string; daysBack?: number; limit?: number; groupBy?: 'app' | 'window' | 'domain' },
  timezone?: string,
): Promise<string> {
  console.log('🖥️ getComputerTimeSpentBreakdown called:', params);
  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit ?? 8);
  const endDate = getTimezoneYmd(new Date(), timezone);
  const startDate = shiftYmd(endDate, -Math.max(0, safeDaysBack - 1));

  try {
    const [rollupsResponse, sessionsResponse] = await Promise.all([
      fetchPythonApi('/api/watcher/project-time/rollups', token, {
        start_date: startDate,
        end_date: endDate,
        group_by: 'task',
        limit: safeLimit,
      }),
      fetchPythonApi('/api/watcher/project-time/sessions', token, {
        start_date: startDate,
        end_date: endDate,
        limit: Math.min(20, safeLimit * 3),
      }),
    ]) as [any, any];

    if (!rollupsResponse?.success) {
      return JSON.stringify({
        success: false,
        error: rollupsResponse?.error || 'Project time breakdown is unavailable.',
      });
    }

    const rollups = Array.isArray(rollupsResponse.data) ? rollupsResponse.data : [];
    const sessions = Array.isArray(sessionsResponse?.data) ? sessionsResponse.data : [];
    const totalActiveMs = rollups.reduce((sum: number, row: any) => sum + Number(row.active_ms || 0), 0);
    const totalActiveHours = Number((totalActiveMs / 3_600_000).toFixed(2));
    const totalActiveMinutes = Math.round(totalActiveMs / 60_000);
    const daysWithActivity = new Set(rollups.map((row: any) => row.date).filter(Boolean)).size || undefined;

    const topCategories = rollups.slice(0, safeLimit).map((row: any, index: number) => {
      const label = [row.project_name, row.task_name].filter(Boolean).join(' / ') || row.project_name || 'Unclassified';
      const activeMs = Number(row.active_ms || 0);
      return {
      rank: index + 1,
      category: label,
      project: row.project_name || 'Unclassified',
      task: row.task_name || 'General',
      estimated_minutes: Math.round(activeMs / 60_000),
      estimated_hours: Number((activeMs / 3_600_000).toFixed(2)),
      share_percent: totalActiveMs > 0 ? Number(((activeMs / totalActiveMs) * 100).toFixed(1)) : 0,
      hit_count: Number(row.session_count || 0),
      confidence: Number(row.confidence_avg || 0),
      sample_app: undefined,
      sample_window: null,
      };
    });

    const dailyTotals = new Map<string, { date: string; active_ms: number; session_count: number }>();
    for (const row of rollups) {
      const date = String(row.date || '');
      if (!date) continue;
      const current = dailyTotals.get(date) || { date, active_ms: 0, session_count: 0 };
      current.active_ms += Number(row.active_ms || 0);
      current.session_count += Number(row.session_count || 0);
      dailyTotals.set(date, current);
    }
    const dailyBreakdown = Array.from(dailyTotals.values()).map((row) => ({
      date: row.date,
      estimated_minutes: Math.round(row.active_ms / 60_000),
      estimated_hours: Number((row.active_ms / 3_600_000).toFixed(2)),
      hit_count: row.session_count,
    }));

    const sampleMoments = sessions.slice(0, 8).map((session: any) => ({
      timestamp: session.start_ts ? formatTzTimestamp(Number(session.start_ts), timezone) : 'Unknown',
      project: session.project_name || 'Unclassified',
      task: session.task_name || 'General',
      duration_minutes: Math.round(Number(session.active_ms || 0) / 60_000),
      confidence: `${Math.round(Math.max(0, Math.min(1, Number(session.confidence || 0))) * 100)}%`,
      summary: String(session.summary_text || `${session.project_name || 'Unclassified'} / ${session.task_name || 'General'}`).slice(0, 180),
    }));

    return JSON.stringify({
      success: true,
      query: params.query,
      group_by: 'task',
      days_searched: safeDaysBack,
      result_count: rollups.length,
      status: 'project-time',
      mode_used: 'project_time_rollups',
      warning: rollups.length === 0 ? 'No project-time attribution rows were available for the selected range.' : undefined,
      freshness: { status: rollups.length > 0 ? 'healthy' : 'empty', source: rollupsResponse.source },
      confidence: {
        status: rollups.length > 0 ? 'grounded' : 'empty',
        source: 'project_time_daily_rollups',
      },
      provider_path: { source: 'project_time_api' },
      summary: {
        estimated_total_minutes: totalActiveMinutes,
        estimated_total_hours: totalActiveHours,
        total_hits: sessions.length,
        unique_apps: topCategories.length,
        days_with_activity: daysWithActivity || 0,
        range_start: startDate,
        range_end: endDate,
        metric_source: 'watcher_aggregate',
        metric_label: 'Attributed project time',
      },
      top_categories: topCategories,
      daily_breakdown: dailyBreakdown,
      sample_moments: sampleMoments,
      estimation: {
        method: 'Project-time daily rollups and compact session summaries generated from local activity attribution',
        default_chunk_seconds: null,
        max_gap_minutes: 5,
        note: 'Totals come from activity_events-derived project_time rows and compact session summaries.',
      },
      debug: {
        source: 'project_time_api',
        rollup_source: rollupsResponse.source,
        sessions_source: sessionsResponse?.source,
      },
    });
  } catch (error) {
    console.error('❌ getComputerTimeSpentBreakdown project-time error:', error);
    return JSON.stringify({
      success: false,
      error: 'Computer time breakdown is currently unavailable.',
      details: String(error),
    });
  }
}
