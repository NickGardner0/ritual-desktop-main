/**
 * Shared types for the chat-stream orchestrator and executor modules.
 *
 * Extracted from orchestrator.ts during Phase 1 refactoring.
 * These types are used across executors, narrative builders,
 * and the main orchestrator handler.
 */

// ---------------------------------------------------------------------------
// Per-tool result interfaces (Phase 2: replace `any` with proper types)
// ---------------------------------------------------------------------------

/** Shape returned by executeGetHabitStats after JSON.parse */
export interface HabitStatEntry {
  id: string;
  name: string;
  category?: string;
  unit?: string;
  total: number;
  average: number;
  min: number;
  max: number;
  std_dev?: number;
  days_with_data: number;
  total_entries: number;
}

/** Shape returned by executeGetDailyBreakdown after JSON.parse */
export interface DailyBreakdownEntry {
  date: string;
  value: number;
  logged?: boolean;
}

export interface DailyBreakdownHabit {
  id: string;
  name: string;
  unit?: string;
}

/** Shape returned by executeGetCorrelation after JSON.parse */
export interface CorrelationResult {
  success: boolean;
  correlation?: number;
  habit1?: string;
  habit2?: string;
  days_compared?: number;
  error?: string;
  available_habits?: string[];
  [key: string]: unknown;
}

/** Shape returned by executeGetHabitTrends after JSON.parse */
export interface TrendsResult {
  success: boolean;
  trends?: Array<{
    habit_name?: string;
    direction?: string;
    change_percent?: number;
    [key: string]: unknown;
  }>;
  suggested_followups?: string[];
  error?: string;
  available_habits?: string[];
  [key: string]: unknown;
}

/** Shape returned by executeGetHabitAnomalies after JSON.parse */
export interface AnomaliesResult {
  success: boolean;
  anomalies?: Array<{
    date?: string;
    habit_name?: string;
    value?: number;
    z_score?: number;
    [key: string]: unknown;
  }>;
  suggested_followups?: string[];
  error?: string;
  available_habits?: string[];
  [key: string]: unknown;
}

/** Shape returned by screen recording / context memory search */
export interface ScreenSearchResult {
  success: boolean;
  query?: string;
  days_searched?: number;
  result_count?: number;
  results?: Array<Record<string, unknown>>;
  status?: string;
  mode_used?: string;
  warning?: string;
  story_plan?: Record<string, unknown>;
  renderer?: Record<string, unknown>;
  rich_context_narrative?: string;
  message?: string;
  [key: string]: unknown;
}

/** Shape returned by executeGetComputerTimeSpentBreakdown */
export interface ComputerTimeResult {
  success: boolean;
  query?: string;
  group_by?: string;
  days_searched?: number;
  result_count?: number;
  summary?: {
    estimated_total_minutes?: number;
    estimated_total_hours?: number;
    total_hits?: number;
    unique_apps?: number;
    days_with_activity?: number;
    [key: string]: unknown;
  };
  top_categories?: Array<Record<string, unknown>>;
  daily_breakdown?: Array<Record<string, unknown>>;
  sample_moments?: Array<Record<string, unknown>>;
  error?: string;
  [key: string]: unknown;
}

/** Shape returned by overview executors (weekly, daily, monthly) */
export interface OverviewResult {
  success: boolean;
  habits?: Array<Record<string, unknown>>;
  computer?: Record<string, unknown>;
  date_range?: { start?: string; end?: string; days?: number };
  suggested_followups?: string[];
  rich_activity_summary?: string;
  calendar_style_summary?: string;
  calendar_style_date?: string | null;
  __response_instructions?: string;
  error?: string;
  [key: string]: unknown;
}

