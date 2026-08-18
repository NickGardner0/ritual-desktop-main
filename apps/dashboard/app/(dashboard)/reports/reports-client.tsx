"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { EntityLinkPicker } from "@/components/entities/entity-link-picker";
import { EntityRelatedPanel } from "@/components/entities/entity-related-panel";
import { entityProtocolEnabled } from "@/lib/entities/feature-flag";
import { syncEntityMentions } from "@/lib/entities/sync-mentions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QUERY_POLICY } from "@/lib/query-policies";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ritual/ui/select";
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
  ConversationQueueItem,
  ReportRun,
  ReportRunListResponse,
  ReportSchedule,
  ReportScheduleListResponse,
  WorkflowDefinition,
  WorkflowDefinitionFamily,
  WorkflowRun,
  WorkflowStatus,
} from "@/lib/workflows/types";
import { WORKFLOW_WEEKDAY_OPTIONS } from "@/lib/workflows/types";
import { cn } from "@/lib/utils";
import { ReportsSideSheets } from "./reports-client.panels";
import {
  ReportsAmbientSection,
  ReportsHeroSection,
  ReportsNotebookSection,
  ReportsProjectTimeSection,
  ReportsRunHistorySection,
} from "./reports-client.sections";

import {
  ARTIFACT_FILTERS,
  EMPTY_BLOCK,
  KIND_STYLES,
  RUN_STATUS_STYLES,
  WORKFLOW_STATUS_STYLES,
  buildArtifactEditorState,
  buildDefinitionPayload,
  buildDefaultProjectTimeRange,
  buildUnifiedRuns,
  fetchArtifactDetailForReportsSurface,
  fetchArtifactLibraryForReportsSurface,
  fetchArtifactsForReportsSurface,
  fetchJson,
  fetchWorkflowDefinitionsForReportsSurface,
  fetchWorkflowRunsForReportsSurface,
  formatDateTime,
  formatKind,
  formatLocalClock,
  formatPeriod,
  formatProjectDuration,
  formatScheduleSummary,
  isProfileSchedulable,
  patchWorkflowDefinitionForReportsSurface,
  runWorkflowForReportsSurface,
  saveArtifactForReportsSurface,
  saveWorkflowDefinitionForReportsSurface,
  toEditorState,
  type ArtifactEditorState,
  type ProjectTimeRollupResponse,
  type WorkflowEditorState,
} from "./reports-client.helpers";

function deferStateUpdate(fn: () => void) {
  queueMicrotask(fn);
}

