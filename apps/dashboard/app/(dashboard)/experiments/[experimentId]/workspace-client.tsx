"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, File, FlaskConical, MessageSquare, Plus, Target, Trash2, TrendingUp } from "lucide-react";
import { Button } from "@ritual/ui/button";
import { Input } from "@ritual/ui/input";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createExperimentEntry,
  createExperimentThread,
  deleteExperimentEntry,
  getExperiment,
  updateExperiment,
  type ExperimentEntryKind,
} from "@/lib/experiments";

const ENTRY_SECTIONS: Array<{ kind: ExperimentEntryKind; label: string; icon: typeof File }> = [
  { kind: "observation", label: "Observations", icon: Target },
  { kind: "file", label: "Files", icon: File },
  { kind: "metric", label: "Metrics", icon: TrendingUp },
  { kind: "conclusion", label: "Conclusions", icon: FlaskConical },
];

export function ExperimentWorkspaceClient() {
  const params = useParams<{ experimentId: string }>();
  const experimentId = params.experimentId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [entryKind, setEntryKind] = useState<ExperimentEntryKind>("observation");
  const [entryTitle, setEntryTitle] = useState("");
  const [entryContent, setEntryContent] = useState("");

  const experimentQuery = useQuery({
    queryKey: ["experiments", experimentId],
    queryFn: () => getExperiment(experimentId),
  });
  const refreshExperiment = () => {
    void queryClient.invalidateQueries({ queryKey: ["experiments"] });
    void queryClient.invalidateQueries({ queryKey: ["experiments", experimentId] });
  };
  const threadMutation = useMutation({
    mutationFn: () => createExperimentThread(experimentId),
    onSuccess: (thread) => {
      refreshExperiment();
      router.push(`/chat?conversation=${thread.id}&experiment=${experimentId}`);
    },
  });
  const entryMutation = useMutation({
    mutationFn: () => createExperimentEntry(experimentId, {
      kind: entryKind,
      title: entryTitle.trim(),
      content: entryContent.trim() || undefined,
    }),
    onSuccess: () => {
      refreshExperiment();
      setEntryDialogOpen(false);
      setEntryTitle("");
      setEntryContent("");
    },
  });
  const deleteEntryMutation = useMutation({
    mutationFn: (entryId: string) => deleteExperimentEntry(experimentId, entryId),
    onSuccess: refreshExperiment,
  });
  const statusMutation = useMutation({
    mutationFn: (status: "active" | "completed") => updateExperiment(experimentId, { status }),
    onSuccess: refreshExperiment,
  });

  const entriesByKind = useMemo(() => {
    const entries = experimentQuery.data?.entries || [];
    return Object.fromEntries(ENTRY_SECTIONS.map(({ kind }) => [kind, entries.filter((entry) => entry.kind === kind)]));
  }, [experimentQuery.data?.entries]);

  const openEntryDialog = (kind: ExperimentEntryKind) => {
    setEntryKind(kind);
    setEntryDialogOpen(true);
  };

  if (experimentQuery.isLoading) return <div className="p-8 text-sm text-[var(--text-muted)]">Loading experiment…</div>;
  if (experimentQuery.isError || !experimentQuery.data) {
    return <div className="p-8 text-sm text-destructive">Could not load this experiment.</div>;
  }
  const experiment = experimentQuery.data;

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <Link href="/experiments" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="h-3.5 w-3.5" /> All experiments
      </Link>
      <div className="mt-5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <FlaskConical className="h-5 w-5 text-[var(--icon-default)]" strokeWidth={1.9} />
            <h1 className="truncate text-2xl font-medium tracking-[-0.02em] text-[var(--text-primary)]">{experiment.title}</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            {experiment.description || "Add threads and evidence as this experiment develops."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate(experiment.status === "completed" ? "active" : "completed")}
          >
            {experiment.status === "completed" ? "Reopen" : "Mark complete"}
          </Button>
          <Button variant="brand" size="sm" disabled={threadMutation.isPending} onClick={() => threadMutation.mutate()}>
            <Plus /> New thread
          </Button>
        </div>
      </div>

      <section className="mt-9">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Threads</h2>
          <span className="text-xs text-[var(--text-muted)]">{experiment.threads.length}</span>
        </div>
        <div className="mt-3 divide-y divide-[var(--border-muted)] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-content)]">
          {experiment.threads.length ? experiment.threads.map((thread) => (
            <Link
              key={thread.id}
              href={`/chat?conversation=${thread.id}&experiment=${experimentId}`}
              className="flex min-h-12 items-center gap-3 px-4 hover:bg-[var(--row-hover)]"
            >
              <MessageSquare className="h-4 w-4 shrink-0 text-[var(--icon-muted)]" />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                {thread.title || thread.first_message || "New experiment thread"}
              </span>
            </Link>
          )) : (
            <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">No threads yet.</div>
          )}
        </div>
      </section>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {ENTRY_SECTIONS.map(({ kind, label, icon: Icon }) => {
          const entries = entriesByKind[kind] || [];
          return (
            <section key={kind} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-content)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                  <Icon className="h-4 w-4 text-[var(--icon-default)]" /> {label}
                </h2>
                <button type="button" onClick={() => openEntryDialog(kind)} className="rounded-[var(--radius-control)] p-1 text-[var(--icon-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]" aria-label={`Add ${label.toLowerCase()}`}>
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {entries.length ? entries.map((entry) => (
                  <div key={entry.id} className="group/entry rounded-[var(--radius-row)] bg-[var(--surface-panel)] px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-normal text-[var(--text-primary)]">{entry.title}</div>
                        {entry.content ? <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--text-secondary)]">{entry.content}</p> : null}
                      </div>
                      <button type="button" onClick={() => deleteEntryMutation.mutate(entry.id)} className="opacity-0 text-[var(--icon-muted)] hover:text-destructive group-hover/entry:opacity-100" aria-label={`Delete ${entry.title}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )) : <p className="py-3 text-xs text-[var(--text-muted)]">Nothing added yet.</p>}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="rounded-lg border-[var(--border-subtle)] bg-[var(--surface-content)] sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-base font-medium">Add {entryKind}</DialogTitle>
            <DialogDescription>Keep the evidence and outcome attached to this experiment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input density="compact" autoFocus value={entryTitle} onChange={(event) => setEntryTitle(event.target.value)} placeholder={`${entryKind[0].toUpperCase()}${entryKind.slice(1)} title`} />
            <textarea
              value={entryContent}
              onChange={(event) => setEntryContent(event.target.value)}
              placeholder={entryKind === "file" ? "Paste a file path or link, plus any context" : "Details"}
              className="min-h-28 w-full resize-none rounded-[var(--radius-row)] border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
            />
            {entryMutation.error ? <p className="text-xs text-destructive">{entryMutation.error.message}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEntryDialogOpen(false)}>Cancel</Button>
            <Button variant="brand" size="sm" disabled={!entryTitle.trim() || entryMutation.isPending} onClick={() => entryMutation.mutate()}>
              Add {entryKind}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
