'use client';

import React, { useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CalendarClock, Check, Loader2, PauseCircle, Play, Plus, RotateCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
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

function priorityBars(priority: TaskPriority) {
  const count = priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
  return (
    <span className="flex h-4 w-5 items-end gap-[2px]">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-full',
            index === 0 ? 'h-1.5' : index === 1 ? 'h-2.5' : 'h-3.5',
            index < count ? 'bg-[#ef6c2f]' : 'bg-[#d4d8d2]',
          )}
        />
      ))}
    </span>
  );
}

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
    <div className="grid h-full min-h-0 grid-cols-[minmax(300px,430px)_minmax(420px,1fr)] bg-[#f7f8f5]">
      <div className="flex min-h-0 flex-col border-r border-[rgba(15,23,42,0.08)] bg-white/80">
        <div className="shrink-0 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-[700] uppercase tracking-[0.16em] text-[#6b7280]">Ritual rules</div>
              <h1 className="mt-2 text-[32px] font-[650] tracking-[-0.04em] text-[#111827]">Routines</h1>
            </div>
            <Button
              type="button"
              className="h-9 bg-[#111827] text-white hover:bg-[#1f2937]"
              onClick={() => createRoutineMutation.mutate(defaultRoutineInput())}
              disabled={createRoutineMutation.isPending}
            >
              <Plus className="h-4 w-4" />
              New
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-1 rounded-sm bg-[#eef1ea] p-1">
            {(['mine', 'templates', 'runs'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'h-8 rounded-sm text-sm font-[600] capitalize',
                  activeTab === tab ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6b7280]',
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 pb-5">
          {activeTab === 'mine' ? (
            <div className="space-y-1">
              {routinesQuery.isLoading ? [0, 1, 2].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-sm bg-[#f1f3ef]" />
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
                    'grid w-full grid-cols-[24px_minmax(0,1fr)] gap-3 rounded-sm px-3 py-3 text-left transition',
                    selectedRoutineId === routine.id ? 'bg-[#e6ecdf]' : 'hover:bg-[#f1f3ef]',
                  )}
                >
                  <RotateCw className="mt-0.5 h-4 w-4 text-[#6b7280]" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-[650] text-[#111827]">{routine.title}</span>
                    <span className="mt-1 flex items-center justify-between gap-3 text-xs text-[#6b7280]">
                      <span className="truncate">{routine.cadence_summary}</span>
                      <span className={cn('shrink-0', routine.status === 'paused' ? 'text-[#b45309]' : 'text-[#166534]')}>{routine.status}</span>
                    </span>
                  </span>
                </button>
              )) : (
                <div className="px-3 py-8 text-center text-sm text-[#6b7280]">No routines yet.</div>
              )}
            </div>
          ) : activeTab === 'templates' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                {AI_ROUTINE_TEMPLATES.map((template) => {
                  const existing = workflows.find((workflow) => workflow.config?.ai_routine_template_key === template.id);
                  return (
                    <div key={template.id} className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-4 w-4 text-[#111827]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-[650] text-[#111827]">{template.title}</div>
                              <div className="mt-1 text-xs leading-5 text-[#6b7280]">{template.description}</div>
                            </div>
                            {existing ? <span className="shrink-0 text-xs font-[650] text-[#166534]">ready</span> : null}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-[#6b7280]">
                              {template.cadence} at {String(template.hour).padStart(2, '0')}:{String(template.minute).padStart(2, '0')}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 rounded-sm"
                              onClick={() => setupAiTemplateMutation.mutate(template)}
                              disabled={setupAiTemplateMutation.isPending}
                            >
                              {setupAiTemplateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                              Set up
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {workflows.length ? (
                <div className="space-y-2 border-t border-[rgba(15,23,42,0.08)] pt-4">
                  {workflows.slice(0, 6).map((workflow) => (
                    <div key={workflow.id} className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                      <div className="flex items-start gap-3">
                        <Bot className="mt-0.5 h-4 w-4 text-[#111827]" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-[650] text-[#111827]">{workflow.name}</div>
                          <div className="mt-1 text-xs leading-5 text-[#6b7280]">{workflow.kind.replace(/_/g, ' ')}</div>
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-3 h-8 rounded-sm"
                            onClick={() => createRoutineMutation.mutate(workflowRoutineInput(workflow))}
                            disabled={createRoutineMutation.isPending}
                          >
                            <Sparkles className="h-4 w-4" />
                            Link
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : workflowsQuery.isLoading ? (
                <div className="px-3 py-8 text-center text-sm text-[#6b7280]">Workflow templates are loading.</div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              {(runsQuery.data || []).map((run) => (
                <div key={run.id} className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-[650] text-[#111827]">{run.status}</span>
                    <span className="text-xs text-[#6b7280]">{formatDateTime(run.scheduled_for)}</span>
                  </div>
                  <div className="mt-1 text-xs text-[#6b7280]">
                    {[
                      run.generated_task_id ? 'Generated task' : null,
                      run.generated_scheduled_block_id ? 'Scheduled block' : null,
                      run.workflow_run_id ? 'Queued AI workflow' : null,
                    ].filter(Boolean).join(' + ') || 'No output'}
                  </div>
                </div>
              ))}
              {!(runsQuery.data || []).length && <div className="px-3 py-8 text-center text-sm text-[#6b7280]">No runs for this routine.</div>}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-auto px-7 py-6">
        {editor ? (
          <div className="mx-auto max-w-4xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-[700] uppercase tracking-[0.16em] text-[#6b7280]">Routine</div>
                <input
                  value={editor.title}
                  onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                  className="mt-1 w-full bg-transparent text-[34px] font-[650] tracking-[-0.04em] text-[#111827] outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" className="rounded-sm" onClick={() => generateDueMutation.mutate()} disabled={generateDueMutation.isPending}>
                  {generateDueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Generate due
                </Button>
                <Button type="button" className="rounded-sm bg-[#111827] text-white hover:bg-[#1f2937]" onClick={saveEditor} disabled={saveRoutineMutation.isPending}>
                  {saveRoutineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <section className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-[700] uppercase tracking-[0.12em] text-[#6b7280]">Type</span>
                      <select
                        value={editor.kind}
                        onChange={(event) => setEditor({ ...editor, kind: event.target.value as RoutineKind })}
                        className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-2 text-sm outline-none"
                      >
                        {KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace(/_/g, ' ')}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-[700] uppercase tracking-[0.12em] text-[#6b7280]">Trigger</span>
                      <select
                        value={editor.trigger_type}
                        onChange={(event) => {
                          const trigger = event.target.value as RoutineTriggerType;
                          setEditor({ ...editor, trigger_type: trigger, trigger_config: triggerDefaults(trigger) });
                        }}
                        className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-2 text-sm outline-none"
                      >
                        {TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{trigger.replace(/_/g, ' ')}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-[rgba(15,23,42,0.06)] pt-4">
                    <div className="flex items-center gap-2 text-sm font-[600] text-[#111827]">
                      {editor.status === 'paused' ? <PauseCircle className="h-4 w-4 text-[#b45309]" /> : <RotateCw className="h-4 w-4 text-[#166534]" />}
                      Paused
                    </div>
                    <Switch
                      checked={editor.status === 'paused'}
                      onCheckedChange={(checked) => setEditor({ ...editor, status: checked ? 'paused' : 'scheduled' })}
                    />
                  </div>
                </section>

                <section className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                  <div className="text-xs font-[700] uppercase tracking-[0.12em] text-[#6b7280]">Recurrence</div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-[#6b7280]">Every</span>
                      <input
                        type="number"
                        min={1}
                        value={Number(editor.trigger_config.interval || 1)}
                        onChange={(event) => updateConfig({ interval: Number(event.target.value) || 1 })}
                        className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                    </label>
                    {editor.trigger_type !== 'on_completion' ? (
                      <label className="space-y-1">
                        <span className="text-xs text-[#6b7280]">Time</span>
                        <input
                          type="time"
                          value={`${String(Number(editor.trigger_config.hour || 9)).padStart(2, '0')}:${String(Number(editor.trigger_config.minute || 0)).padStart(2, '0')}`}
                          onChange={(event) => {
                            const [hour, minute] = event.target.value.split(':').map(Number);
                            updateConfig({ hour, minute });
                          }}
                          className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                        />
                      </label>
                    ) : (
                      <label className="space-y-1">
                        <span className="text-xs text-[#6b7280]">Unit</span>
                        <select
                          value={String(editor.trigger_config.unit || 'weeks')}
                          onChange={(event) => updateConfig({ unit: event.target.value })}
                          className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-2 text-sm outline-none"
                        >
                          <option value="days">days after completion</option>
                          <option value="weeks">weeks after completion</option>
                          <option value="months">months after completion</option>
                        </select>
                      </label>
                    )}
                  </div>
                  {editor.kind === 'calendar_block' || editor.kind === 'mixed' ? (
                    <label className="mt-3 block space-y-1">
                      <span className="text-xs text-[#6b7280]">Block duration</span>
                      <input
                        type="number"
                        min={5}
                        max={720}
                        value={Number(editor.trigger_config.duration_minutes || 60)}
                        onChange={(event) => updateConfig({ duration_minutes: Number(event.target.value) || 60 })}
                        className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                    </label>
                  ) : null}

                  {editor.trigger_type === 'weekly' ? (
                    <div className="mt-4 flex flex-wrap gap-2">
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
                              'h-8 rounded-sm px-3 text-sm font-[600]',
                              active ? 'bg-[#111827] text-white' : 'bg-[#eef1ea] text-[#4b5563]',
                            )}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {editor.trigger_type === 'monthly' || editor.trigger_type === 'yearly' ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      {editor.trigger_type === 'yearly' ? (
                        <label className="space-y-1">
                          <span className="text-xs text-[#6b7280]">Month</span>
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={Number(editor.trigger_config.month || 1)}
                            onChange={(event) => updateConfig({ month: Number(event.target.value) || 1 })}
                            className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                          />
                        </label>
                      ) : null}
                      <label className="space-y-1">
                        <span className="text-xs text-[#6b7280]">Mode</span>
                        <select
                          value={String(editor.trigger_config.mode || 'day_of_month')}
                          onChange={(event) => updateConfig({ mode: event.target.value })}
                          className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-2 text-sm outline-none"
                        >
                          <option value="day_of_month">day of month</option>
                          <option value="nth_weekday">nth weekday</option>
                        </select>
                      </label>
                      {editor.trigger_config.mode === 'nth_weekday' ? (
                        <>
                          <label className="space-y-1">
                            <span className="text-xs text-[#6b7280]">Ordinal</span>
                            <input
                              type="number"
                              min={1}
                              max={5}
                              value={Number(editor.trigger_config.ordinal || 1)}
                              onChange={(event) => updateConfig({ ordinal: Number(event.target.value) || 1 })}
                              className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs text-[#6b7280]">Weekday</span>
                            <select
                              value={Number(editor.trigger_config.weekday || 0)}
                              onChange={(event) => updateConfig({ weekday: Number(event.target.value) })}
                              className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-2 text-sm outline-none"
                            >
                              {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                            </select>
                          </label>
                        </>
                      ) : (
                        <label className="space-y-1">
                          <span className="text-xs text-[#6b7280]">Day</span>
                          <input
                            type="number"
                            min={1}
                            max={31}
                            value={Number(editor.trigger_config.day || 1)}
                            onChange={(event) => updateConfig({ day: Number(event.target.value) || 1 })}
                            className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                          />
                        </label>
                      )}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-[#6b7280]">First run</span>
                      <input
                        type="date"
                        value={dateInputValue(editor.first_run_at)}
                        onChange={(event) => setEditor({ ...editor, first_run_at: dateFromInput(event.target.value) })}
                        className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-[#6b7280]">Ends</span>
                      <input
                        type="date"
                        value={dateInputValue(editor.ends_at)}
                        onChange={(event) => setEditor({ ...editor, ends_at: dateFromInput(event.target.value) })}
                        className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                  <div className="text-xs font-[700] uppercase tracking-[0.12em] text-[#6b7280]">Output template</div>
                  <div className="mt-4 space-y-3">
                    <input
                      value={editor.task_template.title}
                      onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, title: event.target.value } })}
                      placeholder="Generated task title"
                      className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                    />
                    <textarea
                      value={editor.task_template.notes || ''}
                      onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, notes: event.target.value } })}
                      placeholder="Notes or AI prompt context..."
                      rows={4}
                      className="w-full resize-none rounded-sm border border-[rgba(15,23,42,0.12)] px-2 py-2 text-sm outline-none"
                    />
                    <div className="grid gap-3 md:grid-cols-4">
                      <input
                        value={editor.task_template.project || ''}
                        onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, project: event.target.value } })}
                        placeholder="Project"
                        className="h-9 rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                      <input
                        value={editor.task_template.category || ''}
                        onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, category: event.target.value } })}
                        placeholder="Category"
                        className="h-9 rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                      <input
                        value={(editor.task_template.tags || []).join(', ')}
                        onChange={(event) => setEditor({
                          ...editor,
                          task_template: {
                            ...editor.task_template,
                            tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean),
                          },
                        })}
                        placeholder="Tags"
                        className="h-9 rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                      <input
                        value={editor.task_template.linked_habit_id || ''}
                        onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, linked_habit_id: event.target.value || null } })}
                        placeholder="Habit ID"
                        className="h-9 rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                    </div>
                  </div>
                </section>
              </div>

              <aside className="space-y-4">
                <section className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                  <div className="flex items-center gap-2 text-sm font-[650] text-[#111827]">
                    <CalendarClock className="h-4 w-4" />
                    Preview
                  </div>
                  <div className="mt-3 text-[20px] font-[650] tracking-[-0.03em] text-[#111827]">{preview.summary}</div>
                  <div className="mt-3 space-y-2">
                    {preview.dates.map((date) => (
                      <div key={date.toISOString()} className="rounded-sm bg-[#f4f6f2] px-3 py-2 text-sm text-[#4b5563]">
                        {formatDateTime(date)}
                      </div>
                    ))}
                    {!preview.dates.length ? <div className="text-sm text-[#9ca3af]">No upcoming runs.</div> : null}
                  </div>
                </section>

                <section className="rounded-sm border border-[rgba(15,23,42,0.08)] bg-white px-4 py-4">
                  <div className="text-sm font-[650] text-[#111827]">Details</div>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm text-[#6b7280]">Priority</span>
                      <span className="flex items-center gap-2">
                        {priorityBars(editor.priority)}
                        <select
                          value={editor.priority}
                          onChange={(event) => setEditor({ ...editor, priority: event.target.value as TaskPriority })}
                          className="h-8 rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-2 text-sm outline-none"
                        >
                          {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                        </select>
                      </span>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-sm text-[#6b7280]">Tags</span>
                      <input
                        value={editor.tags.join(', ')}
                        onChange={(event) => setEditor({ ...editor, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })}
                        className="h-9 w-full rounded-sm border border-[rgba(15,23,42,0.12)] px-2 text-sm outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-[#6b7280]">Last</div>
                        <div className="mt-1 font-[600] text-[#111827]">{formatDateTime(editor.last_run_at)}</div>
                      </div>
                      <div>
                        <div className="text-[#6b7280]">Next</div>
                        <div className="mt-1 font-[600] text-[#111827]">{formatDateTime(editor.next_run_at)}</div>
                      </div>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <RotateCw className="mx-auto h-8 w-8 text-[#9ca3af]" />
              <div className="mt-3 text-[20px] font-[650] text-[#111827]">Select or create a routine</div>
              <p className="mt-2 text-sm text-[#6b7280]">Rules can generate tasks or queue AI workflow runs.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