export function ReportsClient() {
  const router = useRouter();
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
    queryFn: () => fetchArtifactsForReportsSurface(filter),
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const artifactLibraryQuery = useQuery({
    queryKey: ["artifacts-library"],
    queryFn: fetchArtifactLibraryForReportsSurface,
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const artifactDetailQuery = useQuery({
    queryKey: ["artifact-detail", selectedArtifactId],
    queryFn: () => fetchArtifactDetailForReportsSurface(selectedArtifactId),
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
    queryFn: fetchWorkflowDefinitionsForReportsSurface,
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
    queryFn: () => fetchWorkflowRunsForReportsSurface({ limit: 12 }),
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
      return fetchWorkflowRunsForReportsSurface({ definitionId: selectedDefinition.id, limit: 12 });
    },
    enabled: Boolean(selectedDefinition),
    staleTime: QUERY_POLICY.general.staleTime,
    refetchInterval: 5_000,
  });

  const latestWorkflowArtifactId = (selectedWorkflowRunsQuery.data || []).find((run) => run.artifact_id)?.artifact_id || null;
  const latestWorkflowArtifactQuery = useQuery({
    queryKey: ["artifact-detail", latestWorkflowArtifactId, "workflow-latest"],
    queryFn: () => fetchArtifactDetailForReportsSurface(latestWorkflowArtifactId),
    enabled: Boolean(latestWorkflowArtifactId),
    staleTime: QUERY_POLICY.general.staleTime,
  });

  const runWorkflowMutation = useMutation({
    mutationFn: runWorkflowForReportsSurface,
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
      const payload = buildDefinitionPayload(editor, status);
      const selected = workflowDefinitions.find((item) => item.id === editor.id);
      if (selected) {
        return saveWorkflowDefinitionForReportsSurface({ definition: selected, patch: payload });
      }
      return fetchJson<WorkflowDefinition>(`/api/workflows/definitions/${editor.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
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
      return saveArtifactForReportsSurface({ artifactEditor, selectedArtifact });
    },
    onSuccess: (artifact) => {
      toast.success(`${formatKind(artifact.kind)} saved.`);
      setIsArtifactEditorOpen(false);
      setSelectedArtifactId(artifact.id);
      void queryClient.invalidateQueries({ queryKey: ["artifacts"] });
      void queryClient.invalidateQueries({ queryKey: ["artifacts-library"] });
      void queryClient.invalidateQueries({ queryKey: ["artifact-detail"] });
      void queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
      const mentionText = [
        artifact.summary,
        artifact.preview_text,
        ...(Array.isArray(artifact.body?.blocks)
          ? artifact.body.blocks.flatMap((block: Record<string, unknown>) => [
              block.text,
              block.intro,
              Array.isArray(block.items) ? block.items.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n") : "",
            ])
          : []),
      ]
        .filter((item) => typeof item === "string" && item.trim())
        .join("\n");
      void syncEntityMentions({
        source: { type: "artifact", id: artifact.id },
        text: mentionText,
      });
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
      return patchWorkflowDefinitionForReportsSurface(definition, {
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
      const quietHours = { start: formatLocalClock(now), end: formatLocalClock(end) };
      return patchWorkflowDefinitionForReportsSurface(definition, { quiet_hours: quietHours });
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
      return patchWorkflowDefinitionForReportsSurface(definition, { status: "paused" });
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
      deferStateUpdate(() => setSelectedArtifactId(artifactIdFromUrl));
      return;
    }
    if (!selectedArtifactId && artifacts.length) {
      deferStateUpdate(() => setSelectedArtifactId(artifacts[0].id));
      return;
    }
    if (selectedArtifactId && artifacts.length && !artifacts.some((item) => item.id === selectedArtifactId)) {
      deferStateUpdate(() => setSelectedArtifactId(artifacts[0].id));
    }
  }, [artifacts, searchParams, selectedArtifactId]);

  useEffect(() => {
    const definitionIdFromUrl = searchParams.get("definitionId");
    if (definitionIdFromUrl) {
      deferStateUpdate(() => setSelectedDefinitionId(definitionIdFromUrl));
      return;
    }
    if (!selectedDefinitionId && workflowDefinitions.length) {
      deferStateUpdate(() => setSelectedDefinitionId(routineDefinitions[0]?.id || ambientDefinitions[0]?.id || workflowDefinitions[0].id));
      return;
    }
    if (selectedDefinitionId && workflowDefinitions.length && !workflowDefinitions.some((item) => item.id === selectedDefinitionId)) {
      deferStateUpdate(() => setSelectedDefinitionId(routineDefinitions[0]?.id || ambientDefinitions[0]?.id || workflowDefinitions[0].id));
    }
  }, [ambientDefinitions, routineDefinitions, searchParams, selectedDefinitionId, workflowDefinitions]);

  useEffect(() => {
    if (searchParams.get("memory") === "1") {
      deferStateUpdate(() => setIsMemoryOpen(true));
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const query = params.toString();
    router.replace(query ? `/reports?${query}` : "/reports", { scroll: false });
    deferStateUpdate(() => {
      setArtifactEditor(buildArtifactEditorState("report"));
      setIsArtifactEditorOpen(true);
    });
  }, [router, searchParams]);

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
        <ReportsHeroSection
          approvals={approvals}
          pendingFacts={pendingFacts}
          workflowDefinitions={workflowDefinitions}
          runWorkflowMutation={runWorkflowMutation}
          scrollToRoutines={scrollToRoutines}
          scrollToAmbient={scrollToAmbient}
          startArtifactEditor={startArtifactEditor}
          setIsMemoryOpen={setIsMemoryOpen}
          setIsApprovalsOpen={setIsApprovalsOpen}
        />

        <ReportsProjectTimeSection
          projectTimeQuery={projectTimeQuery}
          projectTimeRows={projectTimeRows}
          projectTimeTotalMs={projectTimeTotalMs}
        />

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
                {entityProtocolEnabled() ? (
                  <div className="mt-5 space-y-3">
                    <EntityRelatedPanel entityRef={{ type: "artifact", id: selectedArtifact.id }} />
                    <EntityLinkPicker source={{ type: "artifact", id: selectedArtifact.id }} />
                  </div>
                ) : null}
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

        <ReportsNotebookSection
          notebookArtifacts={notebookArtifacts}
          openArtifact={openArtifact}
          startArtifactEditor={startArtifactEditor}
        />

        <ReportsAmbientSection
          ambientSectionRef={ambientSectionRef}
          ambientDefinitions={ambientDefinitions}
          ambientArtifacts={ambientArtifacts}
          runWorkflowMutation={runWorkflowMutation}
          snoozeAmbientMutation={snoozeAmbientMutation}
          dismissAmbientMutation={dismissAmbientMutation}
          convertAmbientMutation={convertAmbientMutation}
          openArtifact={openArtifact}
        />

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

        <ReportsRunHistorySection
          unifiedRuns={unifiedRuns}
          openArtifact={openArtifact}
        />
      </div>

      <ReportsSideSheets
        ctx={{
          actionProfiles,
          activeFacts,
          approvals,
          artifactEditor,
          artifactEditorMutation,
          editor,
          factApproveMutation,
          factDismissMutation,
          isApprovalsOpen,
          isArtifactEditorOpen,
          isMemoryOpen,
          isWorkflowEditorOpen,
          pendingFacts,
          saveWorkflowMutation,
          selectedProfile,
          setArtifactEditor,
          setEditor,
          setIsApprovalsOpen,
          setIsArtifactEditorOpen,
          setIsMemoryOpen,
          setIsWorkflowEditorOpen,
        }}
      />
    </>
  );
}
