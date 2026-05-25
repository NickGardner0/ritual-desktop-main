"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  Clock3,
  FilePenLine,
  FileStack,
  Loader2,
  MemoryStick,
  NotebookPen,
  Play,
  Shield,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";

import { ArtifactBody } from "@/components/ritual-intelligence/artifact-body";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QUERY_POLICY } from "@/lib/query-policies";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import type {
  ActionProfile,
  ActionProfileListResponse,
  ApprovalListResponse,
  AiFact,
  AiFactListResponse,
  ArtifactDetail,
  ArtifactKind,
  ArtifactLink,
  ArtifactListResponse,
  ConversationQueueItem,
  ReportRun,
  ReportRunListResponse,
  ReportSchedule,
  ReportScheduleListResponse,
  WorkflowDefinition,
  WorkflowDefinitionFamily,
  WorkflowDefinitionListResponse,
  WorkflowRun,
  WorkflowRunListResponse,
  WorkflowRunQueueResponse,
  WorkflowStatus,
} from "@/lib/workflows/types";
import { WORKFLOW_WEEKDAY_OPTIONS } from "@/lib/workflows/types";
import { cn } from "@/lib/utils";

import {
  ARTIFACT_FILTERS,
  EMPTY_BLOCK,
  KIND_STYLES,
  RUN_STATUS_STYLES,
  WORKFLOW_STATUS_STYLES,
  buildArtifactBodyFromEditor,
  buildArtifactEditorState,
  buildDefinitionPayload,
  buildDefaultProjectTimeRange,
  buildUnifiedRuns,
  fetchJson,
  formatDateTime,
  formatKind,
  formatLocalClock,
  formatPeriod,
  formatProjectDuration,
  formatScheduleSummary,
  isProfileSchedulable,
  toEditorState,
  type ArtifactEditorState,
  type ProjectTimeRollupResponse,
  type WorkflowEditorState,
} from "./reports-client.helpers";

