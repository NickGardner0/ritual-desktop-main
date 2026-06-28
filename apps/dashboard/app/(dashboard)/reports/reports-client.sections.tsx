// @ts-nocheck
"use client";

import { BellRing, BookOpen, CalendarRange, Clock3, FileStack, Loader2, MemoryStick, NotebookPen, Play, Shield, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KIND_STYLES, RUN_STATUS_STYLES, WORKFLOW_STATUS_STYLES, formatDateTime, formatKind, formatPeriod, formatProjectDuration } from "./reports-client.helpers";

type AnyProps = Record<string, any>;

export function ReportsHeroSection(props: AnyProps) {
  const { approvals, pendingFacts, workflowDefinitions, runWorkflowMutation, scrollToRoutines, scrollToAmbient, startArtifactEditor, setIsMemoryOpen, setIsApprovalsOpen } = props;
  return (
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
  );
}

export function ReportsProjectTimeSection(props: AnyProps) {
  const { projectTimeQuery, projectTimeRows, projectTimeTotalMs } = props;
  return (
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
  );
}

export function ReportsAmbientSection(props: AnyProps) {
  const { ambientSectionRef, ambientDefinitions, ambientArtifacts, runWorkflowMutation, snoozeAmbientMutation, dismissAmbientMutation, convertAmbientMutation, openArtifact } = props;
  return (
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
  );
}

export function ReportsRunHistorySection(props: AnyProps) {
  const { unifiedRuns, openArtifact } = props;
  return (
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
  );
}

export function ReportsNotebookSection(props: AnyProps) {
  const { notebookArtifacts, openArtifact, startArtifactEditor } = props;
  return (
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
  );
}
