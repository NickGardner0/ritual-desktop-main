"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, MessageSquare, Plus } from "lucide-react";
import { Button } from "@ritual/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ritual/ui/card";
import { Input } from "@ritual/ui/input";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createExperiment, listExperiments } from "@/lib/experiments";

export function ExperimentsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const isNewDialogOpen = newDialogOpen || searchParams.get("new") === "1";

  const experimentsQuery = useQuery({
    queryKey: ["experiments"],
    queryFn: () => listExperiments(100),
  });
  const createMutation = useMutation({
    mutationFn: createExperiment,
    onSuccess: (experiment) => {
      void queryClient.invalidateQueries({ queryKey: ["experiments"] });
      setNewDialogOpen(false);
      setTitle("");
      setDescription("");
      router.push(`/experiments/${experiment.id}`);
    },
  });

  const setDialogOpen = (open: boolean) => {
    setNewDialogOpen(open);
    if (!open && searchParams.get("new") === "1") router.replace("/experiments");
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-medium tracking-[-0.02em] text-[var(--text-primary)]">Experiments</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            Durable workspaces for questions you want to test over time. Keep threads, observations, files, metrics, and conclusions together.
          </p>
        </div>
        <Button variant="brand" size="sm" onClick={() => setDialogOpen(true)}>
          <Plus />
          New experiment
        </Button>
      </div>

      {experimentsQuery.isLoading ? (
        <div className="mt-10 text-sm text-[var(--text-muted)]">Loading experiments…</div>
      ) : experimentsQuery.isError ? (
        <div className="mt-10 text-sm text-destructive">Could not load experiments.</div>
      ) : experimentsQuery.data?.length ? (
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {experimentsQuery.data.map((experiment) => (
            <Link key={experiment.id} href={`/experiments/${experiment.id}`} className="group block">
              <Card density="compact" className="h-full border-[var(--border-subtle)] bg-[var(--surface-content)] transition-colors group-hover:bg-[var(--row-hover)]">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <FlaskConical className="h-[18px] w-[18px] shrink-0 text-[var(--icon-default)]" strokeWidth={1.9} />
                      <CardTitle className="truncate text-sm">{experiment.title}</CardTitle>
                    </div>
                    <span className="rounded-full bg-[var(--surface-panel)] px-2 py-0.5 text-[10px] font-medium capitalize text-[var(--text-muted)]">
                      {experiment.status}
                    </span>
                  </div>
                  <CardDescription className="line-clamp-2 min-h-10">
                    {experiment.description || "No description yet."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" />{experiment.thread_count} threads</span>
                  <span>{experiment.entry_count} workspace entries</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-12 rounded-lg border border-dashed border-[var(--border-subtle)] px-8 py-14 text-center">
          <FlaskConical className="mx-auto h-7 w-7 text-[var(--icon-muted)]" strokeWidth={1.7} />
          <h2 className="mt-4 text-base font-medium text-[var(--text-primary)]">Start your first experiment</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
            Give a question or behavior its own workspace, then add threads and evidence as the experiment develops.
          </p>
          <Button variant="outline" size="sm" className="mt-5" onClick={() => setDialogOpen(true)}>
            <Plus />
            New experiment
          </Button>
        </div>
      )}

      <Dialog open={isNewDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-lg border-[var(--border-subtle)] bg-[var(--surface-content)] sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-base font-medium">New experiment</DialogTitle>
            <DialogDescription>Create a durable workspace. You can add threads and evidence next.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input density="compact" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Experiment name" />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What are you testing?"
              className="min-h-24 w-full resize-none rounded-[var(--radius-row)] border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
            />
            {createMutation.error ? <p className="text-xs text-destructive">{createMutation.error.message}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              variant="brand"
              size="sm"
              disabled={!title.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ title: title.trim(), description: description.trim() || undefined })}
            >
              Create experiment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
