export type ArtifactKind =
  | "report"
  | "morning_brief"
  | "shutdown_review"
  | "notebook"
  | "plan"
  | "conversation_brief"
  | "ambient_digest";
export type ArtifactStatus = "draft" | "published" | "archived";
export type ArtifactSourceType = "report_run" | "workflow_run" | "conversation" | "manual" | "ambient_signal";
export type ArtifactLinkTargetType = "conversation" | "message" | "workflow_run" | "fact" | "ambient_signal";
export type WorkflowStatus = "draft" | "scheduled" | "paused";
export type WorkflowRunStatus = "queued" | "processing" | "completed" | "failed" | "canceled";
export type ActionProfileMode = "observe" | "draft" | "organize" | "act";
export type WorkflowKind = "morning_brief" | "shutdown_review" | "daily_narrative" | "distraction_spiral";
export type WorkflowDefinitionFamily = "routine" | "ambient";
export type WorkflowTriggerType = "schedule" | "signal";
export type WorkflowTriggerSource = "manual" | "scheduled" | "backfill" | "signal";
export type ReportRunStatus = "queued" | "processing" | "sent" | "failed";
export type AiFactCategory = "goal" | "preference" | "constraint" | "routine" | "profile";
export type AiFactStatus = "pending" | "active" | "dismissed" | "archived";
export type AiFactSourceType = "onboarding" | "assistant" | "workflow" | "ambient" | "user";
export type AiFactVisibility = "private" | "prompt" | "ui";
export type ConversationQueueStatus = "pending" | "running" | "completed" | "canceled" | "stale" | "failed";
export type ConversationQueueSource = "manual" | "reply_chip" | "suggestion" | "workflow";

export interface ArtifactPeriod {
  start: string | null;
  end: string | null;
  timezone: string;
}

export interface ArtifactSource {
  type: ArtifactSourceType;
  id: string | null;
}

export interface ArtifactLink {
  id: string;
  artifact_id: string;
  target_type: ArtifactLinkTargetType;
  target_id: string;
  relationship: string;
  metadata: Record<string, unknown>;
  created_at: string | null;
}

export interface ArtifactListItem {
  id: string;
  kind: ArtifactKind;
  title: string;
  slug: string | null;
  status: ArtifactStatus;
  summary: string | null;
  preview_text: string | null;
  folder_key: string | null;
  is_pinned: boolean;
  period: ArtifactPeriod;
  source: ArtifactSource;
  conversation_id: string | null;
  created_at: string | null;
  published_at: string | null;
}

export interface ArtifactRevision {
  id: string;
  artifact_id: string;
  version: number;
  editor_type: "system" | "assistant" | "user";
  summary: string | null;
  change_note: string | null;
  created_at: string | null;
}

export interface ArtifactDetail extends ArtifactListItem {
  body: {
    schemaVersion?: number;
    blocks?: Array<Record<string, unknown>>;
  };
  metadata: Record<string, unknown>;
  revision_count: number;
  latest_revision: ArtifactRevision | null;
  links: ArtifactLink[];
}

export interface ArtifactListResponse {
  items: ArtifactListItem[];
  next_cursor: string | null;
}

export interface ArtifactRevisionListResponse {
  items: ArtifactRevision[];
}

export interface ArtifactLinkListResponse {
  items: ArtifactLink[];
}

export interface ActionProfileRules {
  read_scopes: string[];
  write_scopes: string[];
  delivery_scopes: string[];
  approval_policy: Record<string, unknown>;
  budgets: Record<string, unknown>;
  risk_limits: Record<string, unknown>;
}

export interface ActionProfile {
  id: string;
  user_id: string;
  name: string;
  mode: ActionProfileMode;
  is_default: boolean;
  rules: ActionProfileRules;
  created_at: string | null;
  updated_at: string | null;
}

export interface ActionProfileListResponse {
  items: ActionProfile[];
}

export interface WorkflowSchedule {
  timezone: string;
  cadence: string;
  send_hour_local: number;
  send_minute_local: number;
  send_weekdays: number[];
}

export interface WorkflowDelivery {
  channel: "in_app";
  publish: boolean;
  inbox: boolean;
}

