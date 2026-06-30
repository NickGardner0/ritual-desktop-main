'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Check,
  Loader2,
  Play,
  Plus,
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
import { defaultRoutineInput, toRoutineEditor } from '@/lib/tasks/routine-editor';
import {
  HeaderPortal,
  PillButton,
  TaskPageShell,
  ToolbarIconButton,
  UnderlineTabs,
  ViewPills,
} from '@/lib/tasks/task-ui-shell';
import {
  appendDemoRoutineGeneration,
  buildSeedRoutineRuns,
  buildSeedRoutines,
  dedupeById,
  readDemoRoutineRuns,
  subscribeDemoRoutineGeneration,
} from '@/lib/tasks/seed-data';
import type {
  Routine,
  RoutineCreateInput,
  RoutineListResponse,
  RoutineRun,
  RoutineUpdateInput,
} from '@/lib/tasks/types';
import type {
  WorkflowDefinition,
  WorkflowDefinitionListResponse,
  WorkflowDefinitionUpdateInput,
} from '@/lib/workflows/types';
import { cn } from '@/lib/utils';
import {
  RoutineEditorCards,
  RoutineListItem,
  RoutinePanelMenu,
  TemplateIcon,
  runOutputType,
  runStatusClass,
  templateScheduleSummary,
} from './routines-ui';
import { WindowSidePanel } from '@/lib/tasks/window-side-panel';
import { taskContentMaxClass } from '@/lib/tasks/task-ui-shell';

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
  const selectedRoutineId = selectedId;
  const selectedRoutine = selectedRoutineId ? routines.find((routine) => routine.id === selectedRoutineId) || null : null;
  const editor = editorDraft || (selectedRoutine ? toRoutineEditor(selectedRoutine) : null);
  const showListCadence = !editor;

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
  const lastRunText = formatDateTime(editor?.last_run_at || null);
  const completionPreview = editor?.trigger_type === 'on_completion' && preview.dates[0]
    ? `If completed today -> ${formatDateTime(preview.dates[0])}`
    : null;

  const panelOpen = Boolean(editor);

  const closePanel = () => {
    setSelectedId(null);
    setEditor(null);
  };

  return (
    <TaskPageShell>
      {editor ? (
        <HeaderPortal>
          <div className="flex items-center gap-2">
            <PillButton
              onClick={() => generateDueMutation.mutate()}
              disabled={generateDueMutation.isPending}
            >
              {generateDueMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Generate due
            </PillButton>
            <PillButton
              onClick={saveEditor}
              disabled={saveRoutineMutation.isPending}
              className="border-[#27251E] bg-[#27251E] text-white hover:bg-[#1a1916]"
            >
              {saveRoutineMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Save
            </PillButton>
          </div>
        </HeaderPortal>
      ) : null}

      <div className="relative h-full min-h-0">
        <aside className={cn(taskContentMaxClass, 'relative z-0 mx-auto flex h-full min-h-0 w-full flex-col px-6 lg:px-8')}>
          <div className="shrink-0 pb-3 pt-5">
            <div className="flex items-center justify-between gap-3">
              <h1 className="truncate text-[19px] font-medium leading-tight tracking-[-0.01em] text-[#27251E]">
                Routines
              </h1>
              <ToolbarIconButton
                onClick={() => createRoutineMutation.mutate(defaultRoutineInput())}
                disabled={createRoutineMutation.isPending}
                aria-label="New routine"
                title="New routine"
              >
                <Plus className="h-3.5 w-3.5" />
              </ToolbarIconButton>
            </div>
            <UnderlineTabs
              value={activeTab}
              options={ROUTINE_TABS}
              onChange={setActiveTab}
              className="mt-3"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto pb-8">
            {activeTab === 'mine' ? (
              <div className="space-y-0.5">
                {routinesQuery.isLoading ? [0, 1, 2].map((item) => (
                  <div key={item} className="mx-1 h-9 animate-pulse rounded-[6px] bg-[#f3f3f2]" />
                )) : routines.length ? routines.map((routine) => (
                  <RoutineListItem
                    key={routine.id}
                    title={routine.title}
                    cadence={routine.cadence_summary}
                    showCadence={showListCadence}
                    selected={selectedRoutineId === routine.id}
                    onClick={() => {
                      setSelectedId(routine.id);
                      setEditor(toRoutineEditor(routine));
                      setActiveTab('mine');
                    }}
                  />
                )) : (
                  <div className="px-3 py-8 text-center text-[13px] text-[rgba(39,37,30,0.45)]">No routines yet.</div>
                )}
              </div>
            ) : activeTab === 'templates' ? (
              <div className="space-y-3 px-1">
                <ViewPills
                  value={activeTemplateCategory}
                  options={ROUTINE_TEMPLATE_CATEGORIES}
                  onChange={(value) => setActiveTemplateCategory(value as RoutineTemplateCategory)}
                />
                {filteredTemplates.map((template) => {
                  const existing = workflows.find((workflow) => workflow.config?.ai_routine_template_key === template.id);
                  return (
                    <div
                      key={template.id}
                      className="rounded-[6px] border border-[var(--border-subtle)] bg-white px-3 py-3 hover:bg-[#fafaf9]"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[#F3F3F3] text-[#27251E]">
                          <TemplateIcon sourceIcon={template.sourceIcon} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-medium text-[#27251E]">{template.title}</div>
                              <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[rgba(39,37,30,0.55)]">
                                {template.description}
                              </div>
                            </div>
                            {existing ? (
                              <span className="shrink-0 text-[11px] font-medium text-[#2d6a4f]">ready</span>
                            ) : null}
                          </div>
                          <div className="mt-2.5 flex items-center justify-between gap-3">
                            <span className="truncate text-[12px] text-[rgba(39,37,30,0.45)]">
                              {templateScheduleSummary(template)}
                            </span>
                            <button
                              type="button"
                              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-gray-200/90 bg-white px-2 text-[12px] text-[#27251E] shadow-sm hover:bg-[#F5F5F5] disabled:opacity-50"
                              onClick={() => setupAiTemplateMutation.mutate(template)}
                              disabled={setupAiTemplateMutation.isPending}
                            >
                              {setupAiTemplateMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3" />
                              )}
                              Set up
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {workflows.length ? (
                  <div className="space-y-0.5 border-t border-[var(--border-subtle)] pt-3">
                    {workflows.slice(0, 6).map((workflow) => (
                      <button
                        key={workflow.id}
                        type="button"
                        className="ritual-snappy-row flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left hover:bg-[#f6f6f5]"
                        onClick={() => createRoutineMutation.mutate(workflowRoutineInput(workflow))}
                        disabled={createRoutineMutation.isPending}
                      >
                        <Bot className="h-4 w-4 shrink-0 text-[rgba(39,37,30,0.45)]" />
                        <span className="min-w-0 truncate text-[14px] font-medium text-[#27251E]">{workflow.name}</span>
                        <Sparkles className="ml-auto h-3.5 w-3.5 shrink-0 text-[rgba(39,37,30,0.35)]" />
                      </button>
                    ))}
                  </div>
                ) : workflowsQuery.isLoading ? (
                  <div className="px-3 py-8 text-center text-[13px] text-[rgba(39,37,30,0.45)]">
                    Workflow templates are loading.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-0.5 px-1">
                {displayRuns.map((run) => {
                  const routine = routineById.get(run.routine_id);
                  return (
                    <div
                      key={run.id}
                      className="rounded-[6px] px-2.5 py-2.5 hover:bg-[#f6f6f5]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-[14px] font-medium text-[#27251E]">
                          {routine?.title || 'Routine run'}
                        </span>
                        <span className={cn('shrink-0 text-[12px] font-medium', runStatusClass(run.status))}>
                          {run.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[12px] text-[rgba(39,37,30,0.45)]">
                        {formatDateTime(run.scheduled_for)} · {runOutputType(run)}
                      </div>
                    </div>
                  );
                })}
                {!displayRuns.length && (
                  <div className="px-3 py-8 text-center text-[13px] text-[rgba(39,37,30,0.45)]">No routine runs yet.</div>
                )}
              </div>
            )}
          </div>
        </aside>

        {panelOpen ? (
          <button
            type="button"
            className="absolute inset-0 z-10 bg-[#f7f6f2]/45 transition-opacity duration-300"
            onClick={closePanel}
            aria-label="Close routine panel"
          />
        ) : null}

        <WindowSidePanel
          open={panelOpen}
          onClose={closePanel}
          title="Routine"
          headerActions={<RoutinePanelMenu />}
        >
          {editor ? (
            <div className="px-5 py-5 lg:px-6">
              <input
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                className="mb-5 w-full bg-transparent text-[20px] font-medium leading-tight tracking-[-0.01em] text-[#27251E] outline-none placeholder:text-[rgba(39,37,30,0.35)]"
                placeholder="Routine title"
              />

              <RoutineEditorCards
                editor={editor}
                setEditor={setEditor}
                updateConfig={updateConfig}
                editorTimeValue={editorTimeValue}
                completionPreview={completionPreview}
                nextPreviewText={nextPreviewText}
                lastRunText={lastRunText}
              />
            </div>
          ) : null}
        </WindowSidePanel>
      </div>
    </TaskPageShell>
  );
}
