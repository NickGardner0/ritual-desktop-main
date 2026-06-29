'use client';

import React, { useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CalendarClock, Check, ChevronsRight, Loader2, MoreHorizontal, Play, Plus, RotateCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { useTaskRoutineOutboxSync } from '@/hooks/use-task-routine-outbox-sync';
import { apiJsonWithAuth } from '@/lib/api/client';
import {
  putLocalVaultRoutine,
  putLocalVaultTaskRoutineWriteOutboxItem,
  readLocalVaultRoutines,
  readLocalVaultTaskRoutineWriteOutboxItems,
} from '@/lib/privacy/task-vault-adapter';
import {
  AI_ROUTINE_TEMPLATES,
  workflowPayloadForTemplate,
  workflowRoutineInput,
  type AiRoutineTemplate,
} from '@/lib/tasks/ai-routine-templates';
import { dateFromInput, dateInputValue, formatDateTime } from '@/lib/tasks/date-format';
import {
  buildOptimisticRoutine,
  buildOptimisticRoutineUpdate,
  buildRoutineCreateOutboxItem,
  buildRoutineUpdateOutboxItem,
  mergeRoutinesWithOutbox,
} from '@/lib/tasks/local-first-writes';
import { nextRoutineDates, summarizeRecurrence } from '@/lib/tasks/recurrence';
import { PRIORITIES, WEEKDAYS, defaultRoutineInput, toRoutineEditor, triggerDefaults } from '@/lib/tasks/routine-editor';
import {
  FieldGroup,
  FieldRow,
  IconButton,
  InlineControl,
  OptionMenu,
  ReferencePage,
  SegmentedTabs,
  quietRowClass,
  priorityBars,
  subtleBorderClass,
} from '@/lib/tasks/reference-task-shell';
import type {
  Routine,
  RoutineCreateInput,
  RoutineKind,
  RoutineListResponse,
  RoutineRun,
  RoutineTriggerType,
  RoutineUpdateInput,
  TaskPriority,
} from '@/lib/tasks/types';
import type {
  WorkflowDefinition,
  WorkflowDefinitionListResponse,
  WorkflowDefinitionUpdateInput,
} from '@/lib/workflows/types';
import { cn } from '@/lib/utils';

const TRIGGERS: RoutineTriggerType[] = ['daily', 'weekly', 'monthly', 'yearly', 'on_completion'];
const KINDS: RoutineKind[] = ['task', 'ai_workflow', 'habit_prompt', 'calendar_block', 'mixed'];
const ROUTINE_TABS = [
  { id: 'mine', label: 'Mine' },
  { id: 'templates', label: 'Templates' },
  { id: 'runs', label: 'Runs' },
] as const;
const TRIGGER_OPTIONS = TRIGGERS.map((trigger) => ({ value: trigger, label: trigger.replace(/_/g, ' ') }));
const KIND_OPTIONS = KINDS.map((kind) => ({ value: kind, label: kind.replace(/_/g, ' ') }));
const PRIORITY_OPTIONS = PRIORITIES.map((priority) => ({ value: priority, label: priority }));
const UNIT_OPTIONS = [
  { value: 'days', label: 'days after' },
  { value: 'weeks', label: 'weeks after' },
  { value: 'months', label: 'months after' },
] as const;
const MONTHLY_MODE_OPTIONS = [
  { value: 'day_of_month', label: 'day of month' },
  { value: 'nth_weekday', label: 'nth weekday' },
] as const;
const WEEKDAY_OPTIONS = WEEKDAYS.map((day) => ({ value: String(day.value), label: day.label }));

export function RoutinesClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  useTaskRoutineOutboxSync();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorDraft, setEditor] = useState<Routine | null>(null);
  const [activeTab, setActiveTab] = useState<'mine' | 'templates' | 'runs'>('mine');

  const routinesQuery = useQuery({
    queryKey: ['routines', user?.id],
    queryFn: async () => {
      let backendItems: Routine[] | null = null;
      try {
        backendItems = (await apiJsonWithAuth<RoutineListResponse>('/api/routines', getToken, { userId: user?.id })).items;
      } catch (error) {
        console.warn('[Routines] Backend routine read failed; using local vault fallback', error);
      }
      const [vaultItems, outboxItems] = user?.id
        ? await Promise.all([
            backendItems ? Promise.resolve(null) : readLocalVaultRoutines(user.id),
            readLocalVaultTaskRoutineWriteOutboxItems(user.id),
          ])
        : [null, null] as const;
      return mergeRoutinesWithOutbox(backendItems || vaultItems || [], outboxItems);
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
  });

  const workflowsQuery = useQuery({
    queryKey: ['workflow-definitions', 'routines-page'],
    queryFn: async () => (await apiJsonWithAuth<WorkflowDefinitionListResponse>('/api/workflows/definitions', getToken, { userId: user?.id })).items,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });

  const routines = routinesQuery.data || [];
  const selectedRoutineId = selectedId || routines[0]?.id || null;
  const selectedRoutine = selectedRoutineId ? routines.find((routine) => routine.id === selectedRoutineId) || null : null;
  const editor = editorDraft || (selectedRoutine ? toRoutineEditor(selectedRoutine) : null);

  const runsQuery = useQuery({
    queryKey: ['routine-runs', user?.id, selectedRoutineId],
    queryFn: () => apiJsonWithAuth<RoutineRun[]>(`/api/routines/runs?routine_id=${selectedRoutineId}&limit=20`, getToken, { userId: user?.id }),
    enabled: Boolean(user?.id && selectedRoutineId),
    staleTime: 10_000,
  });

  const createRoutineMutation = useMutation({
    mutationFn: async (input: RoutineCreateInput) => {
      try {
        return await apiJsonWithAuth<RoutineListResponse>('/api/routines', getToken, {
          method: 'POST',
          body: JSON.stringify(input),
          userId: user?.id,
        });
      } catch (error) {
        if (!user?.id) throw error;
        const optimistic = buildOptimisticRoutine(input, user.id);
        await putLocalVaultRoutine(user.id, optimistic);
        await putLocalVaultTaskRoutineWriteOutboxItem(
          user.id,
          buildRoutineCreateOutboxItem(user.id, input, optimistic),
        );
        toast.message('Routine saved locally. It will sync when the backend is available.');
        return { items: [optimistic] };
      }
    },
    onSuccess: (response) => {
      const routine = response.items[0];
      if (routine) {
        setSelectedId(routine.id);
        setEditor(toRoutineEditor(routine));
        if (user?.id) void putLocalVaultRoutine(user.id, routine).catch(() => undefined);
      }
      void queryClient.invalidateQueries({ queryKey: ['routines', user?.id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to create routine.'),
  });

  const saveRoutineMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: RoutineUpdateInput }) => {
      try {
        return await apiJsonWithAuth<RoutineListResponse>(`/api/routines/${id}`, getToken, {
          method: 'PATCH',
          body: JSON.stringify(patch),
          userId: user?.id,
        });
      } catch (error) {
        if (!user?.id) throw error;
        const current = (queryClient.getQueryData<Routine[]>(['routines', user.id]) || []).find((routine) => routine.id === id) || editor;
        if (!current) throw error;
        const optimistic = buildOptimisticRoutineUpdate(current, patch, user.id);
        await putLocalVaultRoutine(user.id, optimistic);
        await putLocalVaultTaskRoutineWriteOutboxItem(
          user.id,
          buildRoutineUpdateOutboxItem(user.id, patch, optimistic),
        );
        toast.message('Routine update saved locally. It will sync when the backend is available.');
        return { items: [optimistic] };
      }
    },
    onSuccess: (response) => {
      const routine = response.items[0];
      if (routine) {
        setEditor(toRoutineEditor(routine));
        if (user?.id) void putLocalVaultRoutine(user.id, routine).catch(() => undefined);
      }
      void queryClient.invalidateQueries({ queryKey: ['routines', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
      toast.success('Routine saved.');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to save routine.'),
  });

  const generateDueMutation = useMutation({
    mutationFn: () => apiJsonWithAuth('/api/routines/generate-due', getToken, { method: 'POST', userId: user?.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['routines', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['routine-runs', user?.id] });
      toast.success('Due routines generated.');
    },
  });

  const workflows = workflowsQuery.data || [];
  const setupAiTemplateMutation = useMutation({
    mutationFn: async (template: AiRoutineTemplate) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      const payload = workflowPayloadForTemplate(template, timezone);
      const existing = workflows.find((workflow) => workflow.config?.ai_routine_template_key === template.id);
      const patchPayload: WorkflowDefinitionUpdateInput = {
        name: payload.name,
        definition_family: payload.definition_family,
        trigger_type: payload.trigger_type,
        signal_kind: payload.signal_kind,
        status: payload.status,
        schedule: payload.schedule,
        delivery: payload.delivery,
        config: payload.config,
      };
      const definition = existing
        ? await apiJsonWithAuth<WorkflowDefinition>(`/api/workflows/definitions/${existing.id}`, getToken, {
            method: 'PATCH',
            body: JSON.stringify(patchPayload),
            userId: user?.id,
          })
        : await apiJsonWithAuth<WorkflowDefinition>('/api/workflows/definitions', getToken, {
            method: 'POST',
            body: JSON.stringify(payload),
            userId: user?.id,
          });
      const routineResponse = await apiJsonWithAuth<RoutineListResponse>('/api/routines', getToken, {
        method: 'POST',
        body: JSON.stringify(workflowRoutineInput(definition, template)),
        userId: user?.id,
      });
      return { definition, routine: routineResponse.items[0] || null };
    },
    onSuccess: ({ routine }) => {
      if (routine) {
        setSelectedId(routine.id);
        setEditor(toRoutineEditor(routine));
        setActiveTab('mine');
        if (user?.id) void putLocalVaultRoutine(user.id, routine).catch(() => undefined);
      }
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions', 'routines-page'] });
      void queryClient.invalidateQueries({ queryKey: ['routines', user?.id] });
      toast.success('AI routine set up.');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to set up AI routine.'),
  });
  const preview = useMemo(() => {
    if (!editor) return { summary: '', dates: [] as Date[] };
    return {
      summary: summarizeRecurrence(editor.trigger_type, editor.trigger_config || {}),
      dates: nextRoutineDates({
        triggerType: editor.trigger_type,
        config: editor.trigger_config || {},
        firstRunAt: editor.first_run_at ? new Date(editor.first_run_at) : null,
        endsAt: editor.ends_at ? new Date(editor.ends_at) : null,
        lastCompletedAt: editor.last_run_at ? new Date(editor.last_run_at) : null,
      }),
    };
  }, [editor]);

  const updateConfig = (patch: Record<string, unknown>) => {
    setEditor((current) => {
      const base = current || editor;
      return base ? { ...base, trigger_config: { ...(base.trigger_config || {}), ...patch } } : base;
    });
  };

  const saveEditor = () => {
    if (!editor) return;
    saveRoutineMutation.mutate({
      id: editor.id,
      patch: {
        title: editor.title,
        description: editor.description,
        status: editor.status,
        kind: editor.kind,
        trigger_type: editor.trigger_type,
        trigger_config: editor.trigger_config,
        timezone: editor.timezone,
        priority: editor.priority,
        tags: editor.tags,
        task_template: editor.task_template,
        ai_workflow_definition_id: editor.ai_workflow_definition_id,
        first_run_at: editor.first_run_at,
        ends_at: editor.ends_at,
      },
    });
  };

  return (
    <ReferencePage>
      <div className="grid h-full min-h-0 grid-cols-[minmax(260px,330px)_minmax(500px,1fr)]">
        <aside className={cn('flex min-h-0 flex-col border-r bg-[var(--surface-content)]', subtleBorderClass)}>
          <div className="shrink-0 px-6 pb-4 pt-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[12px] font-normal uppercase tracking-[0.13em] text-[var(--text-muted)]">Ritual rules</div>
                <h1 className="mt-2 truncate text-[30px] font-semibold leading-none tracking-normal text-[var(--text-primary)]">Routines</h1>
              </div>
              <IconButton
                className="h-8 w-8 bg-[rgba(39,37,30,0.045)] text-[var(--text-primary)] disabled:opacity-55"
                onClick={() => createRoutineMutation.mutate(defaultRoutineInput())}
                disabled={createRoutineMutation.isPending}
                aria-label="Create routine"
              >
                <Plus className="h-4 w-4" />
              </IconButton>
            </div>
            <SegmentedTabs
              value={activeTab}
              options={ROUTINE_TABS}
              onChange={setActiveTab}
              className="mt-5 w-full [&>button]:flex-1"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-3 pb-5">
            {activeTab === 'mine' ? (
              <div className="space-y-1">
                {routinesQuery.isLoading ? [0, 1, 2].map((item) => (
                  <div key={item} className="h-12 animate-pulse rounded-sm bg-[rgba(39,37,30,0.024)]" />
                )) : routines.length ? routines.map((routine) => (
                  <button
                    key={routine.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(routine.id);
                      setEditor(toRoutineEditor(routine));
                      setActiveTab('mine');
                    }}
                    className={cn(
                      'grid w-full grid-cols-[22px_minmax(0,1fr)] gap-3 rounded-sm px-3 py-2 text-left transition',
                      selectedRoutineId === routine.id ? 'bg-[rgba(39,37,30,0.045)]' : 'hover:bg-[var(--row-hover)]',
                    )}
                  >
                    <RotateCw className="mt-0.5 h-4 w-4 text-[var(--icon-muted)]" strokeWidth={1.7} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-normal text-[var(--text-primary)]">{routine.title}</span>
                      <span className="mt-1 flex items-center justify-between gap-3 text-[12px] font-normal text-[var(--text-muted)]">
                        <span className="truncate">{routine.cadence_summary}</span>
                        <span className="shrink-0">{routine.status}</span>
                      </span>
                    </span>
                  </button>
                )) : (
                  <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No routines yet.</div>
                )}
              </div>
            ) : activeTab === 'templates' ? (
              <div className="space-y-2">
                {AI_ROUTINE_TEMPLATES.map((template) => {
                  const existing = workflows.find((workflow) => workflow.config?.ai_routine_template_key === template.id);
                  return (
                    <div key={template.id} className="rounded-sm px-3 py-3 transition hover:bg-[var(--row-hover)]">
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-4 w-4 text-[var(--icon-muted)]" strokeWidth={1.7} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-normal text-[var(--text-primary)]">{template.title}</div>
                              <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">{template.description}</div>
                            </div>
                            {existing ? <span className="shrink-0 text-[12px] font-normal text-[var(--text-muted)]">ready</span> : null}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-[12px] text-[var(--text-muted)]">
                              {template.cadence} {String(template.hour).padStart(2, '0')}:{String(template.minute).padStart(2, '0')}
                            </span>
                            <button
                              type="button"
                              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-[rgba(39,37,30,0.024)] px-2.5 text-[12px] font-normal text-[var(--text-primary)] hover:bg-[var(--row-hover)] disabled:opacity-55"
                              onClick={() => setupAiTemplateMutation.mutate(template)}
                              disabled={setupAiTemplateMutation.isPending}
                            >
                              {setupAiTemplateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                              Set up
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {workflows.length ? (
                  <div className={cn('mt-4 space-y-1 border-t pt-4', subtleBorderClass)}>
                    {workflows.slice(0, 6).map((workflow) => (
                      <button
                        key={workflow.id}
                        type="button"
                        className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] gap-3 rounded-sm px-3 py-2.5 text-left transition hover:bg-[var(--row-hover)]"
                        onClick={() => createRoutineMutation.mutate(workflowRoutineInput(workflow))}
                        disabled={createRoutineMutation.isPending}
                      >
                        <Bot className="mt-0.5 h-4 w-4 text-[var(--icon-muted)]" strokeWidth={1.7} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-normal text-[var(--text-primary)]">{workflow.name}</span>
                          <span className="mt-1 block text-[12px] text-[var(--text-muted)]">{workflow.kind.replace(/_/g, ' ')}</span>
                        </span>
                        <Sparkles className="mt-0.5 h-4 w-4 text-[var(--icon-muted)]" strokeWidth={1.7} />
                      </button>
                    ))}
                  </div>
                ) : workflowsQuery.isLoading ? (
                  <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">Workflow templates are loading.</div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                {(runsQuery.data || []).map((run) => (
                  <div key={run.id} className="rounded-sm px-3 py-2.5 transition hover:bg-[var(--row-hover)]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[14px] font-normal text-[var(--text-primary)]">{run.status}</span>
                      <span className="text-[12px] text-[var(--text-muted)]">{formatDateTime(run.scheduled_for)}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--text-muted)]">
                      {[
                        run.generated_task_id ? 'Generated task' : null,
                        run.generated_scheduled_block_id ? 'Scheduled block' : null,
                        run.workflow_run_id ? 'Queued AI workflow' : null,
                      ].filter(Boolean).join(' + ') || 'No output'}
                    </div>
                  </div>
                ))}
                {!(runsQuery.data || []).length && <div className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No runs for this routine.</div>}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className={cn('flex h-11 shrink-0 items-center border-b px-6', subtleBorderClass)}>
            <ChevronsRight className="h-4 w-4 text-[var(--icon-muted)]" strokeWidth={1.7} />
            <div className="min-w-0 flex-1 text-center text-[13px] font-normal text-[var(--text-muted)]">Routine</div>
            <IconButton className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-8 py-7">
            {editor ? (
              <div className="mx-auto max-w-[700px]">
                <div className="mb-6 flex items-start justify-between gap-5">
                  <input
                    value={editor.title}
                    onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-[30px] font-semibold leading-tight tracking-normal text-[var(--text-primary)] outline-none"
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className={cn('inline-flex h-8 items-center gap-1.5 px-2.5 text-[13px] font-normal text-[var(--text-primary)] disabled:opacity-55', quietRowClass)}
                      onClick={() => generateDueMutation.mutate()}
                      disabled={generateDueMutation.isPending}
                    >
                      {generateDueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Generate due
                    </button>
                    <button
                      type="button"
                      className={cn('inline-flex h-8 items-center gap-1.5 px-2.5 text-[13px] font-normal text-[var(--text-primary)] disabled:opacity-55', quietRowClass)}
                      onClick={saveEditor}
                      disabled={saveRoutineMutation.isPending}
                    >
                      {saveRoutineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Save
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <FieldGroup>
                    <FieldRow label="Kind">
                      <OptionMenu
                        value={editor.kind}
                        options={KIND_OPTIONS}
                        onChange={(kind) => setEditor({ ...editor, kind })}
                        className="w-[170px] bg-white/60"
                        ariaLabel="Routine kind"
                      />
                    </FieldRow>
                    <FieldRow label="Trigger">
                      <OptionMenu
                        value={editor.trigger_type}
                        options={TRIGGER_OPTIONS}
                        onChange={(trigger) => {
                          setEditor({ ...editor, trigger_type: trigger, trigger_config: triggerDefaults(trigger) });
                        }}
                        className="w-[170px] bg-white/60"
                        ariaLabel="Routine trigger"
                      />
                    </FieldRow>
                    <FieldRow label="Paused">
                      <Switch
                        checked={editor.status === 'paused'}
                        onCheckedChange={(checked) => setEditor({ ...editor, status: checked ? 'paused' : 'scheduled' })}
                      />
                    </FieldRow>
                  </FieldGroup>

                  <FieldGroup>
                    <FieldRow label="Every">
                      <InlineControl
                        type="number"
                        min={1}
                        value={Number(editor.trigger_config.interval || 1)}
                        onChange={(event) => updateConfig({ interval: Number(event.target.value) || 1 })}
                        className="w-16 text-right"
                      />
                      <span className="text-sm font-normal text-[var(--text-secondary)]">
                        {editor.trigger_type === 'daily' ? 'days' : editor.trigger_type === 'weekly' ? 'weeks' : editor.trigger_type === 'monthly' ? 'months' : editor.trigger_type === 'yearly' ? 'years' : String(editor.trigger_config.unit || 'weeks')}
                      </span>
                    </FieldRow>
                    {editor.trigger_type !== 'on_completion' ? (
                      <FieldRow label="Time">
                        <InlineControl
                          type="time"
                          value={`${String(Number(editor.trigger_config.hour || 9)).padStart(2, '0')}:${String(Number(editor.trigger_config.minute || 0)).padStart(2, '0')}`}
                          onChange={(event) => {
                            const [hour, minute] = event.target.value.split(':').map(Number);
                            updateConfig({ hour, minute });
                          }}
                          className="w-[128px]"
                        />
                      </FieldRow>
                    ) : (
                      <FieldRow label="After completion">
                        <OptionMenu
                          value={String(editor.trigger_config.unit || 'weeks')}
                          options={UNIT_OPTIONS}
                          onChange={(unit) => updateConfig({ unit })}
                          className="w-[190px] bg-white/60"
                          ariaLabel="Completion interval unit"
                        />
                      </FieldRow>
                    )}
                    {editor.kind === 'calendar_block' || editor.kind === 'mixed' ? (
                      <FieldRow label="Block duration">
                        <InlineControl
                          type="number"
                          min={5}
                          max={720}
                          value={Number(editor.trigger_config.duration_minutes || 60)}
                          onChange={(event) => updateConfig({ duration_minutes: Number(event.target.value) || 60 })}
                          className="w-20 text-right"
                        />
                        <span className="text-sm font-normal text-[var(--text-secondary)]">minutes</span>
                      </FieldRow>
                    ) : null}
                    {editor.trigger_type === 'weekly' ? (
                      <FieldRow label="On">
                        <span className="flex flex-wrap justify-end gap-1.5">
                          {WEEKDAYS.map((day) => {
                            const weekdays = Array.isArray(editor.trigger_config.weekdays) ? editor.trigger_config.weekdays.map(Number) : [];
                            const active = weekdays.includes(day.value);
                            return (
                              <button
                                key={day.value}
                                type="button"
                                onClick={() => updateConfig({
                                  weekdays: active ? weekdays.filter((value) => value !== day.value) : [...weekdays, day.value].sort(),
                                })}
                                className={cn(
                                  'h-7 rounded-sm px-2 text-[12px] font-normal transition',
                                  active ? 'bg-[rgba(39,37,30,0.055)] text-[var(--text-primary)]' : 'bg-white/60 text-[var(--text-secondary)] hover:bg-white',
                                )}
                              >
                                {day.label.slice(0, 3)}
                              </button>
                            );
                          })}
                        </span>
                      </FieldRow>
                    ) : null}
                    {editor.trigger_type === 'monthly' || editor.trigger_type === 'yearly' ? (
                      <>
                        {editor.trigger_type === 'yearly' ? (
                          <FieldRow label="Month">
                            <InlineControl
                              type="number"
                              min={1}
                              max={12}
                              value={Number(editor.trigger_config.month || 1)}
                              onChange={(event) => updateConfig({ month: Number(event.target.value) || 1 })}
                              className="w-20 text-right"
                            />
                          </FieldRow>
                        ) : null}
                        <FieldRow label="On the">
                          <OptionMenu
                            value={String(editor.trigger_config.mode || 'day_of_month')}
                            options={MONTHLY_MODE_OPTIONS}
                            onChange={(mode) => updateConfig({ mode })}
                            className="w-[170px] bg-white/60"
                            ariaLabel="Monthly schedule mode"
                          />
                        </FieldRow>
                        {editor.trigger_config.mode === 'nth_weekday' ? (
                          <FieldRow label="When">
                            <InlineControl
                              type="number"
                              min={1}
                              max={5}
                              value={Number(editor.trigger_config.ordinal || 1)}
                              onChange={(event) => updateConfig({ ordinal: Number(event.target.value) || 1 })}
                              className="w-14 text-right"
                            />
                            <OptionMenu
                              value={String(Number(editor.trigger_config.weekday || 0))}
                              options={WEEKDAY_OPTIONS}
                              onChange={(weekday) => updateConfig({ weekday: Number(weekday) })}
                              className="w-[132px] bg-white/60"
                              ariaLabel="Weekday"
                            />
                          </FieldRow>
                        ) : (
                          <FieldRow label="Day">
                            <InlineControl
                              type="number"
                              min={1}
                              max={31}
                              value={Number(editor.trigger_config.day || 1)}
                              onChange={(event) => updateConfig({ day: Number(event.target.value) || 1 })}
                              className="w-20 text-right"
                            />
                          </FieldRow>
                        )}
                      </>
                    ) : null}
                    <FieldRow label="First run">
                      <InlineControl
                        type="date"
                        value={dateInputValue(editor.first_run_at)}
                        onChange={(event) => setEditor({ ...editor, first_run_at: dateFromInput(event.target.value) })}
                        className="w-[150px]"
                      />
                    </FieldRow>
                    <FieldRow label="Ends">
                      <InlineControl
                        type="date"
                        value={dateInputValue(editor.ends_at)}
                        onChange={(event) => setEditor({ ...editor, ends_at: dateFromInput(event.target.value) })}
                        className="w-[150px]"
                      />
                    </FieldRow>
                  </FieldGroup>

                  <div className="px-3.5 text-sm leading-6 text-[var(--text-muted)]">
                    <div>Last: {formatDateTime(editor.last_run_at)}</div>
                    <div>Next: {preview.dates.map((date) => formatDateTime(date)).slice(0, 4).join(', ') || formatDateTime(editor.next_run_at)}</div>
                  </div>

                  <FieldGroup>
                    <FieldRow label="Priority">
                      {priorityBars(editor.priority, true)}
                      <OptionMenu
                        value={editor.priority}
                        options={PRIORITY_OPTIONS}
                        onChange={(priority) => setEditor({ ...editor, priority })}
                        className="w-[120px] bg-white/60"
                        ariaLabel="Routine priority"
                      />
                    </FieldRow>
                    <FieldRow label="Template title">
                      <InlineControl
                        value={editor.task_template.title}
                        onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, title: event.target.value } })}
                        className="w-[360px]"
                      />
                    </FieldRow>
                    <FieldRow label="Project">
                      <InlineControl
                        value={editor.task_template.project || ''}
                        onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, project: event.target.value } })}
                        className="w-[240px]"
                      />
                    </FieldRow>
                    <FieldRow label="Category">
                      <InlineControl
                        value={editor.task_template.category || ''}
                        onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, category: event.target.value } })}
                        className="w-[240px]"
                      />
                    </FieldRow>
                    <FieldRow label="Tags">
                      <InlineControl
                        value={editor.tags.join(', ')}
                        onChange={(event) => setEditor({ ...editor, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })}
                        className="w-[240px]"
                      />
                    </FieldRow>
                    <FieldRow label="Template tags">
                      <InlineControl
                        value={(editor.task_template.tags || []).join(', ')}
                        onChange={(event) => setEditor({
                          ...editor,
                          task_template: {
                            ...editor.task_template,
                            tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                          },
                        })}
                        className="w-[240px]"
                      />
                    </FieldRow>
                    <FieldRow label="Linked habit">
                      <InlineControl
                        value={editor.task_template.linked_habit_id || ''}
                        onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, linked_habit_id: event.target.value || null } })}
                        className="w-[240px]"
                      />
                    </FieldRow>
                  </FieldGroup>

                  <textarea
                    value={editor.description || ''}
                    onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                    placeholder="Routine notes..."
                    rows={4}
                    className="w-full resize-none rounded-sm border border-[var(--border-muted)] bg-[rgba(39,37,30,0.014)] px-3.5 py-3 text-[15px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[rgba(15,23,42,0.12)] focus:bg-white"
                  />

                  <textarea
                    value={editor.task_template.notes || ''}
                    onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, notes: event.target.value } })}
                    placeholder="Generated task notes or AI prompt context..."
                    rows={4}
                    className="w-full resize-none rounded-sm border border-[var(--border-muted)] bg-[rgba(39,37,30,0.014)] px-3.5 py-3 text-[15px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[rgba(15,23,42,0.12)] focus:bg-white"
                  />

                  <div className="rounded-sm border border-dashed border-[var(--border-subtle)] px-3.5 py-3 text-[13px] text-[var(--text-muted)]">
                    <CalendarClock className="mr-2 inline h-4 w-4 align-[-3px]" />
                    {preview.summary || 'No recurrence configured.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <RotateCw className="mx-auto h-7 w-7 text-[var(--icon-muted)]" strokeWidth={1.5} />
                  <div className="mt-3 text-[17px] font-semibold text-[var(--text-primary)]">Select or create a routine</div>
                  <p className="mt-2 text-sm text-[var(--text-muted)]">Rules can generate tasks or queue AI workflow runs.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </ReferencePage>
  );
}