/** Shape returned by executeGetActivitySummary */
export interface ActivitySummaryResult {
  success: boolean;
  query?: string;
  intent_resolved?: string;
  retrieval_tier?: string;
  story_plan?: Record<string, unknown>;
  citations?: Array<Record<string, unknown>>;
  citations_count?: number;
  time_truth?: Record<string, unknown> | null;
  confidence?: Record<string, unknown> | null;
  freshness?: Record<string, unknown> | null;
  rich_activity_summary?: string | null;
  calendar_style_summary?: string | null;
  calendar_style_date?: string | null;
  error?: string;
  [key: string]: unknown;
}

/** Shape returned by executeGetDailyBiometrics */
export interface BiometricsResult {
  success: boolean;
  day?: string;
  average_bpm?: number;
  min_bpm?: number;
  max_bpm?: number;
  total_samples?: number;
  lowest_window?: Record<string, unknown>;
  highest_window?: Record<string, unknown>;
  source_breakdown?: Record<string, unknown>;
  error?: string;
}

/** Shape returned by executeGetScreenTimeSummary */
export interface ScreenTimeSummaryResult {
  success: boolean;
  start_date?: string;
  end_date?: string;
  total_active_ms?: number;
  is_connected?: boolean;
  has_data?: boolean;
  daily?: Array<Record<string, unknown>>;
  top_apps?: Array<Record<string, unknown>>;
  error?: string;
}

