/**
 * Context memory, screen recording search, and activity summary executors.
 *
 * Extracted from orchestrator.ts (lines 4110-4806) during Phase 1 refactoring.
 */

import type { ScreenSearchContext } from '../types';
import {
  fetchPythonApiPost,
  clampDaysBack,
  clampSearchLimit,
  compactScreenWarning,
} from './shared-api';
import {
  inferScreenDaysBackFromQuery,
  inferRelativeCutoffTimestamp,
  resolveScreenSearchContext,
  fetchLocalScreenSearchContext,
  mergeScreenResults,
  rerankScreenResultsByQuery,
  isActivityAggregateText,
  hasSubstantiveOcrEvidence,
  buildBroadOverviewEvidence,
  buildScreenSearchDebug,
} from './screen-search-helpers';

// These query classifiers are still in orchestrator.ts — they're passed in
// as function arguments to avoid circular imports. The orchestrator calls:
//   executeSearchScreenRecordings(token, params, prefetched, isScreenTimeSpentQuery, isBroadScreenOverviewQuery)

// ---------------------------------------------------------------------------
// executeSearchScreenRecordings
// ---------------------------------------------------------------------------

export async function executeSearchScreenRecordings(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  isScreenTimeSpentQueryFn: (text: string) => boolean,
  isBroadScreenOverviewQueryFn: (text: string) => boolean,
): Promise<string> {
  console.log('🖥️ searchScreenRecordings called:', params);
  console.log('🖥️ prefetched screenRecordingResults count:', prefetchedScreenSearchContext?.results?.length ?? 0);

  const safeDaysBack = clampDaysBack(params.daysBack);
  const inferredDaysBack = inferScreenDaysBackFromQuery(params.query, safeDaysBack);
  const cutoffTs = inferRelativeCutoffTimestamp(params.query);
  const explicitTimeSpentQuery = isScreenTimeSpentQueryFn(params.query);
  const safeLimit = clampSearchLimit(params.limit);
  let screenSearchContext = await resolveScreenSearchContext(
    token,
    {
      query: params.query,
      daysBack: inferredDaysBack,
      limit: Math.max(safeLimit * 2, 20),
    },
    prefetchedScreenSearchContext,
    isScreenTimeSpentQueryFn,
  );

  if (screenSearchContext) {
    const hasOnlyAggregateRows = (
      screenSearchContext.results.length > 0
      && screenSearchContext.results.every((row) => isActivityAggregateText(row.ocr_text))
    );
    if (screenSearchContext.results.length === 0 || (!explicitTimeSpentQuery && hasOnlyAggregateRows)) {
      const localContext = await fetchLocalScreenSearchContext(token, {
        query: params.query,
        daysBack: inferredDaysBack,
        limit: Math.max(safeLimit * 3, 30),
      });
      if (localContext) {
        const mergedResults = mergeScreenResults(localContext.results, screenSearchContext.results);
        screenSearchContext = {
          modeUsed: localContext.modeUsed !== 'none' ? localContext.modeUsed : screenSearchContext.modeUsed,
          status: localContext.status !== 'unavailable' ? localContext.status : screenSearchContext.status,
          retrievalTier: screenSearchContext.retrievalTier || localContext.retrievalTier,
          results: mergedResults,
          resolvedDaysBack: localContext.resolvedDaysBack ?? screenSearchContext.resolvedDaysBack,
          startDate: localContext.startDate ?? screenSearchContext.startDate,
          endDate: localContext.endDate ?? screenSearchContext.endDate,
          warning: [screenSearchContext.warning, localContext.warning].filter(Boolean).join(' ').trim() || undefined,
          freshness: screenSearchContext.freshness,
          confidence: screenSearchContext.confidence,
          citations: screenSearchContext.citations,
          pendingEmbeddings: screenSearchContext.pendingEmbeddings,
          totalEmbeddings: screenSearchContext.totalEmbeddings,
          workerRunning: screenSearchContext.workerRunning,
        };
      }
    }
  }

  if (screenSearchContext === null || screenSearchContext === undefined) {
    return JSON.stringify({
      success: false,
      error: 'Screen history search is currently unavailable.',
      hint: 'Make sure screen recording is active and local indexing is still processing.',
    });
  }

  let screenRecordingResults = screenSearchContext.results ?? [];
  if (cutoffTs) {
    screenRecordingResults = screenRecordingResults.filter((item) => item.timestamp >= cutoffTs);
  }
  if (!explicitTimeSpentQuery) {
    screenRecordingResults = screenRecordingResults.filter((item) => !isActivityAggregateText(item.ocr_text));
  }
  const resolvedDaysBack = screenSearchContext.resolvedDaysBack ?? safeDaysBack;
  if (screenRecordingResults.length === 0 && screenSearchContext.status === 'unavailable') {
    return JSON.stringify({
      success: false,
      error: 'Screen history search is currently unavailable.',
      hint: 'Make sure computer tracking is enabled and local screen indexing has produced data.',
      warning: compactScreenWarning(screenSearchContext.warning),
      debug: buildScreenSearchDebug(screenSearchContext, screenRecordingResults),
    });
  }

  if (screenRecordingResults.length === 0) {
    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: 0,
      results: [],
      status: screenSearchContext.status,
      mode_used: screenSearchContext.modeUsed,
      warning: compactScreenWarning(screenSearchContext.warning),
      debug: buildScreenSearchDebug(screenSearchContext, screenRecordingResults),
      message: `No screen recordings found matching "${params.query}". Try different keywords or check if screen recording is enabled.`,
    });
  }

  const rankedResults = rerankScreenResultsByQuery(screenRecordingResults, params.query);

  const filteredResults = rankedResults.slice(0, safeLimit);
  if (filteredResults.length === 0) {
    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: 0,
      results: [],
      status: screenSearchContext.status,
      mode_used: screenSearchContext.modeUsed,
      warning: compactScreenWarning(screenSearchContext.warning),
      debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
      message: `No screen recordings found matching "${params.query}" in the requested time range.`,
    });
  }

  const confidenceLevel = screenSearchContext.confidence?.level || 'low';
  const confidenceScore = Number(screenSearchContext.confidence?.score || 0);
  const corroboratingChunks = Number(screenSearchContext.confidence?.corroborating_chunks || 0);
  const substantiveEvidenceCount = filteredResults.filter((item) => hasSubstantiveOcrEvidence(item.ocr_text)).length;
  const strongMatchCount = filteredResults.filter((item) => item.relevance_score >= 0.6).length;
  const hasConcreteActivityEvidence = filteredResults.some(
    (item) => item.source === 'activity' && !isActivityAggregateText(item.ocr_text) && item.ocr_text.trim().length >= 16,
  );
  const broadOverviewQuery = isBroadScreenOverviewQueryFn(params.query);
  const isActivityOnly = (
    screenSearchContext.retrievalTier === 'activity_only'
    || screenSearchContext.modeUsed === 'activity'
  );
  const weakEvidenceOnly = (
    !explicitTimeSpentQuery
    && (
      filteredResults.length === 0
      || (substantiveEvidenceCount === 0 && corroboratingChunks < 1 && !hasConcreteActivityEvidence)
      || (confidenceLevel === 'low' && confidenceScore < 0.35 && strongMatchCount === 0)
    )
    && !broadOverviewQuery
  );

  if (weakEvidenceOnly) {
    const weakEvidenceWarning = [
      'Only weak semantic evidence is currently available for this query.',
      'Avoid topic-specific claims until stronger OCR citations are present.',
      compactScreenWarning(screenSearchContext.warning),
    ]
      .filter(Boolean)
      .join(' ');

    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: 0,
      results: [],
      status: 'text-fallback',
      mode_used: screenSearchContext.modeUsed,
      warning: weakEvidenceWarning,
      freshness: screenSearchContext.freshness,
      confidence: screenSearchContext.confidence,
      debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
      message: 'I could not find enough grounded screen evidence for a reliable task summary in that exact time window.',
    });
  }

  if (broadOverviewQuery) {
    const expandedResults = rankedResults.slice(0, Math.max(safeLimit, 20));
    const structuredEvidence = buildBroadOverviewEvidence(
      expandedResults,
      screenSearchContext.citations,
      screenSearchContext.semanticTruth,
    );

    console.log('🖥️ Returning structured broad-overview evidence:', structuredEvidence.evidence_timeline.length);

    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: structuredEvidence.evidence_timeline.length,
      status: screenSearchContext.status,
      mode_used: screenSearchContext.modeUsed,
      warning: compactScreenWarning(screenSearchContext.warning),
      summary_style: 'structured_recap',
      guidance: [
        'Summarize the user day as concrete tasks and projects, not generic themes.',
        'Treat evidence.recap_outline as the primary scaffold for the answer and use evidence_timeline/citation_timeline only to add detail.',
        'Lead with evidence.recap_outline.main_event and evidence.recap_outline.claim_cards before summarizing any supporting workstreams.',
        'Lead with the most specific task phrases from evidence.recap_outline.specific_tasks and the workstream-specific specific_tasks lists before mentioning broad app categories.',
        'Name specific apps, windows, documents, sites, tasks, and project nouns whenever they appear in the evidence.',
        'Do not collapse distinct workstreams into one abstract summary when recap_outline.main_workstreams lists multiple clusters.',
        'Return exactly these sections in this order: Main event, Supporting workstreams, Concrete tasks, Apps and tools used, Strongest evidence, Uncertainty or conflicts.',
        'In Main event and Supporting workstreams, use exact task phrases, artifacts, and project nouns from claim_cards, main_event, and specific_tasks.',
        'In Strongest evidence, cite the most concrete snippets first and mention timestamps/apps when useful; avoid sentences that only restate app names.',
        'If evidence is weak or ambiguous, say what is missing instead of guessing.',
      ].join(' '),
      freshness: screenSearchContext.freshness,
      confidence: screenSearchContext.confidence,
      debug: buildScreenSearchDebug(screenSearchContext, expandedResults),
      evidence: structuredEvidence,
      results: structuredEvidence.evidence_timeline,
    });
  }

  // Format results for the AI
  const formattedResults = filteredResults.map(r => ({
    timestamp: new Date(r.timestamp).toISOString(),
    app: r.app_name,
    window: r.window_title || 'Unknown',
    content_preview: r.ocr_text.substring(0, 300) + (r.ocr_text.length > 300 ? '...' : ''),
    relevance: Math.round(r.relevance_score * 100) + '%',
    source: r.source || 'text',
    fts_matched: r.fts_matched || false,
  }));

  console.log('🖥️ Returning', formattedResults.length, 'formatted results to AI');

  return JSON.stringify({
    success: true,
    query: params.query,
    days_searched: resolvedDaysBack,
    result_count: formattedResults.length,
    status: screenSearchContext.status,
    mode_used: screenSearchContext.modeUsed,
    warning: compactScreenWarning(screenSearchContext.warning),
    summary_style: 'narrative_actions_first',
    guidance: 'Summarize likely tasks/actions from snippets and windows. Do not report total app hours unless user explicitly asks for time spent.',
    freshness: screenSearchContext.freshness,
    confidence: screenSearchContext.confidence,
    debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
    results: formattedResults,
  });
}