export interface WorkflowDefinition {
  id: string;
  kind: WorkflowKind;
  name: string;
  definition_family: WorkflowDefinitionFamily;
  trigger_type: WorkflowTriggerType;
  signal_kind: string | null;
  cooldown_minutes: number;
  quiet_hours: Record<string, unknown>;
  status: WorkflowStatus;
  schedule: WorkflowSchedule;
  delivery: WorkflowDelivery;
  ranking: Record<string, unknown>;
  config: Record<string, unknown>;
  action_profile: ActionProfile;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface WorkflowDefinitionListResponse {
  items: WorkflowDefinition[];
}

export type WorkflowDefinitionCreateInput = {
  kind: WorkflowKind;
  name: string;
  definition_family?: WorkflowDefinitionFamily;
  trigger_type?: WorkflowTriggerType;
  signal_kind?: string | null;
  status?: WorkflowStatus;
  schedule?: WorkflowSchedule;
  config?: Record<string, unknown>;
  ranking?: Record<string, unknown>;
  quiet_hours?: Record<string, unknown>;
  delivery?: WorkflowDelivery;
  cooldown_minutes?: number;
  action_profile_id?: string | null;
};

export type WorkflowDefinitionUpdateInput = Partial<
  Pick<
    WorkflowDefinition,
    | "name"
    | "definition_family"
    | "trigger_type"
    | "signal_kind"
    | "status"
    | "schedule"
    | "config"
    | "ranking"
    | "quiet_hours"
    | "cooldown_minutes"
    | "delivery"
  >
> & {
  action_profile_id?: string | null;
};

export interface ProposedAction {
  action_kind: string;
  capability: string;
  target_ref: string | null;
  payload: Record<string, unknown>;
}

export interface PolicyDecision {
  action_kind: string;
  capability: string;
  outcome: "applied" | "requires_approval" | "rejected";
  reason: string | null;
  approval_request_id: string | null;
  receipt_id: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_definition_id: string;
  status: WorkflowRunStatus;
  trigger_source: WorkflowTriggerSource;
  artifact_id: string | null;
  window_start: string | null;
  window_end: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
  error_json: string | null;
}

export interface WorkflowRunDetail extends WorkflowRun {
  plan: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  artifact: ArtifactListItem | null;
  proposed_actions: ProposedAction[];
  policy_decisions: PolicyDecision[];
  fact_suggestions: AiFact[];
  queue_suggestions: Array<Record<string, unknown>>;
}

export interface WorkflowRunListResponse {
  items: WorkflowRun[];
}

export interface WorkflowRunQueueResponse {
  definition_id: string;
  run: WorkflowRun;
}

export interface ApprovalRequest {
  id: string;
  user_id: string;
  workflow_run_id: string | null;
  action_kind: string;
  capability: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  reason: string | null;
  payload: Record<string, unknown>;
  proposed_action: Record<string, unknown>;
  policy_decision: Record<string, unknown>;
  expires_at: string | null;
  resolved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ApprovalListResponse {
  items: ApprovalRequest[];
}

export interface ReportRecipient {
  email: string;
  label: string;
}

export interface ReportSchedule {
  id: string;
  name: string;
  cadence: "daily" | "weekly" | "monthly";
  status: "draft" | "scheduled" | "paused";
  timezone: string;
  delivery_channel: "email";
  delivery_label: string;
  recipients: ReportRecipient[];
  sections: string[];
  last_sent_at: string | null;
  next_run_at: string | null;
}

export interface ReportScheduleListResponse {
  schedules: ReportSchedule[];
}

export interface ReportRun {
  id: string;
  schedule_id: string;
  cadence: "daily" | "weekly" | "monthly";
  status: ReportRunStatus;
  period_start: string;
  period_end: string;
  subject: string | null;
  artifact_id: string | null;
  generated_at: string | null;
  sent_at: string | null;
  created_at: string | null;
  error_json: string | null;
}

export interface ReportRunListResponse {
  runs: ReportRun[];
}

export interface AiFact {
  id: string;
  user_id: string;
  category: AiFactCategory;
  subject: string;
  predicate: string;
  value: Record<string, unknown>;
  status: AiFactStatus;
  confidence: number;
  source_type: AiFactSourceType;
  source_ref: string | null;
  visibility: AiFactVisibility;
  last_confirmed_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface AiFactEvent {
  id: string;
  fact_id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string | null;
}

export interface AiFactListResponse {
  items: AiFact[];
}

export interface AiFactEventListResponse {
  items: AiFactEvent[];
}

export interface ConversationQueueItem {
  id: string;
  conversation_id: string;
  user_id: string;
  prompt_text: string;
  status: ConversationQueueStatus;
  source: ConversationQueueSource;
  after_message_id: string | null;
  position: number;
  auto_run: boolean;
  error: Record<string, unknown> | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ConversationQueueListResponse {
  items: ConversationQueueItem[];
  auto_run_queued: boolean;
}

export interface ConversationQueueRunResponse {
  item: ConversationQueueItem;
  stale: boolean;
}

export const WORKFLOW_WEEKDAY_OPTIONS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
] as const;