/** Shape returned by executeGetCalendarEvents */
export interface CalendarEventsResult {
  success: boolean;
  start_date?: string;
  end_date?: string;
  events?: Array<{
    title: string;
    day: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
  }>;
  event_count?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool results aggregation (collected across a single chat turn)
// ---------------------------------------------------------------------------

export type ChatToolResults = {
  stats?: HabitStatEntry[];
  dailyBreakdown?: DailyBreakdownEntry[];
  dailyBreakdownHabit?: DailyBreakdownHabit;
  correlation?: CorrelationResult;
  trends?: TrendsResult;
  anomalies?: AnomaliesResult;
  screenRecordings?: ScreenSearchResult;
  contextMemoryRecap?: ScreenSearchResult;
  screenTimeSpent?: ComputerTimeResult;
  weeklyOverview?: OverviewResult;
  dailyOverview?: OverviewResult;
  monthlyOverview?: OverviewResult;
  allStats?: HabitStatEntry[];
  allBreakdowns?: Array<{ habit: DailyBreakdownHabit; data: DailyBreakdownEntry[] }>;
  activitySummary?: ActivitySummaryResult;
  dailyBiometrics?: BiometricsResult;
  screenTimeSummary?: ScreenTimeSummaryResult;
  calendarEvents?: CalendarEventsResult;
  suggested_followups?: string[];
  reply_chips?: string[];
};

// ---------------------------------------------------------------------------
// Local (desktop) activity data passed from the client
// ---------------------------------------------------------------------------

export type LocalOverviewActivityBundle = {
  startDate?: string;
  endDate?: string;
  daily?: Array<{
    day?: string;
    active_hours?: number;
    events_count?: number;
    apps_count?: number;
  }>;
  apps?: Array<{
    app_bundle_id?: string;
    app_name?: string;
    hours?: number;
    total_events?: number;
  }>;
  domains?: Array<{
    domain?: string;
    hours?: number;
    total_events?: number;
  }>;
  source?: string;
};

// ---------------------------------------------------------------------------
// Screen search / recording types
// ---------------------------------------------------------------------------

export interface ScreenRecordingResult {
  frame_id: number;
  timestamp: number;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  document_path: string | null;
  ocr_text: string;
  relevance_score: number;
  source?: 'hybrid' | 'text' | 'activity';
  fts_matched?: boolean;
}

export interface ScreenSearchContext {
  modeUsed: 'hybrid' | 'text' | 'activity' | 'none' | 'unavailable';
  status: 'hybrid' | 'text-fallback' | 'text-only' | 'activity-only' | 'unavailable';
  retrievalTier?:
    | 'semantic_full'
    | 'semantic_frame'
    | 'lexical_fts'
    | 'cloud_hybrid'
    | 'cloud_lexical_only'
    | 'activity_only'
    | 'unavailable';
  results: ScreenRecordingResult[];
  resolvedDaysBack?: number;
  startDate?: string;
  endDate?: string;
  warning?: string;
  freshness?: {
    status?: string;
    [key: string]: unknown;
  };
  confidence?: {
    level?: 'high' | 'medium' | 'low';
    score?: number;
    corroborating_chunks?: number;
    reason?: string;
    [key: string]: unknown;
  };
  citations?: Array<{
    chunk_id?: number | null;
    frame_id?: number | null;
    timestamp?: number;
    app_name?: string;
    window_title?: string | null;
    session_key?: string | null;
    context_version?: number;
    snippet?: string;
    score?: number;
    source?: string;
    text_compact?: string;
    contextual_text_compact?: string;
    chunk_start_ts?: number;
  }>;
  semanticTruth?: {
    warning?: string;
    mode_used?: string;
    recap_outline?: Record<string, unknown>;
    story_plan?: Record<string, unknown>;
    renderer?: Record<string, unknown>;
    highlights?: Array<{
      frame_id?: number | null;
      timestamp?: number;
      app_name?: string;
      window_title?: string | null;
      session_key?: string | null;
      context_version?: number;
      snippet?: string;
      score?: number;
      source?: string;
    }>;
  };
  retrievalDebug?: MemorySearchDebug | null;
  pendingEmbeddings?: number;
  totalEmbeddings?: number;
  workerRunning?: boolean;
}

export interface MemorySearchDebug {
  expanded_queries?: Array<{ type?: string; text?: string; weight?: number }>;
  retrieval_lists?: Array<{
    source?: string;
    query_type?: string;
    query_types?: string[];
    query?: string;
    result_count?: number;
    candidate_count?: number;
    candidate_limit?: number;
  }>;
  rrf_trace?: Array<{
    doc_id?: string;
    top_rank?: number;
    top_rank_bonus?: number;
    total_score?: number;
  }>;
  strong_signal_short_circuit?: {
    exact_match?: boolean;
    top_score?: number;
    runner_up_score?: number;
    source_type?: string;
    provider_doc_id?: string;
  } | null;
  rerank_cache_hit?: boolean;
  candidate_limit_applied?: number | Record<string, unknown>;
  rerank_candidates_considered?: number;
}

export interface LocalScreenSearchApiResponse {
  success: boolean;
  query: string;
  days_back: number;
  result_count: number;
  results: ScreenRecordingResult[];
  mode_used: 'hybrid' | 'fts' | 'like-fallback' | 'activity-fallback' | 'none';
  status: 'hybrid' | 'text-only' | 'activity-only' | 'unavailable';
  warning?: string;
  freshness?: {
    status?: string;
    [key: string]: unknown;
  };
  confidence?: {
    level?: 'high' | 'medium' | 'low';
    score?: number;
    corroborating_chunks?: number;
    reason?: string;
    [key: string]: unknown;
  };
  source_db?: string;
  error?: string;
}

export interface MemoryTimeTruthBucket {
  bucket: string;
  total_active_ms: number;
  total_active_hours: number;
  share_percent: number;
  hits: number;
  last_seen_ts: number | null;
}

export interface MemoryTimeTruthDaily {
  date: string;
  total_active_ms: number;
  total_active_hours: number;
  hits: number;
}

export interface MemoryQueryApiResponse {
  success: boolean;
  query: string;
  intent_resolved: 'time_spent' | 'semantic_lookup' | 'evidence_timeline' | 'broad_overview' | string;
  answer_mode: string;
  results?: Array<{
    frame_id?: number | null;
    timestamp?: number;
    app_bundle_id?: string;
    app_name?: string;
    window_title?: string | null;
    ocr_text?: string;
    snippet?: string;
    relevance_score?: number;
    score?: number;
    source?: string;
    fts_matched?: boolean;
  }>;
  retrieval_tier?:
    | 'semantic_full'
    | 'semantic_frame'
    | 'lexical_fts'
    | 'cloud_hybrid'
    | 'cloud_lexical_only'
    | 'activity_only'
    | 'unavailable'
    | string;
  days_back: number;
  start_date: string;
  end_date: string;
  group_by: 'app' | 'domain' | 'window' | string;
  time_truth?: {
    metric_source?: string;
    group_by?: string;
    range_start?: string;
    range_end?: string;
    total_active_ms?: number;
    total_active_hours?: number;
    total_events?: number;
    days_with_activity?: number;
    unique_buckets?: number;
    top_buckets?: MemoryTimeTruthBucket[];
    daily_breakdown?: MemoryTimeTruthDaily[];
  } | null;
  semantic_truth?: {
    query?: string;
    result_count?: number;
    mode_used?: string;
    status?: string;
    highlights?: Array<{
      chunk_id?: number | null;
      frame_id?: number | null;
      timestamp?: number;
      app_name?: string;
      window_title?: string | null;
      session_key?: string | null;
      context_version?: number;
      snippet?: string;
      score?: number;
      source?: string;
    }>;
    warning?: string;
    story_plan?: Record<string, unknown>;
    renderer?: Record<string, unknown>;
  } | null;
  citations?: Array<{
    chunk_id?: number | null;
    frame_id?: number | null;
    timestamp?: number;
    app_name?: string;
    window_title?: string | null;
    session_key?: string | null;
    context_version?: number;
    snippet?: string;
    score?: number;
    source?: string;
    text_compact?: string;
    contextual_text_compact?: string;
    chunk_start_ts?: number;
  }>;
  freshness?: {
    status?: string;
    [key: string]: unknown;
  };
  confidence?: {
    level?: 'high' | 'medium' | 'low';
    score?: number;
    corroborating_chunks?: number;
    reason?: string;
    [key: string]: unknown;
  };
  provider_path?: {
    retrieval?: string;
    rerank?: string;
    answer?: string;
  };
  warning?: string;
  source_db?: string;
  error?: string | null;
  debug?: MemorySearchDebug | null;
}

export interface ScreenSearchDebugPayload {
  enabled: true;
  mode_used: ScreenSearchContext['modeUsed'];
  status: ScreenSearchContext['status'];
  retrieval_tier?: ScreenSearchContext['retrievalTier'];
  warning?: string;
  strong_signal_short_circuit?: MemorySearchDebug['strong_signal_short_circuit'];
  rerank_cache_hit?: boolean;
  candidate_limit_applied?: number | Record<string, unknown>;
  rerank_candidates_considered?: number;
  retrieval_lists?: Array<{
    source?: string;
    query_type?: string;
    query_types?: string[];
    result_count?: number;
    candidate_count?: number;
    candidate_limit?: number;
  }>;
  rrf_trace?: Array<{
    doc_id?: string;
    top_rank?: number;
    top_rank_bonus?: number;
    total_score?: number;
  }>;
  source_counts: {
    hybrid: number;
    text: number;
    activity: number;
    unknown: number;
  };
}

// ---------------------------------------------------------------------------
// Weekly overview payload types (used by narrative builders)
// ---------------------------------------------------------------------------

export interface WeeklyOverviewHabitSummary {
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
}

export interface WeeklyOverviewComputerSummary {
  daily: Array<{
    day: string;
    active_hours: number;
    events_count: number;
    apps_count: number;
    source?: string;
  }>;
  topApps: Array<{
    app_bundle_id?: string;
    app_name: string;
    hours: number;
    total_events: number;
    source?: string;
  }>;
  topDomains: Array<{
    domain: string;
    hours: number;
    total_events: number;
    source?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Calendar / recap types
// ---------------------------------------------------------------------------

export type CalendarEvidenceSnippet = {
  timestamp: number;
  app_name: string;
  window_title: string | null;
  snippet: string;
  score?: number;
  source?: string;
};

export type StructuredRecapWorkstream = {
  label: string;
  evidence_count: number;
  apps: string[];
  representative_windows: string[];
  supporting_snippets: string[];
  specific_tasks: string[];
};