// ---------------------------------------------------------------------------
// executeSearchContextMemory
// ---------------------------------------------------------------------------

export async function executeSearchContextMemory(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
): Promise<string> {
  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit);

  try {
    const response = await fetchPythonApiPost('/api/memory/search-context', token, {
      query: params.query,
      days_back: safeDaysBack,
      limit: safeLimit,
    });
    return JSON.stringify({
      success: Boolean(response?.success),
      query: params.query,
      days_searched: Number(response?.days_back || safeDaysBack),
      result_count: Number(response?.result_count || (Array.isArray(response?.results) ? response.results.length : 0)),
      results: Array.isArray(response?.results) ? response.results : [],
      status: response?.status || 'unavailable',
      mode_used: response?.mode_used || 'none',
      warning: compactScreenWarning(response?.warning),
      story_plan: response?.story_plan || null,
      renderer: response?.renderer || null,
      debug: response?.debug || null,
      message: Array.isArray(response?.results) && response.results.length === 0
        ? `No context memory matches found for "${params.query}".`
        : undefined,
    });
  } catch (error) {
    console.error('❌ searchContextMemory error:', error);
    return JSON.stringify({
      success: false,
      error: 'Context memory search is currently unavailable.',
      hint: 'Make sure context awareness capture has recent snapshots.',
    });
  }
}

