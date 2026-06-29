import type {
  ActionProfile,
  ArtifactDetail,
  ArtifactKind,
  ArtifactListResponse,
  ReportRun,
  ReportSchedule,
  WorkflowDefinition,
  WorkflowDefinitionListResponse,
  WorkflowRun,
  WorkflowRunListResponse,
  WorkflowRunQueueResponse,
  WorkflowStatus,
} from "@/lib/workflows/types";
import { WORKFLOW_WEEKDAY_OPTIONS } from "@/lib/workflows/types";

export const ARTIFACT_FILTERS: Array<{ key: "all" | ArtifactKind; label: string }> = [
  { key: "all", label: "All" },
  { key: "report", label: "Reports" },
  { key: "morning_brief", label: "Morning Briefs" },
  { key: "shutdown_review", label: "Shutdown Reviews" },
  { key: "notebook", label: "Notebooks" },
  { key: "plan", label: "Plans" },
  { key: "ambient_digest", label: "Ambient" },
];

export const KIND_STYLES: Record<ArtifactKind, string> = {
  report: "bg-[#eef6ff] text-[#1d4ed8] border-[rgba(37,99,235,0.12)]",
  morning_brief: "bg-[rgba(115,191,29,0.12)] text-[#44740d] border-[rgba(115,191,29,0.20)]",
  shutdown_review: "bg-[rgba(15,118,110,0.10)] text-[#0f766e] border-[rgba(15,118,110,0.18)]",
  notebook: "bg-[rgba(249,115,22,0.10)] text-[#c2410c] border-[rgba(249,115,22,0.18)]",
  plan: "bg-[rgba(124,58,237,0.10)] text-[#6d28d9] border-[rgba(124,58,237,0.18)]",
  conversation_brief: "bg-[rgba(14,116,144,0.10)] text-[#155e75] border-[rgba(14,116,144,0.18)]",
  ambient_digest: "bg-[rgba(99,102,241,0.10)] text-[#4338ca] border-[rgba(99,102,241,0.18)]",
};

export const RUN_STATUS_STYLES: Record<string, string> = {
  queued: "bg-[rgba(59,130,246,0.10)] text-[#1d4ed8] border-[rgba(59,130,246,0.18)]",
  processing: "bg-[rgba(14,165,233,0.10)] text-[#0369a1] border-[rgba(14,165,233,0.18)]",
  completed: "bg-[rgba(34,197,94,0.10)] text-[#166534] border-[rgba(34,197,94,0.18)]",
  sent: "bg-[rgba(34,197,94,0.10)] text-[#166534] border-[rgba(34,197,94,0.18)]",
  failed: "bg-[rgba(239,68,68,0.10)] text-[#b91c1c] border-[rgba(239,68,68,0.18)]",
  canceled: "bg-[rgba(107,114,128,0.10)] text-[#4b5563] border-[rgba(107,114,128,0.18)]",
};

export const WORKFLOW_STATUS_STYLES: Record<WorkflowStatus, string> = {
  draft: "bg-[rgba(15,23,42,0.06)] text-[#475569] border-[rgba(15,23,42,0.10)]",
  paused: "bg-[rgba(245,158,11,0.10)] text-[#92400e] border-[rgba(245,158,11,0.18)]",
  scheduled: "bg-[rgba(34,197,94,0.10)] text-[#166534] border-[rgba(34,197,94,0.18)]",
};

export interface UnifiedRunRow {
  id: string;
  sourceType: "report" | "workflow";
  sourceLabel: string;
  status: string;
  windowLabel: string;
  createdAt: string | null;
  artifactId: string | null;
}

export interface WorkflowEditorState {
  id: string;
  name: string;
  action_profile_id: string;
  timezone: string;
  time_value: string;
  send_weekdays: number[];
  config: Record<string, boolean>;
}

export interface EditableArtifactBlock {
  id: string;
  type: string;
  title: string;
  text: string;
  items_text: string;
  intro: string;
  period_label: string;
}

export interface ArtifactEditorState {
  id: string | null;
  kind: ArtifactKind;
  title: string;
  summary: string;
  folder_key: string;
  is_pinned: boolean;
  body_blocks: EditableArtifactBlock[];
  base_version: number;
}

export interface ProjectTimeRollupRow {
  project_key?: string;
  project_name?: string;
  task_key?: string;
  task_name?: string;
  active_ms?: number;
  session_count?: number;
  confidence_avg?: number;
}

export interface ProjectTimeRollupResponse {
  success: boolean;
  data?: ProjectTimeRollupRow[];
  start_date?: string;
  end_date?: string;
  group_by?: string;
  source?: string;
}

export type WorkflowDefinitionPatch = Partial<
  Pick<
    WorkflowDefinition,
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
  action_profile_id?: string;
};

export const EMPTY_BLOCK: EditableArtifactBlock = {
  id: "block-new",
  type: "summary",
  title: "",
  text: "",
  items_text: "",
  intro: "",
  period_label: "",
};

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.detail || payload?.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchArtifactsForReportsSurface(filter: "all" | ArtifactKind): Promise<ArtifactListResponse> {
  return fetchJson<ArtifactListResponse>(`/api/artifacts?limit=40${filter === "all" ? "" : `&kind=${filter}`}`);
}

