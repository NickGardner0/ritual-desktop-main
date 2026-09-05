export type CalendarView = "day" | "week" | "month";
export type CalendarMode = "plan" | "review";
export type CalendarEventKind = "event" | "task_allocation";
export type CalendarEventOrigin = "ritual" | "google" | "ai";
export type CalendarEventStatus = "confirmed" | "tentative" | "canceled";
export type CalendarSyncState = "local" | "pending" | "synced" | "conflict" | "error";
export type RecurrenceScope = "occurrence" | "following" | "series";

export type CalendarSource = {
  id: string;
  account_id: string | null;
  provider: string | null;
  provider_calendar_id: string | null;
  name: string;
  color: string | null;
  timezone: string;
  access_role: string;
  is_visible: boolean;
  is_primary: boolean;
  is_default_write: boolean;
  writable: boolean;
  last_sync_at: string | null;
  last_error: string | null;
};

export type CalendarEvent = {
  id: string;
  user_id: string;
  source_id: string | null;
  source_name: string | null;
  source_color: string | null;
  kind: CalendarEventKind;
  origin: CalendarEventOrigin;
  title: string;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  all_day: boolean;
  status: CalendarEventStatus;
  availability: "busy" | "free";
  visibility: "default" | "public" | "private" | "confidential";
  location: Record<string, unknown>;
  conference: Record<string, unknown>;
  organizer: Record<string, unknown>;
  attendees: Array<Record<string, unknown>>;
  reminders: Record<string, unknown>;
  recurrence: string[];
  recurring_event_id: string | null;
  task_id: string | null;
  routine_run_id: string | null;
  provider_event_id: string | null;
  provider_event_type: string | null;
  provider_etag: string | null;
  sync_state: CalendarSyncState;
  revision: number;
  created_at: string | null;
  updated_at: string | null;
};

export type CalendarOccurrence = {
  id: string;
  event_id: string;
  source_id: string | null;
  title: string;
  description: string | null;
  location: Record<string, unknown>;
  kind: CalendarEventKind;
  origin: CalendarEventOrigin;
  task_id: string | null;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  all_day: boolean;
  status: CalendarEventStatus;
  self_response_status: "accepted" | "declined" | "tentative" | "needsAction" | null;
  availability: "busy" | "free";
  visibility: "default" | "public" | "private" | "confidential";
  source_name: string | null;
  source_color: string | null;
  provider_event_type: string | null;
  sync_state: CalendarSyncState;
  revision: number;
  is_exception: boolean;
  conflict: boolean;
};

export type CalendarTaskSummary = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  project: string | null;
  category: string | null;
  allocation_count: number;
};

export type WorkflowTimelineItem = {
  id: string;
  definition_id: string;
  name: string;
  kind: string;
  item_type: "planned" | "actual";
  status: string;
  start_at: string;
  end_at: string;
  expected_duration_minutes: number;
  approval_request_id?: string | null;
  run_id?: string | null;
};

export type CalendarReviewData = {
  habit_markers: Array<Record<string, unknown>>;
  activity_sessions: Array<Record<string, unknown>>;
  health_summaries: Array<Record<string, unknown>>;
  planned_minutes: number;
  attributable_actual_minutes: number;
  linked_task_comparisons: Array<Record<string, unknown>>;
  completed_task_count: number;
};

export type CalendarRangeReadModel = {
  start: string;
  end: string;
  timezone: string;
  mode: CalendarMode;
  occurrences: CalendarOccurrence[];
  tasks: CalendarTaskSummary[];
  workflows: WorkflowTimelineItem[];
  sources: CalendarSource[];
  sync: Array<{
    source_id: string;
    status: string;
    last_sync_at: string | null;
    error_code: string | null;
  }>;
  review: CalendarReviewData | null;
  proposals: CalendarMutationProposal[];
};

export type CalendarMutationProposal = {
  id: string;
  action: string;
  event_id?: string | null;
  occurrence_id?: string | null;
  before?: Record<string, unknown> | null;
  after: Record<string, unknown>;
  conflicts: string[];
  expires_at: string;
};

export type CalendarPreferences = {
  version: 3;
  view: CalendarView;
  mode: CalendarMode;
  tasks_open: boolean;
  side_panel_open: boolean;
  show_weekends: boolean;
  time_format: "12h" | "24h";
  visible_source_ids: string[];
  default_write_source_id: string | null;
  timezone: string;
  week_starts_on: 0 | 1;
  workday_start_minutes: number;
  workday_end_minutes: number;
  snap_minutes: 5 | 10 | 15 | 30 | 60;
  default_duration_minutes: number;
};
