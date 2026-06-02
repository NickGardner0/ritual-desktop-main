import {
  clampDaysBack,
  getTimezoneYmd,
  shiftYmd,
} from './shared-api.js';

export async function executeGetActivitySummary(
  token: string,
  params: { query?: string; daysBack?: number },
  _timezone?: string,
  inferRecapAnchorDateFn?: (query: string, daysBack: number, timezone?: string) => string | null,
  buildCalendarStyleActivitySummaryFn?: (token: string, anchorDate: string, timezone?: string) => Promise<any>,
) {
  const safeDaysBack = clampDaysBack(params.daysBack ?? 1);
  const query = params.query || 'activity summary';
  const timezone = _timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  const anchorDate = inferRecapAnchorDateFn
    ? inferRecapAnchorDateFn(query, safeDaysBack, timezone)
    : null;
  const endDate = anchorDate || getTimezoneYmd(new Date(), timezone);
  const startDate = anchorDate || shiftYmd(endDate, -(Math.max(safeDaysBack, 1) - 1));

  if (!buildCalendarStyleActivitySummaryFn) {
    return JSON.stringify({
      success: false,
      error: 'Project-time activity summary is unavailable.',
    });
  }

  try {
    const summary = await buildCalendarStyleActivitySummaryFn(token, endDate, timezone);
    if (!summary || !String(summary).trim()) {
      return JSON.stringify({
        success: true,
        query,
        anchor_date: anchorDate,
        intent_resolved: anchorDate ? 'anchored_day_project_time_recap' : 'project_time_recap',
        days_back: safeDaysBack,
        start_date: startDate,
        end_date: endDate,
        retrieval_tier: 'project_time_bundle',
        citations: [],
        citations_count: 0,
        confidence: { level: 'low', source: 'project_time' },
        freshness: { status: 'empty', source: 'project_time' },
        rich_activity_summary: 'I do not have enough attributed project-time data for that period yet.',
        calendar_style_summary: null,
        calendar_style_date: endDate,
        workstreams: [],
        degraded: false,
        degradation_notes: [],
        source: 'project_time_bundle_empty',
      });
    }

    return JSON.stringify({
      success: true,
      query,
      anchor_date: anchorDate,
      intent_resolved: anchorDate ? 'anchored_day_project_time_recap' : 'project_time_recap',
      days_back: safeDaysBack,
      start_date: startDate,
      end_date: endDate,
      retrieval_tier: 'project_time_bundle',
      citations: [],
      citations_count: 0,
      confidence: { level: 'medium', source: 'project_time' },
      freshness: { status: 'healthy', source: 'project_time' },
      rich_activity_summary: summary,
      calendar_style_summary: summary,
      calendar_style_date: endDate,
      workstreams: [],
      health: {
        overall_status: 'healthy',
        primary_source_selected: 'project_time',
      },
      degraded: false,
      degradation_notes: [],
      source: 'project_time_bundle',
    });
  } catch (error) {
    console.error('getActivitySummary project-time error:', error);
    return JSON.stringify({
      success: false,
      error: 'Project-time activity summary is currently unavailable.',
      details: String(error),
    });
  }
}