export function ReportsClient() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const routinesSectionRef = useRef<HTMLElement | null>(null);
  const ambientSectionRef = useRef<HTMLElement | null>(null);
  const artifactsSectionRef = useRef<HTMLDivElement | null>(null);

  const [filter, setFilter] = useState<"all" | ArtifactKind>("all");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(searchParams.get("artifactId"));
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(searchParams.get("definitionId"));
  const [isWorkflowEditorOpen, setIsWorkflowEditorOpen] = useState(false);
  const [isApprovalsOpen, setIsApprovalsOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(searchParams.get("memory") === "1");
  const [isArtifactEditorOpen, setIsArtifactEditorOpen] = useState(false);
  const [editor, setEditor] = useState<WorkflowEditorState | null>(null);
  const [artifactEditor, setArtifactEditor] = useState<ArtifactEditorState | null>(null);
  const projectTimeRange = useMemo(() => buildDefaultProjectTimeRange(), []);

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", filter],
    queryFn: () => fetchJson<ArtifactListResponse>(`/api/artifacts?limit=40${filter === "all" ? "" : `&kind=${filter}`}`),
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const artifactLibraryQuery = useQuery({
    queryKey: ["artifacts-library"],
    queryFn: () => fetchJson<ArtifactListResponse>("/api/artifacts?limit=80"),
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const artifactDetailQuery = useQuery({
    queryKey: ["artifact-detail", selectedArtifactId],
    queryFn: () => fetchJson<ArtifactDetail>(`/api/artifacts/${selectedArtifactId}`),
    enabled: Boolean(selectedArtifactId),
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const reportSchedulesQuery = useQuery({
    queryKey: ["report-schedules"],
    queryFn: async () => (await fetchJson<ReportScheduleListResponse>("/api/reports/schedules")).schedules || [],
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const reportRunsQuery = useQuery({
    queryKey: ["report-runs"],
    queryFn: async () => (await fetchJson<ReportRunListResponse>("/api/reports/runs?limit=8")).runs || [],
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const workflowDefinitionsQuery = useQuery({
    queryKey: ["workflow-definitions"],
    queryFn: async () => (await fetchJson<WorkflowDefinitionListResponse>("/api/workflows/definitions")).items || [],
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const actionProfilesQuery = useQuery({
    queryKey: ["action-profiles"],
    queryFn: async () => (await fetchJson<ActionProfileListResponse>("/api/action-profiles")).items || [],
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const factsQuery = useQuery({
    queryKey: ["ai-facts"],
    queryFn: async () => (await fetchJson<AiFactListResponse>("/api/ai-facts")).items || [],
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const approvalsQuery = useQuery({
    queryKey: ["approvals"],
    queryFn: async () => (await fetchJson<ApprovalListResponse>("/api/approvals")).items || [],
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const workflowRunsQuery = useQuery({
    queryKey: ["workflow-runs", "reports-surface"],
    queryFn: async () => (await fetchJson<WorkflowRunListResponse>("/api/workflows/runs?limit=12")).items || [],
    staleTime: QUERY_POLICY.general.staleTime,
    refetchInterval: 5_000,
  });

  const projectTimeQuery = useQuery({
    queryKey: ["project-time-rollups", "reports", projectTimeRange.start, projectTimeRange.end],
    queryFn: () => fetchJson<ProjectTimeRollupResponse>(
      `/api/watcher/project-time/rollups?start_date=${projectTimeRange.start}&end_date=${projectTimeRange.end}&group_by=project&limit=8`,
    ),
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const workflowDefinitions = workflowDefinitionsQuery.data || [];
  const routineDefinitions = workflowDefinitions.filter((item) => item.definition_family === "routine");
  const ambientDefinitions = workflowDefinitions.filter((item) => item.definition_family === "ambient");
  const selectedDefinition = useMemo(
    () => workflowDefinitions.find((item) => item.id === selectedDefinitionId) || routineDefinitions[0] || ambientDefinitions[0] || null,
    [ambientDefinitions, routineDefinitions, selectedDefinitionId, workflowDefinitions],
  );

  const selectedWorkflowRunsQuery = useQuery({
    queryKey: ["workflow-runs", selectedDefinition?.id, "detail-surface"],
    queryFn: async () => {
      if (!selectedDefinition) return [] as WorkflowRun[];
      return (await fetchJson<WorkflowRunListResponse>(`/api/workflows/runs?definition_id=${selectedDefinition.id}&limit=12`)).items || [];
    },
    enabled: Boolean(selectedDefinition),
    staleTime: QUERY_POLICY.general.staleTime,
    refetchInterval: 5_000,
  });

  const latestWorkflowArtifactId = (selectedWorkflowRunsQuery.data || []).find((run) => run.artifact_id)?.artifact_id || null;
  const latestWorkflowArtifactQuery = useQuery({
    queryKey: ["artifact-detail", latestWorkflowArtifactId, "workflow-latest"],
    queryFn: () => fetchJson<ArtifactDetail>(`/api/artifacts/${latestWorkflowArtifactId}`),
    enabled: Boolean(latestWorkflowArtifactId),
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const runWorkflowMutation = useMutation({
    mutationFn: async (definitionId: string) => {
      return fetchJson<WorkflowRunQueueResponse>(`/api/workflows/definitions/${definitionId}/run`, {
        method: "POST",
      });
    },
    onSuccess: (_, definitionId) => {
      const definitionName = workflowDefinitions.find((item) => item.id === definitionId)?.name || "Workflow";
      toast.success(`${definitionName} queued.`);
      void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
      void queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      void queryClient.invalidateQueries({ queryKey: ["artifact-detail"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to queue workflow.");
    },
  });

  const saveWorkflowMutation = useMutation({
    mutationFn: async ({ status }: { status: WorkflowStatus }) => {
      if (!editor) throw new Error("No workflow selected for editing.");
      return fetchJson<WorkflowDefinition>(`/api/workflows/definitions/${editor.id}`, {
        method: "PATCH",
        body: JSON.stringify(buildDefinitionPayload(editor, status)),
      });
    },
    onSuccess: () => {
      toast.success("Workflow updated.");
      setIsWorkflowEditorOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update workflow.");
    },
  });

  const artifactEditorMutation = useMutation({
    mutationFn: async () => {
      if (!artifactEditor) throw new Error("No artifact editor state available.");
      const body = {
        kind: artifactEditor.kind,
        title: artifactEditor.title,
        status: "published",
        summary: artifactEditor.summary,
        folder_key: artifactEditor.folder_key || null,
        is_pinned: artifactEditor.is_pinned,
        preview_text: artifactEditor.summary,
        body: buildArtifactBodyFromEditor(artifactEditor.body_blocks),
        period: { start: null, end: null, timezone: "America/New_York" },
        metadata: { edited_from: "reports_surface" },
        source: { type: artifactEditor.id ? selectedArtifact?.source.type || "manual" : "manual", id: artifactEditor.id ? selectedArtifact?.source.id || null : null },
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
    },
    onSuccess: (artifact) => {
      toast.success(`${formatKind(artifact.kind)} saved.`);
      setIsArtifactEditorOpen(false);
      setSelectedArtifactId(artifact.id);
      void queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      void queryClient.invalidateQueries({ queryKey: ["artifacts-library"] });
      void queryClient.invalidateQueries({ queryKey: ["artifact-detail"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save artifact.");
    },
  });

  const factApproveMutation = useMutation({
    mutationFn: async (factId: string) => fetchJson<AiFact>(`/api/ai-facts/${factId}/approve`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Fact approved.");
      void queryClient.invalidateQueries({ queryKey: ["ai-facts"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to approve fact.");
    },
  });

  const factDismissMutation = useMutation({
    mutationFn: async (factId: string) => fetchJson<AiFact>(`/api/ai-facts/${factId}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Fact dismissed.");
      void queryClient.invalidateQueries({ queryKey: ["ai-facts"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to dismiss fact.");
    },
  });

  const convertAmbientMutation = useMutation({
    mutationFn: async (definition: WorkflowDefinition) => {
      return fetchJson<WorkflowDefinition>(`/api/workflows/definitions/${definition.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          definition_family: "routine",
          trigger_type: "schedule",
          signal_kind: null,
          status: "draft",
          action_profile_id: definition.action_profile.id,
          schedule: definition.schedule,
          config: definition.config,
          ranking: definition.ranking,
          quiet_hours: definition.quiet_hours,
          cooldown_minutes: definition.cooldown_minutes,
          delivery: definition.delivery,
        }),
      });
    },
    onSuccess: (definition) => {
      toast.success(`${definition.name} converted to a routine draft.`);
      setSelectedDefinitionId(definition.id);
      void queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to convert ambient agent.");
    },
  });

  const snoozeAmbientMutation = useMutation({
    mutationFn: async (definition: WorkflowDefinition) => {
      const now = new Date();
      const end = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      return fetchJson<WorkflowDefinition>(`/api/workflows/definitions/${definition.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quiet_hours: { start: formatLocalClock(now), end: formatLocalClock(end) },
        }),
      });
    },
    onSuccess: () => {
      toast.success("Ambient agent snoozed for 4 hours.");
      void queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to snooze ambient agent.");
    },
  });

  const dismissAmbientMutation = useMutation({
    mutationFn: async (definition: WorkflowDefinition) => {
      return fetchJson<WorkflowDefinition>(`/api/workflows/definitions/${definition.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "paused" }),
      });
    },
    onSuccess: () => {
      toast.success("Ambient agent paused.");
      void queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to pause ambient agent.");
    },
  });

  const artifacts = artifactsQuery.data?.items || [];
  const artifactLibrary = artifactLibraryQuery.data?.items || [];
  const reportSchedules = reportSchedulesQuery.data || [];
  const reportRuns = reportRunsQuery.data || [];
  const workflowRuns = workflowRunsQuery.data || [];
  const actionProfiles = actionProfilesQuery.data || [];
  const approvals = approvalsQuery.data || [];
  const facts = factsQuery.data || [];
  const selectedProfile = actionProfiles.find((profile) => profile.id === editor?.action_profile_id);
  const selectedArtifact = artifactDetailQuery.data;
  const latestWorkflowArtifact = latestWorkflowArtifactQuery.data;
  const notebookArtifacts = artifactLibrary.filter((item) => item.kind === "notebook" || item.kind === "plan" || item.kind === "conversation_brief");
  const ambientArtifacts = artifactLibrary.filter((item) => item.kind === "ambient_digest");
  const activeFacts = facts.filter((fact) => fact.status === "active");
  const pendingFacts = facts.filter((fact) => fact.status === "pending");
  const projectTimeRows = projectTimeQuery.data?.data || [];
  const projectTimeTotalMs = projectTimeRows.reduce((sum, row) => sum + Number(row.active_ms || 0), 0);

  useEffect(() => {
    const artifactIdFromUrl = searchParams.get("artifactId");
    if (artifactIdFromUrl) {
      setSelectedArtifactId(artifactIdFromUrl);
      return;
    }
    if (!selectedArtifactId && artifacts.length) {
      setSelectedArtifactId(artifacts[0].id);
      return;
    }
    if (selectedArtifactId && artifacts.length && !artifacts.some((item) => item.id === selectedArtifactId)) {
      setSelectedArtifactId(artifacts[0].id);
    }
  }, [artifacts, searchParams, selectedArtifactId]);

  useEffect(() => {
    const definitionIdFromUrl = searchParams.get("definitionId");
    if (definitionIdFromUrl) {
      setSelectedDefinitionId(definitionIdFromUrl);
      return;
    }
    if (!selectedDefinitionId && workflowDefinitions.length) {
      setSelectedDefinitionId(routineDefinitions[0]?.id || ambientDefinitions[0]?.id || workflowDefinitions[0].id);
      return;
    }
    if (selectedDefinitionId && workflowDefinitions.length && !workflowDefinitions.some((item) => item.id === selectedDefinitionId)) {
      setSelectedDefinitionId(routineDefinitions[0]?.id || ambientDefinitions[0]?.id || workflowDefinitions[0].id);
    }
  }, [ambientDefinitions, routineDefinitions, searchParams, selectedDefinitionId, workflowDefinitions]);

  useEffect(() => {
    if (searchParams.get("memory") === "1") {
      setIsMemoryOpen(true);
    }
  }, [searchParams]);

  const unifiedRuns = useMemo(
    () => buildUnifiedRuns(reportRuns, reportSchedules, workflowDefinitions, workflowRuns),
    [reportRuns, reportSchedules, workflowDefinitions, workflowRuns],
  );

  const openArtifact = (artifactId: string) => {
    setFilter("all");
    setSelectedArtifactId(artifactId);
    artifactsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToRoutines = () => {
    routinesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToAmbient = () => {
    ambientSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const startArtifactEditor = (kind: ArtifactKind, artifact?: ArtifactDetail | null) => {
    setArtifactEditor(buildArtifactEditorState(kind, artifact));
    setIsArtifactEditorOpen(true);
  };

  const isLoading = artifactsQuery.isLoading || workflowDefinitionsQuery.isLoading;

  return (
    <>
      <div className="space-y-6">
        <section className="rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/82 px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-[700] uppercase tracking-[0.22em] text-[#6b7280]">Ritual Intelligence</div>
              <h1 className="mt-2 text-[34px] font-[650] tracking-[-0.04em] text-[#111827]">Artifacts, routines, and run history</h1>
              <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#4b5563]">
                Durable reports, workflow outputs, approval state, and the execution history behind them now live on one page.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                className="bg-[#111827] text-white hover:bg-[#1f2937]"
                onClick={() => {
                  const morningBrief = workflowDefinitions.find((item) => item.kind === "morning_brief");
                  if (morningBrief) runWorkflowMutation.mutate(morningBrief.id);
                }}
                disabled={!workflowDefinitions.some((item) => item.kind === "morning_brief") || runWorkflowMutation.isPending}
              >
                {runWorkflowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Morning Brief
              </Button>
              <Button variant="outline" onClick={scrollToRoutines}>
                <CalendarRange className="h-4 w-4" />
                Open routines
              </Button>
              <Button variant="outline" onClick={scrollToAmbient}>
                <BellRing className="h-4 w-4" />
                Ambient inbox
              </Button>
              <Button variant="outline" onClick={() => startArtifactEditor("notebook")}>
                <NotebookPen className="h-4 w-4" />
                New notebook
              </Button>
              <Button variant="outline" onClick={() => setIsMemoryOpen(true)}>
                <MemoryStick className="h-4 w-4" />
                {pendingFacts.length} pending facts
              </Button>
              <Button variant="outline" onClick={() => setIsApprovalsOpen(true)}>
                <Shield className="h-4 w-4" />
                {approvals.length} approvals
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">
                <Clock3 className="h-5 w-5" />
                Project time
              </div>
              <p className="mt-1 text-sm text-[#6b7280]">
                Last 30 days, grouped from local activity attribution.
              </p>
            </div>
            <div className="rounded-full border border-[rgba(15,23,42,0.10)] bg-white px-4 py-2 text-sm font-[650] text-[#111827]">
              {formatProjectDuration(projectTimeTotalMs)}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {projectTimeQuery.isLoading ? (
              [0, 1, 2].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-[22px] bg-[#f5f7f5]" />
              ))
            ) : projectTimeRows.length ? (
              projectTimeRows.map((row) => {
                const activeMs = Number(row.active_ms || 0);
                const share = projectTimeTotalMs > 0 ? Math.max(3, Math.round((activeMs / projectTimeTotalMs) * 100)) : 0;
                return (
                  <div key={`${row.project_key || row.project_name || "unknown"}`} className="rounded-[22px] border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-[650] text-[#111827]">{row.project_name || "Unclassified"}</div>
                        <div className="mt-1 text-xs text-[#6b7280]">
                          {Number(row.session_count || 0)} session{Number(row.session_count || 0) === 1 ? "" : "s"}
                          {Number(row.confidence_avg || 0) > 0 ? ` · ${Math.round(Number(row.confidence_avg || 0) * 100)}% confidence` : ""}
                        </div>
                      </div>
                      <div className="text-sm font-[650] text-[#111827]">{formatProjectDuration(activeMs)}</div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf1ed]">
                      <div className="h-full rounded-full bg-[#73bf1d]" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[22px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-5 py-7 text-sm text-[#6b7280]">
                No project-time rollups yet. Keep using the desktop app and the local attribution worker will populate this section.
              </div>
            )}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          {ARTIFACT_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-[600] transition",
                filter === item.key
                  ? "border-[#111827] bg-[#111827] text-white"
                  : "border-[rgba(15,23,42,0.10)] bg-white/80 text-[#4b5563] hover:border-[rgba(15,23,42,0.18)] hover:text-[#111827]",
              )}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div ref={artifactsSectionRef} className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-[30px] border border-[rgba(15,23,42,0.08)] bg-white/82 p-4 shadow-[0_16px_50px_rgba(15,23,42,0.04)]">
            <div className="mb-3 flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-sm font-[650] text-[#111827]">
                <FileStack className="h-4 w-4" />
                Artifact inbox
              </div>
              <div className="text-xs text-[#6b7280]">{artifacts.length} items</div>
            </div>
            {isLoading ? (
              <div className="space-y-3 p-2">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-24 animate-pulse rounded-3xl bg-[#f5f7f5]" />
                ))}
              </div>
            ) : artifacts.length ? (
              <div className="max-h-[700px] space-y-3 overflow-auto pr-1">
                {artifacts.map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => setSelectedArtifactId(artifact.id)}
                    className={cn(
                      "w-full rounded-[26px] border px-4 py-4 text-left transition",
                      selectedArtifactId === artifact.id
                        ? "border-[#111827] bg-[#f7faf7] shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
                        : "border-[rgba(15,23,42,0.08)] bg-white hover:border-[rgba(15,23,42,0.16)] hover:bg-[#fbfcfb]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.12em]", KIND_STYLES[artifact.kind])}>
                        {formatKind(artifact.kind)}
                      </span>
                      <span className="text-xs text-[#6b7280]">{formatDateTime(artifact.published_at || artifact.created_at)}</span>
                    </div>
                    <div className="mt-3 text-[17px] font-[620] tracking-[-0.02em] text-[#111827]">{artifact.title}</div>
                    <div className="mt-2 line-clamp-3 text-sm leading-6 text-[#4b5563]">{artifact.summary || "No summary yet."}</div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-[#6b7280]">
                      <CalendarRange className="h-3.5 w-3.5" />
                      {formatPeriod(artifact.period)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-[26px] border border-dashed border-[rgba(15,23,42,0.14)] bg-[#fbfcfb] px-5 py-8 text-center">
                <Sparkles className="mx-auto h-8 w-8 text-[#73bf1d]" />
                <div className="mt-3 text-[18px] font-[620] text-[#111827]">No artifacts yet</div>
                <p className="mt-2 text-sm leading-6 text-[#6b7280]">
                  Run Morning Brief or configure a routine below to start publishing durable Ritual outputs.
                </p>
                <div className="mt-5 flex flex-col gap-2">
                  <Button
                    className="bg-[#111827] text-white hover:bg-[#1f2937]"
                    onClick={() => {
                      const morningBrief = workflowDefinitions.find((item) => item.kind === "morning_brief");
                      if (morningBrief) runWorkflowMutation.mutate(morningBrief.id);
                    }}
                    disabled={!workflowDefinitions.some((item) => item.kind === "morning_brief") || runWorkflowMutation.isPending}
                  >
                    Run Morning Brief
                  </Button>
                  <Button variant="outline" onClick={scrollToRoutines}>
                    Open routines
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
            {artifactDetailQuery.isLoading ? (
              <div className="h-[640px] animate-pulse rounded-[28px] bg-[#f5f7f5]" />
            ) : selectedArtifact ? (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.12em]", KIND_STYLES[selectedArtifact.kind])}>
                      {formatKind(selectedArtifact.kind)}
                    </span>
                    <div className="text-sm text-[#6b7280]">{formatPeriod(selectedArtifact.period)}</div>
                    <div className="text-sm text-[#6b7280]">{selectedArtifact.revision_count} revision{selectedArtifact.revision_count === 1 ? "" : "s"}</div>
                    {selectedArtifact.latest_revision?.created_at ? (
                      <div className="text-sm text-[#6b7280]">Updated {formatDateTime(selectedArtifact.latest_revision.created_at)}</div>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => startArtifactEditor(selectedArtifact.kind, selectedArtifact)}>
                      <FilePenLine className="h-4 w-4" />
                      Edit
                    </Button>
                    <Button variant="outline" onClick={() => setIsMemoryOpen(true)}>
                      <MemoryStick className="h-4 w-4" />
                      Memory
                    </Button>
                  </div>
                </div>
                <ArtifactBody body={selectedArtifact.body} />
              </>
            ) : (
              <div className="flex h-[640px] items-center justify-center rounded-[28px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] text-center">
                <div>
                  <Clock3 className="mx-auto h-8 w-8 text-[#9ca3af]" />
                  <div className="mt-3 text-[18px] font-[620] text-[#111827]">Select an artifact</div>
                  <p className="mt-2 text-sm text-[#6b7280]">Choose an item from the inbox to inspect its structured output.</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">Notebooks and plans</div>
              <p className="mt-1 text-sm text-[#6b7280]">Conversation briefs, plans, and notebooks live in the same artifact system as reports.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => startArtifactEditor("plan")}>
                <WandSparkles className="h-4 w-4" />
                New plan
              </Button>
              <Button variant="outline" onClick={() => startArtifactEditor("notebook")}>
                <BookOpen className="h-4 w-4" />
                New notebook
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {notebookArtifacts.length ? notebookArtifacts.slice(0, 9).map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => openArtifact(artifact.id)}
                className="rounded-[26px] border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4 text-left transition hover:border-[rgba(15,23,42,0.16)] hover:bg-[#fbfcfb]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.12em]", KIND_STYLES[artifact.kind])}>
                    {formatKind(artifact.kind)}
                  </span>
                  <span className="text-xs text-[#6b7280]">{artifact.folder_key || "general"}</span>
                </div>
                <div className="mt-3 text-[17px] font-[620] tracking-[-0.02em] text-[#111827]">{artifact.title}</div>
                <div className="mt-2 line-clamp-3 text-sm leading-6 text-[#4b5563]">{artifact.summary || artifact.preview_text || "No summary yet."}</div>
              </button>
            )) : (
              <div className="rounded-[26px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-5 py-8 text-center text-sm text-[#6b7280] md:col-span-2 xl:col-span-3">
                No notebooks or plans yet.
              </div>
            )}
          </div>
        </section>

        <section ref={ambientSectionRef} className="rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">Ambient inbox</div>
              <p className="mt-1 text-sm text-[#6b7280]">Signal-driven digests share the same workflow engine, approvals, and artifact pipeline as routines.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              {ambientDefinitions.length ? ambientDefinitions.map((definition) => (
                <div key={definition.id} className="rounded-[28px] border border-[rgba(15,23,42,0.08)] bg-white px-5 py-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.12em]", WORKFLOW_STATUS_STYLES[definition.status])}>
                          {definition.status}
                        </span>
                        <span className="text-xs uppercase tracking-[0.12em] text-[#6b7280]">{definition.signal_kind || "signal"}</span>
                      </div>
                      <div className="mt-3 text-[22px] font-[620] tracking-[-0.03em] text-[#111827]">{definition.name}</div>
                      <div className="mt-2 text-sm leading-6 text-[#4b5563]">
                        Quiet hours: {(definition.quiet_hours.start as string | undefined) || "none"} to {(definition.quiet_hours.end as string | undefined) || "none"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => runWorkflowMutation.mutate(definition.id)} disabled={runWorkflowMutation.isPending}>
                        <Play className="h-4 w-4" />
                        Run now
                      </Button>
                      <Button variant="outline" onClick={() => snoozeAmbientMutation.mutate(definition)} disabled={snoozeAmbientMutation.isPending}>
                        Snooze 4h
                      </Button>
                      <Button variant="outline" onClick={() => dismissAmbientMutation.mutate(definition)} disabled={dismissAmbientMutation.isPending}>
                        Dismiss
                      </Button>
                      <Button variant="outline" onClick={() => convertAmbientMutation.mutate(definition)} disabled={convertAmbientMutation.isPending}>
                        Convert to routine
                      </Button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-[24px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-4 py-8 text-center text-sm text-[#6b7280]">
                  No ambient agents seeded yet.
                </div>
              )}
            </div>
            <div className="rounded-[30px] border border-[rgba(15,23,42,0.08)] bg-white/84 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-2 text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">
                <BellRing className="h-5 w-5" />
                Latest ambient digests
              </div>
              <div className="mt-4 space-y-3">
                {ambientArtifacts.length ? ambientArtifacts.slice(0, 4).map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => openArtifact(artifact.id)}
                    className="w-full rounded-[22px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] px-4 py-4 text-left"
                  >
                    <div className="text-sm font-[600] text-[#111827]">{artifact.title}</div>
                    <div className="mt-1 text-sm leading-6 text-[#4b5563]">{artifact.summary || artifact.preview_text || "No summary yet."}</div>
                  </button>
                )) : (
                  <div className="rounded-[24px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-4 py-8 text-center text-sm text-[#6b7280]">
                    No ambient digests yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section ref={routinesSectionRef} className="rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">Routines</div>
              <p className="mt-1 text-sm text-[#6b7280]">Configure Morning Brief and Shutdown Review without leaving the reports surface.</p>
            </div>
            <Button variant="outline" onClick={() => setIsApprovalsOpen(true)}>
              <Shield className="h-4 w-4" />
              {approvals.length} pending approvals
            </Button>
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4">
              {routineDefinitions.map((definition) => {
                const isSelected = selectedDefinition?.id === definition.id;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => setSelectedDefinitionId(definition.id)}
                    className={cn(
                      "w-full rounded-[30px] border bg-white/84 p-5 text-left shadow-[0_16px_50px_rgba(15,23,42,0.04)] transition",
                      isSelected
                        ? "border-[#111827]"
                        : "border-[rgba(15,23,42,0.08)] hover:border-[rgba(15,23,42,0.16)]",
                    )}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.12em]", WORKFLOW_STATUS_STYLES[definition.status])}>
                            {definition.status}
                          </span>
                          <span className="text-xs uppercase tracking-[0.12em] text-[#6b7280]">{definition.kind.replace(/_/g, " ")}</span>
                        </div>
                        <div className="mt-3 text-[22px] font-[620] tracking-[-0.03em] text-[#111827]">{definition.name}</div>
                        <div className="mt-2 text-sm leading-6 text-[#4b5563]">{formatScheduleSummary(definition)}</div>
                        <div className="mt-3 flex flex-wrap gap-4 text-sm text-[#6b7280]">
                          <span>Profile: {definition.action_profile.name}</span>
                          <span>Last run: {formatDateTime(definition.last_run_at)}</span>
                          <span>Next run: {formatDateTime(definition.next_run_at)}</span>
                        </div>
                        {definition.last_error ? (
                          <div className="mt-3 rounded-2xl border border-[rgba(239,68,68,0.16)] bg-[rgba(239,68,68,0.06)] px-3 py-2 text-sm text-[#b91c1c]">
                            {definition.last_error}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          className="bg-[#111827] text-white hover:bg-[#1f2937]"
                          onClick={(event) => {
                            event.stopPropagation();
                            runWorkflowMutation.mutate(definition.id);
                          }}
                          disabled={runWorkflowMutation.isPending}
                        >
                          {runWorkflowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          Run now
                        </Button>
                        <Button
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditor(toEditorState(definition));
                            setIsWorkflowEditorOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="space-y-6">
              <section className="rounded-[30px] border border-[rgba(15,23,42,0.08)] bg-white/84 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-2 text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">
                  <CalendarRange className="h-5 w-5" />
                  Latest routine artifact
                </div>
                {latestWorkflowArtifact ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="text-lg font-[620] text-[#111827]">{latestWorkflowArtifact.title}</div>
                      <div className="mt-1 text-sm leading-6 text-[#4b5563]">{latestWorkflowArtifact.summary || "No summary yet."}</div>
                    </div>
                    <ArtifactBody body={latestWorkflowArtifact.body} emptyMessage="No structured workflow output yet." className="max-h-[360px] overflow-auto" />
                    <Button variant="outline" onClick={() => openArtifact(latestWorkflowArtifact.id)}>
                      Open in artifact reader
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 rounded-[24px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-4 py-8 text-center">
                    <Sparkles className="mx-auto h-8 w-8 text-[#73bf1d]" />
                    <div className="mt-3 text-[18px] font-[620] text-[#111827]">No routine artifact yet</div>
                    <p className="mt-2 text-sm leading-6 text-[#6b7280]">Run the selected routine to publish its first in-app artifact.</p>
                  </div>
                )}
              </section>

              <section className="rounded-[30px] border border-[rgba(15,23,42,0.08)] bg-white/84 p-5 shadow-[0_16px_50px_rgba(15,23,42,0.04)]">
                <div className="text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">Selected routine runs</div>
                <div className="mt-4 space-y-3">
                  {(selectedWorkflowRunsQuery.data || []).length ? (selectedWorkflowRunsQuery.data || []).map((run) => (
                    <div key={run.id} className="rounded-[22px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.10em]", RUN_STATUS_STYLES[run.status] || RUN_STATUS_STYLES.failed)}>
                          {run.status}
                        </span>
                        <span className="text-xs text-[#6b7280]">{formatDateTime(run.created_at)}</span>
                      </div>
                      <div className="mt-3 text-sm text-[#111827]">{run.window_start ? `${formatDateTime(run.window_start)} to ${formatDateTime(run.window_end)}` : "Window pending"}</div>
                      {run.artifact_id ? (
                        <button
                          type="button"
                          onClick={() => openArtifact(run.artifact_id as string)}
                          className="mt-3 text-sm font-[600] text-[#0f766e] hover:text-[#115e59]"
                        >
                          Open artifact
                        </button>
                      ) : null}
                    </div>
                  )) : (
                    <div className="rounded-[24px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-4 py-8 text-center text-sm text-[#6b7280]">
                      No runs yet.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-[rgba(15,23,42,0.08)] bg-white/82 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[18px] font-[620] tracking-[-0.02em] text-[#111827]">Run history</div>
              <p className="mt-1 text-sm text-[#6b7280]">Combined report and workflow execution history.</p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="text-xs uppercase tracking-[0.14em] text-[#6b7280]">
                  <th className="px-3 py-2 font-[700]">Source</th>
                  <th className="px-3 py-2 font-[700]">Status</th>
                  <th className="px-3 py-2 font-[700]">Window</th>
                  <th className="px-3 py-2 font-[700]">Created</th>
                  <th className="px-3 py-2 font-[700]">Artifact</th>
                </tr>
              </thead>
              <tbody>
                {unifiedRuns.length ? unifiedRuns.map((run) => (
                  <tr key={`${run.sourceType}-${run.id}`} className="border-t border-[rgba(15,23,42,0.06)] text-sm text-[#111827]">
                    <td className="px-3 py-3 align-top">
                      <div className="font-[600]">{run.sourceLabel}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.10em] text-[#6b7280]">{run.sourceType}</div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-[700] uppercase tracking-[0.10em]", RUN_STATUS_STYLES[run.status] || RUN_STATUS_STYLES.failed)}>
                        {run.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top text-[#4b5563]">{run.windowLabel}</td>
                    <td className="px-3 py-3 align-top text-[#4b5563]">{formatDateTime(run.createdAt)}</td>
                    <td className="px-3 py-3 align-top">
                      {run.artifactId ? (
                        <button
                          type="button"
                          onClick={() => openArtifact(run.artifactId as string)}
                          className="font-[600] text-[#0f766e] hover:text-[#115e59]"
                        >
                          Open artifact
                        </button>
                      ) : (
                        <span className="text-[#9ca3af]">Pending</span>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-[#6b7280]">
                      No runs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Sheet open={isArtifactEditorOpen} onOpenChange={setIsArtifactEditorOpen}>
        <SheetContent side="right" className="w-full max-w-[620px] overflow-y-auto bg-[#fcfcfa] px-6 py-6">
          <SheetHeader>
            <SheetTitle>{artifactEditor?.id ? "Edit artifact" : "Create artifact"}</SheetTitle>
            <SheetDescription>
              Notebooks, plans, conversation briefs, and ambient digests all use the shared artifact document model.
            </SheetDescription>
          </SheetHeader>

          {artifactEditor ? (
            <div className="mt-6 space-y-6">
              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="grid gap-4">
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Kind</div>
                    <Select
                      value={artifactEditor.kind}
                      onValueChange={(value) =>
                        setArtifactEditor({ ...artifactEditor, kind: value as ArtifactKind })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select artifact kind" />
                      </SelectTrigger>
                      <SelectContent>
                        {(["notebook", "plan", "conversation_brief", "ambient_digest"] as ArtifactKind[]).map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {formatKind(kind)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Title</div>
                    <Input value={artifactEditor.title} onChange={(event) => setArtifactEditor({ ...artifactEditor, title: event.target.value })} />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Summary</div>
                    <textarea
                      value={artifactEditor.summary}
                      onChange={(event) => setArtifactEditor({ ...artifactEditor, summary: event.target.value })}
                      className="min-h-[100px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                    />
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <div className="mb-2 text-sm font-[600] text-[#111827]">Folder</div>
                      <Input value={artifactEditor.folder_key} onChange={(event) => setArtifactEditor({ ...artifactEditor, folder_key: event.target.value })} placeholder="general" />
                    </label>
                    <div className="flex items-center justify-between rounded-[20px] border border-[rgba(15,23,42,0.06)] bg-[#fbfcfb] px-3 py-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">Pinned</div>
                        <div className="text-xs text-[#6b7280]">Keep this near the top of the inbox and launcher.</div>
                      </div>
                      <Switch checked={artifactEditor.is_pinned} onCheckedChange={(checked) => setArtifactEditor({ ...artifactEditor, is_pinned: checked })} />
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Blocks</div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setArtifactEditor({
                        ...artifactEditor,
                        body_blocks: [
                          ...artifactEditor.body_blocks,
                          { ...EMPTY_BLOCK, id: `block-${artifactEditor.body_blocks.length}-${Date.now()}` },
                        ],
                      })
                    }
                  >
                    Add block
                  </Button>
                </div>
                <div className="mt-4 space-y-4">
                  {artifactEditor.body_blocks.map((block, index) => (
                    <div key={block.id} className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-[600] text-[#111827]">Block {index + 1}</div>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setArtifactEditor({
                              ...artifactEditor,
                              body_blocks: artifactEditor.body_blocks.filter((candidate) => candidate.id !== block.id),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="mt-3 space-y-3">
                        <Select
                          value={block.type}
                          onValueChange={(value) =>
                            setArtifactEditor({
                              ...artifactEditor,
                              body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                candidate.id === block.id ? { ...candidate, type: value } : candidate,
                              ),
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Block type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hero">Hero</SelectItem>
                            <SelectItem value="summary">Summary</SelectItem>
                            <SelectItem value="bullet_list">Bullet list</SelectItem>
                            <SelectItem value="metric_list">Metric list</SelectItem>
                          </SelectContent>
                        </Select>
                        {block.type === "hero" ? (
                          <div className="grid gap-3">
                            <Input
                              value={block.title}
                              placeholder="Hero title"
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, title: event.target.value } : candidate,
                                  ),
                                })
                              }
                            />
                            <Input
                              value={block.period_label}
                              placeholder="Period label"
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, period_label: event.target.value } : candidate,
                                  ),
                                })
                              }
                            />
                            <textarea
                              value={block.intro}
                              placeholder="Intro"
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, intro: event.target.value } : candidate,
                                  ),
                                })
                              }
                              className="min-h-[96px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                            />
                          </div>
                        ) : block.type === "summary" ? (
                          <textarea
                            value={block.text}
                            placeholder="Summary text"
                            onChange={(event) =>
                              setArtifactEditor({
                                ...artifactEditor,
                                body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                  candidate.id === block.id ? { ...candidate, text: event.target.value } : candidate,
                                ),
                              })
                            }
                            className="min-h-[120px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                          />
                        ) : (
                          <div className="grid gap-3">
                            {block.type === "bullet_list" ? (
                              <Input
                                value={block.title}
                                placeholder="List title"
                                onChange={(event) =>
                                  setArtifactEditor({
                                    ...artifactEditor,
                                    body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                      candidate.id === block.id ? { ...candidate, title: event.target.value } : candidate,
                                    ),
                                  })
                                }
                              />
                            ) : null}
                            <textarea
                              value={block.items_text}
                              placeholder={block.type === "metric_list" ? "One per line: label | value | note" : "One item per line"}
                              onChange={(event) =>
                                setArtifactEditor({
                                  ...artifactEditor,
                                  body_blocks: artifactEditor.body_blocks.map((candidate) =>
                                    candidate.id === block.id ? { ...candidate, items_text: event.target.value } : candidate,
                                  ),
                                })
                              }
                              className="min-h-[140px] w-full rounded-[18px] border border-[rgba(15,23,42,0.12)] bg-white px-3 py-3 text-sm text-[#111827] outline-none"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex gap-3">
                <Button
                  className="bg-[#111827] text-white hover:bg-[#1f2937]"
                  onClick={() => artifactEditorMutation.mutate()}
                  disabled={artifactEditorMutation.isPending}
                >
                  {artifactEditorMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save artifact
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={isMemoryOpen} onOpenChange={setIsMemoryOpen}>
        <SheetContent side="right" className="w-full max-w-[520px] overflow-y-auto bg-[#fbfcff] px-6 py-6">
          <SheetHeader>
            <SheetTitle>Memory &amp; Rules</SheetTitle>
            <SheetDescription>
              Only approved facts are eligible for prompt injection. Pending suggestions stay visible here until you explicitly approve them.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Pending suggestions</div>
                <div className="text-xs text-[#6b7280]">{pendingFacts.length}</div>
              </div>
              <div className="mt-4 space-y-3">
                {pendingFacts.length ? pendingFacts.map((fact) => (
                  <div key={fact.id} className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.10em] text-[#6b7280]">{fact.category}</div>
                      </div>
                      <div className="text-xs text-[#6b7280]">{Math.round(fact.confidence * 100)}%</div>
                    </div>
                    <pre className="mt-3 overflow-auto rounded-[16px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" onClick={() => factDismissMutation.mutate(fact.id)} disabled={factDismissMutation.isPending}>
                        Dismiss
                      </Button>
                      <Button className="bg-[#111827] text-white hover:bg-[#1f2937]" onClick={() => factApproveMutation.mutate(fact.id)} disabled={factApproveMutation.isPending}>
                        Approve
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[20px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-4 py-8 text-center text-sm text-[#6b7280]">
                    No pending fact suggestions.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Approved facts</div>
                <div className="text-xs text-[#6b7280]">{activeFacts.length}</div>
              </div>
              <div className="mt-4 space-y-3">
                {activeFacts.map((fact) => (
                  <div key={fact.id} className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.10em] text-[#6b7280]">{fact.category}</div>
                      </div>
                      <div className="text-xs text-[#6b7280]">{fact.visibility}</div>
                    </div>
                    <pre className="mt-3 overflow-auto rounded-[16px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isWorkflowEditorOpen} onOpenChange={setIsWorkflowEditorOpen}>
        <SheetContent side="right" className="w-full max-w-[520px] overflow-y-auto bg-[#fcfcfa] px-6 py-6">
          <SheetHeader>
            <SheetTitle>{editor?.name || "Edit routine"}</SheetTitle>
            <SheetDescription>
              Keep this sprint constrained to in-app delivery and bounded permissions.
            </SheetDescription>
          </SheetHeader>

          {editor ? (
            <div className="mt-6 space-y-6">
              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Schedule</div>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Timezone</div>
                    <Input value={editor.timezone} onChange={(event) => setEditor({ ...editor, timezone: event.target.value })} />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Local send time</div>
                    <Input type="time" value={editor.time_value} onChange={(event) => setEditor({ ...editor, time_value: event.target.value })} />
                  </label>
                  <div>
                    <div className="mb-2 text-sm font-[600] text-[#111827]">Weekdays</div>
                    <div className="flex flex-wrap gap-2">
                      {WORKFLOW_WEEKDAY_OPTIONS.map((day) => {
                        const active = editor.send_weekdays.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-sm font-[600] transition",
                              active
                                ? "border-[#111827] bg-[#111827] text-white"
                                : "border-[rgba(15,23,42,0.10)] bg-white text-[#4b5563]",
                            )}
                            onClick={() => {
                              const next = active
                                ? editor.send_weekdays.filter((value) => value !== day.value)
                                : [...editor.send_weekdays, day.value];
                              setEditor({ ...editor, send_weekdays: next });
                            }}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Content</div>
                <div className="mt-4 space-y-3">
                  {Object.entries(editor.config).map(([key, enabled]) => (
                    <div key={key} className="flex items-center justify-between gap-4 rounded-[20px] border border-[rgba(15,23,42,0.06)] bg-[#fbfcfb] px-3 py-3">
                      <div>
                        <div className="text-sm font-[600] text-[#111827]">{key.replace(/_/g, " ")}</div>
                        <div className="text-xs text-[#6b7280]">Include this section in the generated artifact.</div>
                      </div>
                      <Switch checked={enabled} onCheckedChange={(checked) => setEditor({ ...editor, config: { ...editor.config, [key]: checked } })} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
                <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Action profile</div>
                <div className="mt-4 space-y-3">
                  <Select value={editor.action_profile_id} onValueChange={(value) => setEditor({ ...editor, action_profile_id: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a profile" />
                    </SelectTrigger>
                    <SelectContent>
                      {actionProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name} ({profile.mode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="rounded-[18px] border border-[rgba(15,23,42,0.06)] bg-[#fbfcfb] px-3 py-3 text-sm leading-6 text-[#4b5563]">
                    {selectedProfile?.mode === "observe"
                      ? "Observe is read-only. It can be saved as draft or paused, but cannot be scheduled."
                      : "Draft allows artifact creation and workflow updates, but still blocks external sends and system writes."}
                  </div>
                </div>
              </section>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => saveWorkflowMutation.mutate({ status: "draft" })} disabled={saveWorkflowMutation.isPending}>
                  {saveWorkflowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save Draft
                </Button>
                <Button variant="outline" onClick={() => saveWorkflowMutation.mutate({ status: "paused" })} disabled={saveWorkflowMutation.isPending}>
                  Pause
                </Button>
                <Button
                  className="bg-[#111827] text-white hover:bg-[#1f2937]"
                  onClick={() => saveWorkflowMutation.mutate({ status: "scheduled" })}
                  disabled={saveWorkflowMutation.isPending || !isProfileSchedulable(selectedProfile)}
                >
                  Schedule Routine
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={isApprovalsOpen} onOpenChange={setIsApprovalsOpen}>
        <SheetContent side="right" className="w-full max-w-[480px] overflow-y-auto bg-[#fbfcff] px-6 py-6">
          <SheetHeader>
            <SheetTitle>Approval queue</SheetTitle>
            <SheetDescription>
              Observe and Draft profiles do not allow external or destructive actions, so this queue should usually stay empty in sprint one.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            {approvals.length ? approvals.map((approval) => (
              <section key={approval.id} className="rounded-[24px] border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex rounded-full border border-[rgba(59,130,246,0.18)] bg-[rgba(59,130,246,0.10)] px-2.5 py-1 text-[11px] font-[700] uppercase tracking-[0.10em] text-[#1d4ed8]">
                    {approval.status}
                  </span>
                  <span className="text-xs text-[#6b7280]">{formatDateTime(approval.created_at)}</span>
                </div>
                <div className="mt-3 text-sm font-[600] text-[#111827]">{approval.action_kind}</div>
                {approval.reason ? <div className="mt-2 text-sm leading-6 text-[#4b5563]">{approval.reason}</div> : null}
              </section>
            )) : (
              <section className="rounded-[28px] border border-[rgba(15,23,42,0.08)] bg-white px-5 py-10 text-center shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
                <ShieldCheck className="mx-auto h-12 w-12 text-[#2563eb]" />
                <div className="mt-4 text-[22px] font-[620] tracking-[-0.03em] text-[#111827]">Nothing needs your sign-off yet</div>
                <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#6b7280]">
                  Approval-generating actions will arrive later when Ritual starts touching external systems or destructive mutations.
                </p>
                <div className="mt-8 rounded-[24px] border border-[rgba(34,197,94,0.16)] bg-[rgba(34,197,94,0.06)] px-4 py-4 text-sm text-[#166534]">
                  <div className="flex items-center justify-center gap-2 font-[600]">
                    <CheckCircle2 className="h-4 w-4" />
                    Profiles are currently bounded to read-only and draft-only actions.
                  </div>
                </div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
