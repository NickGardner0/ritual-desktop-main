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
  anchor_date?: string | null;
  intent_resolved?: string;
  days_back?: number;
  start_date?: string | null;
  end_date?: string | null;
  retrieval_tier?: string;
  citations?: Array<Record<string, unknown>>;
  citations_count?: number;
  time_truth?: Record<string, unknown> | null;
  confidence?: Record<string, unknown> | null;
  freshness?: Record<string, unknown> | null;
  rich_activity_summary?: string | null;
  calendar_style_summary?: string | null;
  calendar_style_date?: string | null;
  bundle?: Record<string, unknown> | null;
  workstreams?: Array<Record<string, unknown>>;
  retrieval_debug?: Record<string, unknown> | null;
  provider_path?: Record<string, unknown> | null;
  health?: Record<string, unknown> | null;
  degraded?: boolean;
  degradation_notes?: string[];
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
    id?: string;
    occurrence_id?: string;
    title: string;
    start?: string;
    end?: string;
    all_day?: boolean;
    kind?: string;
    source?: string;
    conflict?: boolean;
    sync_state?: string;
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
  actionReceipts?: ActionReceiptSummary[];
  entityRefs?: ChatEntityRef[];
};

/** Thin citation identity. Keep independent of shared-contracts. */
export type ChatEntityRef = {
  type: string;
  id: string;
  title?: string;
};

/** Mutation receipt returned by logHabit / createHabit tools */
export interface ActionReceiptSummary {
  receipt_id: string;
  action_kind: 'logHabit' | 'createHabit' | string;
  habit_id?: string | null;
  habit_name?: string | null;
  was_inserted?: boolean;
  undoable?: boolean;
  log_id?: string | null;
  amount?: number | null;
  date?: string | null;
}

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
