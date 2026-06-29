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
  InlineSelect,
  ReferencePage,
  SegmentedTabs,
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
      <div className="grid h-full min-h-0 grid-cols-[minmax(284px,360px)_minmax(520px,1fr)]">
        <aside className={cn('flex min-h-0 flex-col border-r bg-white/42', subtleBorderClass)}>
          <div className="shrink-0 px-6 pb-4 pt-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[12px] font-[650] uppercase tracking-[0.16em] text-[#737b86]">Ritual rules</div>
                <h1 className="mt-2 truncate text-[36px] font-[680] leading-none tracking-[-0.035em] text-[#10141d]">Routines</h1>
              </div>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-sm bg-[#111827] px-3 text-[14px] font-[650] text-white transition hover:bg-[#202938] disabled:opacity-55"
                onClick={() => createRoutineMutation.mutate(defaultRoutineInput())}
                disabled={createRoutineMutation.isPending}
              >
                <Plus className="h-4 w-4" />
                New
              </button>
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
                  <div key={item} className="h-14 animate-pulse rounded-sm bg-[#f1f3ef]" />
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
                      'grid w-full grid-cols-[22px_minmax(0,1fr)] gap-3 rounded-sm px-3 py-2.5 text-left transition',
                      selectedRoutineId === routine.id ? 'bg-[#e6ecdf]' : 'hover:bg-[#f1f3ef]',
                    )}
                  >
                    <RotateCw className="mt-0.5 h-4 w-4 text-[#69727d]" />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-[640] text-[#1f242d]">{routine.title}</span>
                      <span className="mt-1 flex items-center justify-between gap-3 text-[12px] font-[520] text-[#737b86]">
                        <span className="truncate">{routine.cadence_summary}</span>
                        <span className={cn('shrink-0', routine.status === 'paused' ? 'text-[#b45309]' : 'text-[#167046]')}>{routine.status}</span>
                      </span>
                    </span>
                  </button>
                )) : (
                  <div className="px-3 py-8 text-center text-[14px] text-[#737b86]">No routines yet.</div>
                )}
              </div>
            ) : activeTab === 'templates' ? (
              <div className="space-y-2">
                {AI_ROUTINE_TEMPLATES.map((template) => {
                  const existing = workflows.find((workflow) => workflow.config?.ai_routine_template_key === template.id);
                  return (
                    <div key={template.id} className="rounded-sm px-3 py-3 transition hover:bg-[#f1f3ef]">
                      <div className="flex items-start gap-3">
                        <Sparkles className="mt-0.5 h-4 w-4 text-[#20242c]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-[650] text-[#1f242d]">{template.title}</div>
                              <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#737b86]">{template.description}</div>
                            </div>
                            {existing ? <span className="shrink-0 text-[12px] font-[650] text-[#167046]">ready</span> : null}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-[12px] text-[#737b86]">
                              {template.cadence} {String(template.hour).padStart(2, '0')}:{String(template.minute).padStart(2, '0')}
                            </span>
                            <button
                              type="button"
                              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/85 px-2.5 text-[12px] font-[640] text-[#2f3743] hover:bg-white disabled:opacity-55"
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
                        className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] gap-3 rounded-sm px-3 py-2.5 text-left transition hover:bg-[#f1f3ef]"
                        onClick={() => createRoutineMutation.mutate(workflowRoutineInput(workflow))}
                        disabled={createRoutineMutation.isPending}
                      >
                        <Bot className="mt-0.5 h-4 w-4 text-[#69727d]" />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-[650] text-[#1f242d]">{workflow.name}</span>
                          <span className="mt-1 block text-[12px] text-[#737b86]">{workflow.kind.replace(/_/g, ' ')}</span>
                        </span>
                        <Sparkles className="mt-0.5 h-4 w-4 text-[#69727d]" />
                      </button>
                    ))}
                  </div>
                ) : workflowsQuery.isLoading ? (
                  <div className="px-3 py-8 text-center text-[14px] text-[#737b86]">Workflow templates are loading.</div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                {(runsQuery.data || []).map((run) => (
                  <div key={run.id} className="rounded-sm px-3 py-2.5 transition hover:bg-[#f1f3ef]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[14px] font-[650] text-[#1f242d]">{run.status}</span>
                      <span className="text-[12px] text-[#737b86]">{formatDateTime(run.scheduled_for)}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-[#737b86]">
                      {[
                        run.generated_task_id ? 'Generated task' : null,
                        run.generated_scheduled_block_id ? 'Scheduled block' : null,
                        run.workflow_run_id ? 'Queued AI workflow' : null,
                      ].filter(Boolean).join(' + ') || 'No output'}
                    </div>
                  </div>
                ))}
                {!(runsQuery.data || []).length && <div className="px-3 py-8 text-center text-[14px] text-[#737b86]">No runs for this routine.</div>}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <div className={cn('flex h-12 shrink-0 items-center border-b px-6', subtleBorderClass)}>
            <ChevronsRight className="h-4 w-4 text-[#8a929c]" />
            <div className="min-w-0 flex-1 text-center text-[13px] font-[640] text-[#737b86]">Routine</div>
            <IconButton className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-8 py-7">
            {editor ? (
              <div className="mx-auto max-w-[760px]">
                <div className="mb-7 flex items-start justify-between gap-5">
                  <input
                    value={editor.title}
                    onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-[34px] font-[680] leading-tight tracking-[-0.035em] text-[#111827] outline-none"
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/80 px-3 text-[13px] font-[640] text-[#2f3743] hover:bg-[#f3f5f0] disabled:opacity-55"
                      onClick={() => generateDueMutation.mutate()}
                      disabled={generateDueMutation.isPending}
                    >
                      {generateDueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Generate due
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-sm bg-[#111827] px-3 text-[13px] font-[650] text-white hover:bg-[#202938] disabled:opacity-55"
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
                      <InlineSelect
                        value={editor.kind}
                        onChange={(event) => setEditor({ ...editor, kind: event.target.value as RoutineKind })}
                        className="w-[170px]"
                      >
                        {KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace(/_/g, ' ')}</option>)}
                      </InlineSelect>
                    </FieldRow>
                    <FieldRow label="Trigger">
                      <InlineSelect
                        value={editor.trigger_type}
                        onChange={(event) => {
                          const trigger = event.target.value as RoutineTriggerType;
                          setEditor({ ...editor, trigger_type: trigger, trigger_config: triggerDefaults(trigger) });
                        }}
                        className="w-[170px]"
                      >
                        {TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{trigger.replace(/_/g, ' ')}</option>)}
                      </InlineSelect>
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
                      <span className="text-[14px] font-[560] text-[#6a717b]">
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
                        <InlineSelect
                          value={String(editor.trigger_config.unit || 'weeks')}
                          onChange={(event) => updateConfig({ unit: event.target.value })}
                          className="w-[190px]"
                        >
                          <option value="days">days after</option>
                          <option value="weeks">weeks after</option>
                          <option value="months">months after</option>
                        </InlineSelect>
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
                        <span className="text-[14px] font-[560] text-[#6a717b]">minutes</span>
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
                                  'h-7 rounded-sm px-2 text-[12px] font-[640]',
                                  active ? 'bg-[#111827] text-white' : 'bg-white/82 text-[#626a75] hover:bg-white',
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
                          <InlineSelect
                            value={String(editor.trigger_config.mode || 'day_of_month')}
                            onChange={(event) => updateConfig({ mode: event.target.value })}
                            className="w-[170px]"
                          >
                            <option value="day_of_month">day of month</option>
                            <option value="nth_weekday">nth weekday</option>
                          </InlineSelect>
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
                            <InlineSelect
                              value={Number(editor.trigger_config.weekday || 0)}
                              onChange={(event) => updateConfig({ weekday: Number(event.target.value) })}
                              className="w-[132px]"
                            >
                              {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                            </InlineSelect>
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

                  <div className="px-4 text-[14px] leading-6 text-[#737b86]">
                    <div>Last: {formatDateTime(editor.last_run_at)}</div>
                    <div>Next: {preview.dates.map((date) => formatDateTime(date)).slice(0, 4).join(', ') || formatDateTime(editor.next_run_at)}</div>
                  </div>

                  <FieldGroup>
                    <FieldRow label="Priority">
                      {priorityBars(editor.priority, true)}
                      <InlineSelect
                        value={editor.priority}
                        onChange={(event) => setEditor({ ...editor, priority: event.target.value as TaskPriority })}
                        className="w-[120px]"
                      >
                        {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                      </InlineSelect>
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
                    className="w-full resize-none rounded-[8px] border border-[rgba(15,23,42,0.07)] bg-[#f4f5f2] px-4 py-3 text-[15px] font-[520] text-[#252a32] outline-none placeholder:text-[#8d949d] focus:border-[rgba(15,23,42,0.18)]"
                  />

                  <textarea
                    value={editor.task_template.notes || ''}
                    onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, notes: event.target.value } })}
                    placeholder="Generated task notes or AI prompt context..."
                    rows={4}
                    className="w-full resize-none rounded-[8px] border border-[rgba(15,23,42,0.07)] bg-[#f4f5f2] px-4 py-3 text-[15px] font-[520] text-[#252a32] outline-none placeholder:text-[#8d949d] focus:border-[rgba(15,23,42,0.18)]"
                  />

                  <div className="rounded-[8px] border border-dashed border-[rgba(15,23,42,0.14)] px-4 py-3 text-[13px] text-[#737b86]">
                    <CalendarClock className="mr-2 inline h-4 w-4 align-[-3px]" />
                    {preview.summary || 'No recurrence configured.'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <RotateCw className="mx-auto h-8 w-8 text-[#a0a7b0]" />
                  <div className="mt-3 text-[20px] font-[680] text-[#141922]">Select or create a routine</div>
                  <p className="mt-2 text-[14px] text-[#737b86]">Rules can generate tasks or queue AI workflow runs.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </ReferencePage>
  );
}