// ---------------------------------------------------------------------------
// executeGetActivitySummary
// ---------------------------------------------------------------------------

export async function executeGetActivitySummary(
  token: string,
  params: { query?: string; daysBack?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  timezone?: string,
  // These functions are injected from orchestrator to avoid circular imports
  inferRecapAnchorDateFn?: (query: string, daysBack: number, timezone?: string) => string | null,
  buildCalendarStyleActivitySummaryFn?: (token: string, anchorDate: string, timezone?: string) => Promise<any>,
  buildRichActivitySummaryFromStoryPlanFn?: (payload: any, query: string, timezone?: string, calendarSummary?: any) => Promise<any>,
  isScreenTimeSpentQueryFn?: (text: string) => boolean,
) {
  const safeDaysBack = clampDaysBack(params.daysBack ?? 1);
  const remoteQueryLimit = 96;
  const localResolveLimit = 48;
  const localHydrateLimit = 64;
  const localCitationLimit = 36;
  const query = params.query || 'activity summary';
  console.log('📋 getActivitySummary called:', { query, daysBack: safeDaysBack });

  const stripStoryPlanMeta = (rawPlan: any): any => {
    if (Array.isArray(rawPlan)) return rawPlan.map(stripStoryPlanMeta);
    if (rawPlan && typeof rawPlan === 'object') {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(rawPlan)) {
        if (
          [
            'evidence_count',
            'score_main_event',
            'confidence',
            'grounding_score',
            'grounding_reasons',
            'supporting_evidence_ids',
            'counter_evidence_ids',
            'metrics',
            'session_keys',
          ].includes(k)
        ) continue;
        cleaned[k] = stripStoryPlanMeta(v);
      }
      return cleaned;
    }
    return rawPlan;
  };

  const recapAnchorDate = inferRecapAnchorDateFn
    ? inferRecapAnchorDateFn(query, safeDaysBack, timezone)
    : null;
  if (recapAnchorDate) {
    try {
      const recapResponse = await fetchPythonApiPost(
        '/api/memory/recap/day',
        token,
        {
          query,
          anchor_date: recapAnchorDate,
          timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
          days_back: safeDaysBack,
        },
        { timeoutMs: 12_000 },
      );
      if (recapResponse?.success) {
        return JSON.stringify({
          success: true,
          query,
          anchor_date: recapAnchorDate,
          intent_resolved: recapResponse.intent_resolved || 'anchored_day_recap',
          days_back: Number(recapResponse.days_back || safeDaysBack),
          start_date: recapResponse.start_date || recapAnchorDate,
          end_date: recapResponse.end_date || recapAnchorDate,
          retrieval_tier: recapResponse.retrieval_tier || 'day_recap_bundle',
          story_plan: recapResponse?.semantic_truth?.story_plan || null,
          citations: Array.isArray(recapResponse.citations) ? recapResponse.citations : [],
          citations_count: Number(recapResponse.citations_count || (Array.isArray(recapResponse.citations) ? recapResponse.citations.length : 0)),
          time_truth: recapResponse.time_truth || null,
          confidence: recapResponse.confidence || null,
          freshness: recapResponse.freshness || null,
          rich_activity_summary: recapResponse.rich_activity_summary || recapResponse.rendered_summary || null,
          calendar_style_summary: recapResponse.calendar_style_summary || recapResponse.rendered_summary || null,
          calendar_style_date: recapResponse.calendar_style_date || recapAnchorDate,
          bundle: recapResponse.bundle || null,
          workstreams: Array.isArray(recapResponse.workstreams) ? recapResponse.workstreams : [],
          health: recapResponse.health || null,
          degraded: Boolean(recapResponse.degraded),
          degradation_notes: Array.isArray(recapResponse.degradation_notes) ? recapResponse.degradation_notes : [],
          semantic_truth: recapResponse.semantic_truth || null,
          source: 'anchored_day_recap_bundle',
        });
      }
    } catch (error) {
      console.warn('⚠️ Anchored recap bundle failed, falling back to broad overview path:', error);
    }
  }

  const calendarStyleSummaryPromise = (recapAnchorDate && buildCalendarStyleActivitySummaryFn)
    ? buildCalendarStyleActivitySummaryFn(token, recapAnchorDate, timezone)
    : Promise.resolve(null);

  const buildLocalFallbackPayload = async () => {
    let screenSearchContext = await resolveScreenSearchContext(
      token,
      {
        query,
        daysBack: safeDaysBack,
        limit: localResolveLimit,
      },
      prefetchedScreenSearchContext,
      isScreenTimeSpentQueryFn || (() => false),
    );

    if (screenSearchContext) {
      const hasOnlyAggregateRows = (
        screenSearchContext.results.length > 0
        && screenSearchContext.results.every((row) => isActivityAggregateText(row.ocr_text))
      );

      if (screenSearchContext.results.length === 0 || hasOnlyAggregateRows) {
        const localContext = await fetchLocalScreenSearchContext(token, {
          query,
          daysBack: safeDaysBack,
          limit: localHydrateLimit,
        });
        if (localContext) {
          const mergedResults = mergeScreenResults(localContext.results, screenSearchContext.results);
          screenSearchContext = {
            modeUsed: localContext.modeUsed !== 'none' ? localContext.modeUsed : screenSearchContext.modeUsed,
            status: localContext.status !== 'unavailable' ? localContext.status : screenSearchContext.status,
            retrievalTier: screenSearchContext.retrievalTier || localContext.retrievalTier,
            results: mergedResults,
            resolvedDaysBack: localContext.resolvedDaysBack ?? screenSearchContext.resolvedDaysBack,
            startDate: localContext.startDate ?? screenSearchContext.startDate,
            endDate: localContext.endDate ?? screenSearchContext.endDate,
            warning: [screenSearchContext.warning, localContext.warning].filter(Boolean).join(' ').trim() || undefined,
            freshness: screenSearchContext.freshness,
            confidence: screenSearchContext.confidence,
            citations: screenSearchContext.citations,
            semanticTruth: screenSearchContext.semanticTruth,
            pendingEmbeddings: screenSearchContext.pendingEmbeddings,
            totalEmbeddings: screenSearchContext.totalEmbeddings,
            workerRunning: screenSearchContext.workerRunning,
          };
        }
      }
    } else {
      screenSearchContext = await fetchLocalScreenSearchContext(token, {
        query,
        daysBack: safeDaysBack,
        limit: localHydrateLimit,
      });
    }

    if (!screenSearchContext || !Array.isArray(screenSearchContext.results) || screenSearchContext.results.length === 0) {
      return null;
    }

    const rankedResults = rerankScreenResultsByQuery(screenSearchContext.results, query);
    const filteredResults = rankedResults
      .filter((row) => !isActivityAggregateText(row.ocr_text))
      .slice(0, localResolveLimit);
    if (filteredResults.length === 0) {
      return null;
    }

    const structuredEvidence = buildBroadOverviewEvidence(
      filteredResults,
      screenSearchContext.citations,
      screenSearchContext.semanticTruth,
    );
    const citationsSource = (screenSearchContext.citations && screenSearchContext.citations.length > 0)
      ? screenSearchContext.citations.slice(0, localCitationLimit).map((citation) => ({
          app: citation.app_name || '',
          title: citation.window_title || '',
          text: (citation.snippet || '').slice(0, 300),
          ts: citation.timestamp || 0,
        }))
      : filteredResults.slice(0, localCitationLimit).map((result) => ({
          app: result.app_name || '',
          title: result.window_title || '',
          text: (result.ocr_text || '').slice(0, 300),
          ts: result.timestamp || 0,
        }));

    return {
      success: true,
      query,
      intent_resolved: 'broad_overview',
      days_back: safeDaysBack,
      start_date: screenSearchContext.startDate || null,
      end_date: screenSearchContext.endDate || null,
      retrieval_tier: screenSearchContext.retrievalTier || screenSearchContext.modeUsed || 'desktop_local',
      story_plan: stripStoryPlanMeta(structuredEvidence.recap_outline || null),
      citations: citationsSource,
      citations_count: citationsSource.length,
      time_truth: null,
      confidence: screenSearchContext.confidence || null,
      freshness: screenSearchContext.freshness || null,
      warning: compactScreenWarning(screenSearchContext.warning),
      source: 'desktop_local_fallback',
    };
  };

  try {
    const [response, calendarStyleSummary] = await Promise.all([
      fetchPythonApiPost('/api/memory/query', token, {
        query,
        intent: 'broad_overview',
        days_back: safeDaysBack,
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        group_by: 'app',
        limit: remoteQueryLimit,
      }),
      calendarStyleSummaryPromise,
    ]);

    const hasRemoteStoryPlan = Boolean(response?.semantic_truth?.story_plan);
    const remoteCitations = Array.isArray(response?.citations) ? response.citations : [];
    if (!response || response.error || (!hasRemoteStoryPlan && remoteCitations.length === 0)) {
      const localFallback = await buildLocalFallbackPayload();
      if (localFallback) {
        if (calendarStyleSummary) {
          (localFallback as Record<string, unknown>).calendar_style_summary = calendarStyleSummary;
          (localFallback as Record<string, unknown>).calendar_style_date = recapAnchorDate;
        }
        return JSON.stringify(localFallback);
      }

      return JSON.stringify({
        success: Boolean(calendarStyleSummary),
        error: response?.error || 'Activity summary unavailable.',
        calendar_style_summary: calendarStyleSummary || null,
        calendar_style_date: recapAnchorDate,
      });
    }

    const citations = remoteCitations.slice(0, localCitationLimit).map((c: any) => ({
      app: c.app_name || c.app || '',
      title: c.window_title || c.title || '',
      text: (c.text_compact || c.contextual_text_compact || c.snippet || '').slice(0, 300),
      ts: c.chunk_start_ts || c.timestamp || 0,
    }));

    const rawPlan = response.semantic_truth?.story_plan || null;
    const cleanPlan = rawPlan ? stripStoryPlanMeta(rawPlan) : rawPlan;
    const semanticWorkItems = Array.isArray(response?.semantic_truth?.semantic_work_items)
      ? response.semantic_truth.semantic_work_items
      : [];

    const richActivitySummary = buildRichActivitySummaryFromStoryPlanFn
      ? await buildRichActivitySummaryFromStoryPlanFn(
          {
            success: true,
            story_plan: cleanPlan,
            semantic_work_items: semanticWorkItems,
            renderer: response.semantic_truth?.renderer || cleanPlan?.renderer || null,
            results: Array.isArray(response.results) ? response.results : [],
            citations,
          },
          query,
          timezone,
          calendarStyleSummary,
        )
      : null;

    return JSON.stringify({
      success: true,
      query: response.query || query,
      intent_resolved: response.intent_resolved || 'broad_overview',
      days_back: Number(response.days_back || safeDaysBack),
      start_date: response.start_date || null,
      end_date: response.end_date || null,
      retrieval_tier: response.retrieval_tier,
      story_plan: cleanPlan,
      semantic_work_items: semanticWorkItems,
      citations,
      citations_count: citations.length,
      time_truth: response.time_truth || null,
      confidence: response.confidence || null,
      freshness: response.freshness || null,
      rich_activity_summary: richActivitySummary || null,
      calendar_style_summary: calendarStyleSummary || null,
      calendar_style_date: recapAnchorDate,
    });
  } catch (error) {
    console.error('❌ getActivitySummary error:', error);
    const calendarStyleSummary = await calendarStyleSummaryPromise.catch(() => null);
    return JSON.stringify({
      success: Boolean(calendarStyleSummary),
      error: calendarStyleSummary ? undefined : 'Activity summary is currently unavailable.',
      details: String(error),
      query,
      intent_resolved: 'broad_overview',
      days_back: safeDaysBack,
      start_date: null,
      end_date: null,
      calendar_style_summary: calendarStyleSummary || null,
      calendar_style_date: recapAnchorDate,
    });
  }
}