export async function fetchArtifactLibraryForReportsSurface(): Promise<ArtifactListResponse> {
  return fetchJson<ArtifactListResponse>("/api/artifacts?limit=80");
}

export async function fetchArtifactDetailForReportsSurface(artifactId: string | null): Promise<ArtifactDetail | null> {
  return fetchJson<ArtifactDetail>(`/api/artifacts/${artifactId}`);
}

export async function fetchWorkflowDefinitionsForReportsSurface(): Promise<WorkflowDefinition[]> {
  return (await fetchJson<WorkflowDefinitionListResponse>("/api/workflows/definitions")).items || [];
}

export async function fetchWorkflowRunsForReportsSurface({
  definitionId,
  limit = 12,
}: {
  definitionId?: string | null;
  limit?: number;
} = {}): Promise<WorkflowRun[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (definitionId) params.set("definition_id", definitionId);
  return (await fetchJson<WorkflowRunListResponse>(`/api/workflows/runs?${params.toString()}`)).items || [];
}

export async function runWorkflowForReportsSurface(definitionId: string): Promise<WorkflowRunQueueResponse> {
  return fetchJson<WorkflowRunQueueResponse>(`/api/workflows/definitions/${definitionId}/run`, {
    method: "POST",
  });
}

export async function saveWorkflowDefinitionForReportsSurface({
  definition,
  patch,
}: {
  definition: WorkflowDefinition;
  patch: ReturnType<typeof buildDefinitionPayload>;
}): Promise<WorkflowDefinition> {
  return fetchJson<WorkflowDefinition>(`/api/workflows/definitions/${definition.id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function patchWorkflowDefinitionForReportsSurface(
  definition: WorkflowDefinition,
  patch: WorkflowDefinitionPatch,
): Promise<WorkflowDefinition> {
  return fetchJson<WorkflowDefinition>(`/api/workflows/definitions/${definition.id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function saveArtifactForReportsSurface({
  artifactEditor,
  selectedArtifact,
}: {
  artifactEditor: ArtifactEditorState;
  selectedArtifact?: ArtifactDetail | null;
}): Promise<ArtifactDetail> {
  const body = {
    kind: artifactEditor.kind,
    title: artifactEditor.title,
    status: "published" as const,
    summary: artifactEditor.summary,
    folder_key: artifactEditor.folder_key || null,
    is_pinned: artifactEditor.is_pinned,
    preview_text: artifactEditor.summary,
    body: buildArtifactBodyFromEditor(artifactEditor.body_blocks),
    period: { start: null, end: null, timezone: "America/New_York" },
    metadata: { edited_from: "reports_surface" },
    source: {
      type: artifactEditor.id ? selectedArtifact?.source.type || "manual" : "manual",
      id: artifactEditor.id ? selectedArtifact?.source.id || null : null,
    },
  };

  if (artifactEditor.id) {
    return fetchJson<ArtifactDetail>(`/api/artifacts/${artifactEditor.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...body, base_version: artifactEditor.base_version }),
    });
  }
  return fetchJson<ArtifactDetail>("/api/artifacts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function formatKind(kind: ArtifactKind): string {
  if (kind === "morning_brief") return "Morning Brief";
  if (kind === "shutdown_review") return "Shutdown Review";
  if (kind === "notebook") return "Notebook";
  if (kind === "plan") return "Plan";
  if (kind === "conversation_brief") return "Conversation Brief";
  if (kind === "ambient_digest") return "Ambient Digest";
  return "Report";
}

export function buildEditableBlocks(body: ArtifactDetail["body"] | undefined): EditableArtifactBlock[] {
  const blocks = Array.isArray(body?.blocks) ? body?.blocks : [];
  const mapped = blocks.map((block, index) => {
    const record = (block || {}) as Record<string, unknown>;
    const items = Array.isArray(record.items) ? record.items : [];
    return {
      id: `block-${index}`,
      type: String(record.type || "summary"),
      title: String(record.title || ""),
      text: String(record.text || ""),
      items_text: items
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const candidate = item as Record<string, unknown>;
            const label = String(candidate.label || "");
            const value = String(candidate.value || "");
            const note = String(candidate.note || "");
            return [label, value, note].filter(Boolean).join(" | ");
          }
          return "";
        })
        .filter(Boolean)
        .join("\n"),
      intro: String(record.intro || ""),
      period_label: String(record.periodLabel || ""),
    } satisfies EditableArtifactBlock;
  });
  return mapped.length ? mapped : [{ id: "block-0", type: "summary", title: "", text: "", items_text: "", intro: "", period_label: "" }];
}

export function buildArtifactBodyFromEditor(blocks: EditableArtifactBlock[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    blocks: blocks.map((block) => {
      if (block.type === "hero") {
        return {
          type: "hero",
          title: block.title,
          periodLabel: block.period_label,
          intro: block.intro,
        };
      }
      if (block.type === "bullet_list") {
        return {
          type: "bullet_list",
          title: block.title,
          items: block.items_text
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
        };
      }
      if (block.type === "metric_list") {
        return {
          type: "metric_list",
          items: block.items_text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const [label = "", value = "", note = ""] = line.split("|").map((item) => item.trim());
              return { label, value, note };
            }),
        };
      }
      return {
        type: "summary",
        text: block.text,
      };
    }),
  };
}

export function buildArtifactEditorState(kind: ArtifactKind, artifact?: ArtifactDetail | null): ArtifactEditorState {
  return {
    id: artifact?.id || null,
    kind: artifact?.kind || kind,
    title: artifact?.title || "",
    summary: artifact?.summary || "",
    folder_key: artifact?.folder_key || "",
    is_pinned: artifact?.is_pinned || false,
    body_blocks: buildEditableBlocks(artifact?.body),
    base_version: artifact?.revision_count || 0,
  };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function toLocalYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildDefaultProjectTimeRange(now = new Date()): { start: string; end: string } {
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(end.getDate() - 29);
  return { start: toLocalYmd(start), end: toLocalYmd(end) };
}

export function formatLocalClock(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

export function formatProjectDuration(ms: number | null | undefined): string {
  const minutes = Math.round(Number(ms || 0) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatTime(hour: number, minute: number): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatPeriod(period: { start: string | null; end: string | null }): string {
  if (!period.start && !period.end) return "No period";
  if (period.start && period.end && period.start !== period.end) {
    const start = new Date(`${period.start}T00:00:00`);
    const end = new Date(`${period.end}T00:00:00`);
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  const day = period.start || period.end || "";
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatWindowFromWorkflowRun(run: WorkflowRun): string {
  if (!run.window_start || !run.window_end) return "Window pending";
  const start = new Date(run.window_start);
  const end = new Date(run.window_end);
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

export function formatWindowFromReportRun(run: ReportRun): string {
  const start = new Date(`${run.period_start}T00:00:00`);
  const end = new Date(`${run.period_end}T00:00:00`);
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

export function buildUnifiedRuns(
  reportRuns: ReportRun[],
  reportSchedules: ReportSchedule[],
  workflowDefinitions: WorkflowDefinition[],
  workflowRuns: WorkflowRun[],
): UnifiedRunRow[] {
  const reportSchedulesById = new Map(reportSchedules.map((item) => [item.id, item]));
  const workflowsById = new Map(workflowDefinitions.map((item) => [item.id, item]));

  const rows: UnifiedRunRow[] = [
    ...reportRuns.map((run) => ({
      id: run.id,
      sourceType: "report" as const,
      sourceLabel: reportSchedulesById.get(run.schedule_id)?.name || "Scheduled Report",
      status: run.status,
      windowLabel: formatWindowFromReportRun(run),
      createdAt: run.created_at,
      artifactId: run.artifact_id,
    })),
    ...workflowRuns.map((run) => ({
      id: run.id,
      sourceType: "workflow" as const,
      sourceLabel: workflowsById.get(run.workflow_definition_id)?.name || "Workflow",
      status: run.status,
      windowLabel: formatWindowFromWorkflowRun(run),
      createdAt: run.created_at,
      artifactId: run.artifact_id,
    })),
  ];

  return rows.sort((left, right) => {
    const leftValue = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightValue = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return rightValue - leftValue;
  });
}

export function formatScheduleSummary(definition: WorkflowDefinition): string {
  const weekdays = definition.schedule.send_weekdays.length
    ? WORKFLOW_WEEKDAY_OPTIONS.filter((day) => definition.schedule.send_weekdays.includes(day.value)).map((day) => day.label).join(", ")
    : "Every day";
  return `${weekdays} at ${formatTime(definition.schedule.send_hour_local, definition.schedule.send_minute_local)}`;
}

export function toEditorState(definition: WorkflowDefinition): WorkflowEditorState {
  return {
    id: definition.id,
    name: definition.name,
    action_profile_id: definition.action_profile.id,
    timezone: definition.schedule.timezone,
    time_value: `${String(definition.schedule.send_hour_local).padStart(2, "0")}:${String(definition.schedule.send_minute_local).padStart(2, "0")}`,
    send_weekdays: [...definition.schedule.send_weekdays],
    config: Object.fromEntries(
      Object.entries(definition.config).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    ),
  };
}

export function buildDefinitionPayload(editor: WorkflowEditorState, status: WorkflowStatus) {
  const [hourText, minuteText] = editor.time_value.split(":");
  const sendHour = Number(hourText || 0);
  const sendMinute = Number(minuteText || 0);
  return {
    status,
    action_profile_id: editor.action_profile_id,
    schedule: {
      timezone: editor.timezone,
      cadence: "daily",
      send_hour_local: Number.isFinite(sendHour) ? sendHour : 8,
      send_minute_local: Number.isFinite(sendMinute) ? sendMinute : 0,
      send_weekdays: [...editor.send_weekdays].sort((left, right) => left - right),
    },
    config: editor.config,
  };
}

export function isProfileSchedulable(profile: ActionProfile | undefined): boolean {
  return profile?.mode === "draft";
}
