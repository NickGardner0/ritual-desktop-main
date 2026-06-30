'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CalendarDays,
  Check,
  ChevronsRight,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { useTaskRoutineOutboxSync } from '@/hooks/use-task-routine-outbox-sync';
import { apiJsonWithAuth } from '@/lib/api/client';
import {
  putLocalVaultRoutine,
  putLocalVaultTaskRoutineWriteOutboxItem,
  readLocalVaultRoutineRuns,
  readLocalVaultRoutines,
  readLocalVaultTaskRoutineWriteOutboxItems,
} from '@/lib/privacy/task-vault-adapter';
import {
  AI_ROUTINE_TEMPLATES,
  ROUTINE_TEMPLATE_CATEGORIES,
  workflowPayloadForTemplate,
  workflowRoutineInput,
  type AiRoutineTemplate,
  type RoutineTemplateCategory,
} from '@/lib/tasks/ai-routine-templates';
import { formatDateTime } from '@/lib/tasks/date-format';
import {
  buildOptimisticRoutine,
  buildOptimisticRoutineUpdate,
  buildRoutineCreateOutboxItem,
  buildRoutineUpdateOutboxItem,
  mergeRoutinesWithOutbox,
} from '@/lib/tasks/local-first-writes';
import { nextRoutineDates, summarizeRecurrence } from '@/lib/tasks/recurrence';
import { PRIORITIES, defaultRoutineInput, toRoutineEditor } from '@/lib/tasks/routine-editor';
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
import {
  appendDemoRoutineGeneration,
  buildSeedRoutineRuns,
  buildSeedRoutines,
  dedupeById,
  readDemoRoutineRuns,
  relativeDayLabel,
  subscribeDemoRoutineGeneration,
} from '@/lib/tasks/seed-data';
import type {
  Routine,
  RoutineCreateInput,
  RoutineListResponse,
  RoutineRun,
  RoutineUpdateInput,
  TaskPriority,
} from '@/lib/tasks/types';
import type {
  WorkflowDefinition,
  WorkflowDefinitionListResponse,
  WorkflowDefinitionUpdateInput,
} from '@/lib/workflows/types';
import { cn } from '@/lib/utils';
import {
  RoutineRecurrenceFields,
  TemplateIcon,
  routineKindLabel,
  runOutputType,
  runStatusClass,
  templateScheduleSummary,
} from './routines-ui';

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
  const [activeTemplateCategory, setActiveTemplateCategory] = useState<RoutineTemplateCategory>('Suggested');
  const [demoRuns, setDemoRuns] = useState<RoutineRun[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    const refreshDemoRuns = () => setDemoRuns(readDemoRoutineRuns(user.id));
    refreshDemoRuns();
    return subscribeDemoRoutineGeneration(refreshDemoRuns);
  }, [user?.id]);

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
      const merged = mergeRoutinesWithOutbox(backendItems || vaultItems || [], outboxItems);
      return merged.length ? merged : buildSeedRoutines(user?.id || 'visual-seed');
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
    queryKey: ['routine-runs', user?.id],
    queryFn: async () => {
      let backendRuns: RoutineRun[] | null = null;
      try {
        backendRuns = await apiJsonWithAuth<RoutineRun[]>('/api/routines/runs?limit=50', getToken, { userId: user?.id });
      } catch (error) {
        console.warn('[Routines] Backend routine run read failed; using local fallback', error);
      }
      const vaultRuns = user?.id && !backendRuns ? await readLocalVaultRoutineRuns(user.id) : null;
      const runs = backendRuns || vaultRuns || [];
      return runs.length ? runs : buildSeedRoutineRuns(user?.id || 'visual-seed', routines.length ? routines : undefined);
    },
    enabled: Boolean(user?.id),
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
    mutationFn: async () => {
      try {
        return await apiJsonWithAuth<{ generated_tasks?: number; generated_scheduled_blocks?: number; generated_workflow_runs?: number }>(
          '/api/routines/generate-due?horizon_days=7',
          getToken,
          { method: 'POST', userId: user?.id },
        );
      } catch (error) {
        console.warn('[Routines] Backend routine generation failed; using local visual fallback', error);
        return { generated_tasks: 0, generated_scheduled_blocks: 0, generated_workflow_runs: 0 };
      }
    },
    onSuccess: (response) => {
      const generatedCount = Number(response.generated_tasks || 0)
        + Number(response.generated_scheduled_blocks || 0)
        + Number(response.generated_workflow_runs || 0);
      if (generatedCount === 0 && user?.id) {
        appendDemoRoutineGeneration(user.id, editor || selectedRoutine || routines[0]);
        setDemoRuns(readDemoRoutineRuns(user.id));
        toast.success('Generated a local due run and task.');
      } else {
        toast.success('Due routines generated.');
      }
      void queryClient.invalidateQueries({ queryKey: ['routines', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['routine-runs', user?.id] });
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
  const routineById = useMemo(() => new Map(routines.map((routine) => [routine.id, routine])), [routines]);
  const displayRuns = useMemo(() => {
    const runs = dedupeById([...(demoRuns || []), ...(runsQuery.data || [])]);
    return runs.slice().sort((a, b) => new Date(b.scheduled_for).getTime() - new Date(a.scheduled_for).getTime());
  }, [demoRuns, runsQuery.data]);
  const filteredTemplates = useMemo(() => {
    if (activeTemplateCategory === 'Suggested') {
      return AI_ROUTINE_TEMPLATES.filter((template) => template.category === 'Suggested').concat(
        AI_ROUTINE_TEMPLATES.filter((template) => template.category !== 'Suggested').slice(0, 4),
      );
    }
    return AI_ROUTINE_TEMPLATES.filter((template) => template.category === activeTemplateCategory);
  }, [activeTemplateCategory]);

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
  const editorTimeValue = editor
    ? `${String(Number(editor.trigger_config.hour || 9)).padStart(2, '0')}:${String(Number(editor.trigger_config.minute || 0)).padStart(2, '0')}`
    : '09:00';
  const nextPreviewText = preview.dates.map((date) => formatDateTime(date)).slice(0, 4).join(', ') || formatDateTime(editor?.next_run_at || null);
  const completionPreview = editor?.trigger_type === 'on_completion' && preview.dates[0]
    ? `If completed today -> ${formatDateTime(preview.dates[0])}`
    : null;

  return (
    <ReferencePage>
      <div className="grid h-full min-h-0 grid-cols-[minmax(330px,410px)_minmax(520px,1fr)]">
        <aside className={cn('flex min-h-0 flex-col border-r bg-[#fbfcfd]', subtleBorderClass)}>
          <div className="shrink-0 px-5 pb-4 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-[700] uppercase text-[#737b86]">Ritual rules</div>
                <h1 className="mt-2 truncate text-[34px] font-[700] leading-none text-[#10141d]">Routines</h1>
              </div>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#111827] px-3 text-[13px] font-[650] text-white transition hover:bg-[#202938] disabled:opacity-55"
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
                  <div key={item} className="h-14 animate-pulse rounded-[7px] bg-[#edf0f4]" />
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
                      'grid w-full grid-cols-[22px_minmax(0,1fr)] gap-2.5 rounded-[7px] px-3 py-2.5 text-left transition',
                      selectedRoutineId === routine.id ? 'bg-[#e9eef6]' : 'hover:bg-[#eef1f5]',
                    )}
                  >
                    <RotateCw className="mt-0.5 h-4 w-4 text-[#69727d]" />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-[700] text-[#1f242d]">{routine.title}</span>
                      <span className="mt-1 flex items-center justify-between gap-3 text-[12px] font-[600] text-[#737b86]">
                        <span className="truncate">{routine.cadence_summary}</span>
                        <span className={cn('shrink-0', routine.status === 'paused' ? 'text-[#956d2c]' : 'text-[#1f6c47]')}>{routine.status}</span>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-3 text-[11px] font-[650] text-[#8a929d]">
                        <span>{routineKindLabel(routine.kind)}</span>
                        <span>{relativeDayLabel(routine.next_run_at)}</span>
                      </span>
                    </span>
                  </button>
                )) : (
                  <div className="px-3 py-8 text-center text-[14px] text-[#737b86]">No routines yet.</div>
                )}
              </div>
            ) : activeTab === 'templates' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5 px-1">
                  {ROUTINE_TEMPLATE_CATEGORIES.map((categoryName) => (
                    <button
                      key={categoryName}
                      type="button"
                      onClick={() => setActiveTemplateCategory(categoryName)}
                      className={cn(
                        'h-7 rounded-[6px] px-2.5 text-[12px] font-[650] transition',
                        activeTemplateCategory === categoryName ? 'bg-[#111827] text-white' : 'bg-[#eef1f5] text-[#65707c] hover:bg-[#e4e9f0]',
                      )}
                    >
                      {categoryName}
                    </button>
                  ))}
                </div>
                {filteredTemplates.map((template) => {
                  const existing = workflows.find((workflow) => workflow.config?.ai_routine_template_key === template.id);
                  return (
                    <div key={template.id} className="rounded-[7px] border border-[rgba(15,23,42,0.08)] bg-white/78 px-3 py-3 transition hover:bg-white">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#eef1f5] text-[#20242c]">
                          <TemplateIcon sourceIcon={template.sourceIcon} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-[700] text-[#1f242d]">{template.title}</div>
                              <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#737b86]">{template.description}</div>
                            </div>
                            {existing ? <span className="shrink-0 text-[12px] font-[700] text-[#1f6c47]">ready</span> : null}
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="truncate text-[12px] font-[600] text-[#737b86]">{templateScheduleSummary(template)}</span>
                            <button
                              type="button"
                              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border border-[rgba(15,23,42,0.10)] bg-white/90 px-2.5 text-[12px] font-[700] text-[#2f3743] hover:bg-[#f6f8fa] disabled:opacity-55"
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
                        className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] gap-3 rounded-[7px] px-3 py-2.5 text-left transition hover:bg-[#eef1f5]"
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
                {displayRuns.map((run) => {
                  const routine = routineById.get(run.routine_id);
                  return (
                    <div key={run.id} className="rounded-[7px] px-3 py-2.5 transition hover:bg-[#eef1f5]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[14px] font-[700] text-[#1f242d]">{routine?.title || 'Routine run'}</span>
                      <span className={cn('shrink-0 text-[12px] font-[700]', runStatusClass(run.status))}>{run.status}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[12px] font-[600] text-[#737b86]">
                      <span className="truncate">Scheduled {formatDateTime(run.scheduled_for)}</span>
                      <span className="shrink-0">{run.created_at ? `Generated ${formatDateTime(run.created_at)}` : runOutputType(run)}</span>
                    </div>
                    <div className="mt-1 text-[11px] font-[650] uppercase text-[#8a929d]">Output: {runOutputType(run)}</div>
                  </div>
                  );
                })}
                {!displayRuns.length && <div className="px-3 py-8 text-center text-[14px] text-[#737b86]">No routine runs yet.</div>}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-[#f7f8fa]">
          <div className={cn('flex h-12 shrink-0 items-center border-b bg-[#fbfcfd] px-6', subtleBorderClass)}>
            <ChevronsRight className="h-4 w-4 text-[#8a929c]" />
            <div className="min-w-0 flex-1 text-center text-[13px] font-[700] text-[#737b86]">Routine</div>
            <IconButton className="h-7 w-7">
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-7 py-6">
            {editor ? (
              <div className="mx-auto max-w-[780px]">
                <div className="mb-5 flex items-start justify-between gap-5">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-[11px] font-[700] uppercase text-[#8a929d]">{routineKindLabel(editor.kind)}</div>
                    <input
                      value={editor.title}
                      onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                      className="min-w-0 w-full bg-transparent text-[32px] font-[700] leading-tight text-[#111827] outline-none"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[rgba(15,23,42,0.10)] bg-white/86 px-3 text-[13px] font-[700] text-[#2f3743] hover:bg-white disabled:opacity-55"
                      onClick={() => generateDueMutation.mutate()}
                      disabled={generateDueMutation.isPending}
                    >
                      {generateDueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Generate due
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#111827] px-3 text-[13px] font-[700] text-white hover:bg-[#202938] disabled:opacity-55"
                      onClick={saveEditor}
                      disabled={saveRoutineMutation.isPending}
                    >
                      {saveRoutineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Save
                    </button>
                  </div>
                </div>

                <div className="space-y-3.5">
                  <RoutineRecurrenceFields
                    editor={editor}
                    setEditor={setEditor}
                    updateConfig={updateConfig}
                    editorTimeValue={editorTimeValue}
                    completionPreview={completionPreview}
                  />

                  <FieldGroup>
                    <FieldRow label="Last">
                      <span className="text-[13px] font-[650] text-[#737b86]">{formatDateTime(editor.last_run_at)}</span>
                    </FieldRow>
                    <FieldRow label="Next">
                      <span className="max-w-[440px] truncate text-[13px] font-[650] text-[#2f3743]">{nextPreviewText}</span>
                    </FieldRow>
                    <FieldRow label="Summary">
                      <span className="max-w-[440px] truncate text-[13px] font-[650] text-[#737b86]">{preview.summary || 'No recurrence configured.'}</span>
                    </FieldRow>
                  </FieldGroup>

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
                  </FieldGroup>

                  <textarea
                    value={editor.description || ''}
                    onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                    placeholder="Routine notes..."
                    rows={3}
                    className="w-full resize-none rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-[#f3f5f7] px-4 py-3 text-[14px] font-[560] text-[#252a32] outline-none placeholder:text-[#8d949d] focus:border-[rgba(15,23,42,0.18)]"
                  />

                  <textarea
                    value={editor.task_template.notes || ''}
                    onChange={(event) => setEditor({ ...editor, task_template: { ...editor.task_template, notes: event.target.value } })}
                    placeholder="Generated task notes or AI prompt context..."
                    rows={3}
                    className="w-full resize-none rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-[#f3f5f7] px-4 py-3 text-[14px] font-[560] text-[#252a32] outline-none placeholder:text-[#8d949d] focus:border-[rgba(15,23,42,0.18)]"
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <CalendarDays className="mx-auto h-8 w-8 text-[#a0a7b0]" />
                  <div className="mt-3 text-[18px] font-[700] text-[#141922]">Select or create a routine</div>
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
