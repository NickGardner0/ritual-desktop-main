/**
 * Computer time spent breakdown executor.
 *
 * Extracted from orchestrator.ts (lines 4403-4576) during Phase 1 refactoring.
 */

import type { ScreenSearchContext, MemoryQueryApiResponse } from '../types.js';
import {
  fetchPythonApiPost,
  clampDaysBack,
  clampSearchLimit,
  compactScreenWarning,
  formatTzDay,
  formatTzTimestamp,
} from './shared-api.js';
import {
  mapRetrievalTierToMode,
  mapRetrievalTierToStatus,
  buildScreenSearchDebug,
} from './screen-search-helpers.js';

export async function executeGetComputerTimeSpentBreakdown(
  token: string,
  params: { query: string; daysBack?: number; limit?: number; groupBy?: 'app' | 'window' | 'domain' },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  timezone?: string,
): Promise<string> {
  console.log('🖥️ getComputerTimeSpentBreakdown called:', params);
  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit ?? 8);
  const groupBy = params.groupBy === 'window' || params.groupBy === 'domain' ? params.groupBy : 'app';

  try {
    const response = await fetchPythonApiPost('/api/memory/query', token, {
      query: params.query,
      intent: 'time_spent',
      days_back: safeDaysBack,
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      group_by: groupBy,
      limit: safeLimit,
    }) as MemoryQueryApiResponse;

    if (!response?.success) {
      return JSON.stringify({
        success: false,
        error: response?.error || 'Computer time breakdown is unavailable.',
      });
    }

    const timeTruth = response.time_truth || {};
    const topBuckets = Array.isArray(timeTruth.top_buckets) ? timeTruth.top_buckets : [];
    const dailyRows = Array.isArray(timeTruth.daily_breakdown) ? timeTruth.daily_breakdown : [];
    const citations = Array.isArray(response.citations) ? response.citations : [];

    const totalActiveHours = Number(timeTruth.total_active_hours || 0);
    const totalActiveMinutes = Math.round(Number(timeTruth.total_active_ms || 0) / (60 * 1000));
    const totalHits = Number(timeTruth.total_events || 0);
    const daysWithActivity = Number(timeTruth.days_with_activity || 0);
    const uniqueBuckets = Number(timeTruth.unique_buckets || 0);

    const topCategories = topBuckets.slice(0, safeLimit).map((row, index) => ({
      rank: index + 1,
      category: row.bucket || 'Unknown',
      estimated_minutes: Math.round(Number(row.total_active_ms || 0) / (60 * 1000)),
      estimated_hours: Number(row.total_active_hours || 0),
      share_percent: Number(row.share_percent || 0),
      hit_count: Number(row.hits || 0),
      last_seen: row.last_seen_ts ? formatTzTimestamp(Number(row.last_seen_ts), timezone) : 'In selected range',
      sample_app: groupBy === 'domain' ? undefined : (row.bucket || 'Unknown'),
      sample_window: null,
    }));

    const dailyBreakdown = dailyRows.map((row) => ({
      date: row.date,
      estimated_minutes: Math.round(Number(row.total_active_ms || 0) / (60 * 1000)),
      estimated_hours: Number(row.total_active_hours || 0),
      hit_count: Number(row.hits || 0),
    }));

    const sampleMoments = citations.slice(0, 5).map((citation) => ({
      timestamp: citation.timestamp ? formatTzTimestamp(Number(citation.timestamp), timezone) : 'Unknown',
      app: citation.app_name || 'Unknown',
      window: citation.window_title || 'Unknown',
      relevance: `${Math.round(Math.max(0, Math.min(1, Number(citation.score || 0))) * 100)}%`,
      preview: (citation.snippet || '').slice(0, 180),
    }));

    const retrievalTier = response.retrieval_tier as ScreenSearchContext['retrievalTier'] | undefined;
    const retrievalTierMode = mapRetrievalTierToMode(retrievalTier);
    const retrievalTierStatus = mapRetrievalTierToStatus(retrievalTier);
    const freshnessStatus = response.freshness?.status || 'healthy';
    const modeUsed = retrievalTierMode || response.semantic_truth?.mode_used || response.answer_mode || 'activity_only';
    const status: ScreenSearchContext['status'] = retrievalTierStatus || (
      freshnessStatus === 'healthy'
        ? 'hybrid'
        : freshnessStatus === 'degraded_semantic'
          ? 'text-fallback'
          : freshnessStatus === 'degraded_ocr'
            ? 'text-fallback'
            : freshnessStatus === 'stale' || freshnessStatus === 'unavailable'
              ? 'unavailable'
              : 'text-only'
    );

    const warningRaw = response.warning
      || response.semantic_truth?.warning
      || (prefetchedScreenSearchContext?.warning ? String(prefetchedScreenSearchContext.warning) : undefined);
    const warning = retrievalTier === 'activity_only'
      ? (() => {
        const cleaned = String(warningRaw || '')
          .split(/\.\s+/)
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0)
          .filter((segment) => !/semantic|embeddings?\s+finish|vector|matched moments/i.test(segment))
          .filter((segment) => !/ocr evidence is stale|time totals still come from activity events/i.test(segment))
          .join('. ')
          .trim();
        return cleaned ? `${cleaned}${cleaned.endsWith('.') ? '' : '.'}` : undefined;
      })()
      : compactScreenWarning(warningRaw);
    const resultCount = retrievalTier === 'activity_only'
      ? totalHits
      : citations.length;

    return JSON.stringify({
      success: true,
      query: params.query,
      group_by: groupBy,
      days_searched: response.days_back || safeDaysBack,
      result_count: resultCount,
      status,
      mode_used: modeUsed,
      retrieval_tier: retrievalTier,
      warning,
      freshness: response.freshness,
      confidence: response.confidence,
      provider_path: response.provider_path,
      summary: {
        estimated_total_minutes: totalActiveMinutes,
        estimated_total_hours: totalActiveHours,
        total_hits: totalHits,
        unique_apps: uniqueBuckets,
        days_with_activity: daysWithActivity,
        range_start: timeTruth.range_start || response.start_date,
        range_end: timeTruth.range_end || response.end_date,
        metric_source: 'watcher_aggregate',
        metric_label: 'Total active time',
        matched_total_minutes: retrievalTier === 'activity_only' ? undefined : Math.round(sampleMoments.length > 0 ? sampleMoments.length * 1.5 : 0),
        matched_total_hours: retrievalTier === 'activity_only' ? undefined : Number((sampleMoments.length * 1.5 / 60).toFixed(2)),
        matched_hits: retrievalTier === 'activity_only' ? undefined : citations.length,
        matched_days_with_activity: retrievalTier === 'activity_only'
          ? undefined
          : new Set(
            citations
              .map((item) => Number(item.timestamp || 0))
              .filter((ts) => Number.isFinite(ts) && ts > 0)
              .map((ts) => formatTzDay(ts, timezone)),
          ).size,
      },
      top_categories: topCategories,
      daily_breakdown: dailyBreakdown,
      sample_moments: sampleMoments,
      estimation: {
        method: 'Activity-events rollup for totals + context-memory citations for evidence',
        default_chunk_seconds: 90,
        max_gap_minutes: 10,
        note: 'Totals come from activity_events only. Semantic citations are supporting evidence, not time totals.',
      },
      debug: buildScreenSearchDebug(
        {
          modeUsed: modeUsed.includes('hybrid')
            ? 'hybrid'
            : modeUsed.includes('activity')
              ? 'activity'
              : modeUsed.includes('unavailable')
                ? 'unavailable'
                : 'text',
          status,
          retrievalTier,
          results: [],
          warning,
          freshness: response.freshness,
          confidence: response.confidence,
        },
        [],
      ),
    });
  } catch (error) {
    console.error('❌ getComputerTimeSpentBreakdown query-memory error:', error);
    return JSON.stringify({
      success: false,
      error: 'Computer time breakdown is currently unavailable.',
      details: String(error),
    });
  }
}
