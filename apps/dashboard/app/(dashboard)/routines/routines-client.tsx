'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Library, Plus, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTaskRoutineOutboxSync } from '@/hooks/use-task-routine-outbox-sync';
import { apiJsonWithAuth } from '@/lib/api/client';
import {
  putLocalVaultRoutine,
  readLocalVaultRoutines,
  readLocalVaultTaskRoutineWriteOutboxItems,
} from '@/lib/privacy/task-vault-adapter';
import { mergeRoutinesWithOutbox } from '@/lib/tasks/local-first-writes';
import {
  ALL_DATA_SOURCE_KEYS,
  buildAgentRoutineInput,
  currentTimezone,
  defaultScheduleDraft,
  endsAtFromDraft,
  firstRunAtFromDraft,
  joinAgentRoutines,
  scheduleDraftFromRoutine,
  sharedDefinitionId,
  triggerConfigWithAgent,
  type AgentRoutine,
  type RoutineAgentConfig,
  type ScheduleDraft,
} from '@/lib/routines/model';
import { sendRoutineNotification } from '@/lib/routines/notifications';
import { buildRunViews, type RoutineRunView } from '@/lib/routines/runs';
import { templateById } from '@/lib/routines/templates';
import { useNow } from '@/lib/routines/time';
import { ReferencePage, subtleBorderClass } from '@/lib/tasks/reference-task-shell';
import type { Routine, RoutineListResponse, RoutineRun, RoutineUpdateInput } from '@/lib/tasks/types';
import type {
  WorkflowDefinitionListResponse,
  WorkflowRun,
  WorkflowRunListResponse,
} from '@/lib/workflows/types';
import { cn } from '@/lib/utils';

import { RoutineDetail } from './routine-detail';
import { RoutineList } from './routine-list';
import { RunHistory } from './routine-runs';
import { TemplateLibrary } from './routine-templates';

export function RoutinesClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const router = useRouter();
  useTaskRoutineOutboxSync();
  const now = useNow(30_000);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllRuns, setShowAllRuns] = useState(false);

  const routinesKey = useMemo(() => ['routines', user?.id] as const, [user?.id]);

  const routinesQuery = useQuery({
    queryKey: routinesKey,
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
        : ([null, null] as const);
      return mergeRoutinesWithOutbox(backendItems || vaultItems || [], outboxItems);
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
  });

  const definitionsQuery = useQuery({
    queryKey: ['workflow-definitions', 'routines-page'],
    queryFn: async () => (await apiJsonWithAuth<WorkflowDefinitionListResponse>('/api/workflows/definitions', getToken, { userId: user?.id })).items,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });

  const routines = useMemo(() => (routinesQuery.data || []).filter((routine) => routine.status !== 'archived'), [routinesQuery.data]);
  const agentRoutines = useMemo(() => joinAgentRoutines(routines), [routines]);

  const workflowRunsQuery = useQuery({
    queryKey: ['workflow-runs', 'routines-page', user?.id],
    queryFn: async () => (await apiJsonWithAuth<WorkflowRunListResponse>('/api/workflows/runs?limit=100', getToken, { userId: user?.id })).items,
    enabled: Boolean(user?.id),
    refetchInterval: (query) => {
      const items = (query.state.data || []) as WorkflowRun[];
      return items.some((run) => run.status === 'queued' || run.status === 'processing') ? 2_000 : 30_000;
    },
  });

  const routineRunsQuery = useQuery({
    queryKey: ['routine-runs', 'routines-page', user?.id],
    queryFn: () => apiJsonWithAuth<RoutineRun[]>('/api/routines/runs?limit=100', getToken, { userId: user?.id }),
    enabled: Boolean(user?.id),
    staleTime: 15_000,
  });

  const runViews = useMemo(
    () => buildRunViews({
      workflowRuns: workflowRunsQuery.data || [],
      routineRuns: routineRunsQuery.data || [],
      agentRoutines,
    }),
    [workflowRunsQuery.data, routineRunsQuery.data, agentRoutines],
  );

  const lastRunByRoutine = useMemo(() => {
    const map = new Map<string, RoutineRunView>();
    for (const run of runViews) {
      if (run.routineId && !map.has(run.routineId)) map.set(run.routineId, run);
    }
    return map;
  }, [runViews]);

  const runningRoutineIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of runViews) {
      if (run.routineId && (run.status === 'queued' || run.status === 'running')) ids.add(run.routineId);
    }
    return ids;
  }, [runViews]);

  // Notify when a run finishes (transition-only; the first snapshot is skipped).
  const seenRunStatuses = useRef<Map<string, RoutineRunView['status']> | null>(null);
  useEffect(() => {
    const current = new Map(runViews.map((run) => [run.id, run.status]));
    const previous = seenRunStatuses.current;
    seenRunStatuses.current = current;
    if (!previous) return;
    for (const run of runViews) {
      const before = previous.get(run.id);
      if (!before || before === run.status) continue;
      if (run.status === 'succeeded') {
        toast.success(`${run.routineName} finished`, run.artifactId ? {
          action: { label: 'Open report', onClick: () => router.push(`/reports?artifactId=${run.artifactId}`) },
        } : undefined);
        const owner = agentRoutines.find((item) => item.routine.id === run.routineId);
        if (owner?.agent.notify_push) {
          sendRoutineNotification(run.routineName, 'A new report is ready in Ritual.');
        }
      } else if (run.status === 'failed') {
        toast.error(`${run.routineName} failed`, { description: run.error || undefined });
      }
    }
  }, [runViews, agentRoutines, router]);

  const selectedRoutineId = selectedId && routines.some((routine) => routine.id === selectedId)
    ? selectedId
    : routines[0]?.id || null;
  const selectedItem = agentRoutines.find((item) => item.routine.id === selectedRoutineId) || null;

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: routinesKey });
    void queryClient.invalidateQueries({ queryKey: ['workflow-definitions', 'routines-page'] });
    void queryClient.invalidateQueries({ queryKey: ['workflow-runs', 'routines-page', user?.id] });
    void queryClient.invalidateQueries({ queryKey: ['routine-runs', 'routines-page', user?.id] });
  }, [queryClient, routinesKey, user?.id]);

  // --- Optimistic routine patching -------------------------------------------------

  const patchRoutineCache = useCallback((id: string, patch: Partial<Routine>) => {
    queryClient.setQueryData<Routine[]>(routinesKey, (current) =>
      (current || []).map((routine) => (routine.id === id ? { ...routine, ...patch } : routine)));
  }, [queryClient, routinesKey]);

  const patchRoutineMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: RoutineUpdateInput; optimistic?: Partial<Routine> }) =>
      apiJsonWithAuth<RoutineListResponse>(`/api/routines/${id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        userId: user?.id,
      }),
    onMutate: async ({ id, optimistic }) => {
      await queryClient.cancelQueries({ queryKey: routinesKey });
      const previous = queryClient.getQueryData<Routine[]>(routinesKey);
      if (optimistic) patchRoutineCache(id, optimistic);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(routinesKey, context.previous);
      toast.error(error instanceof Error ? error.message : 'Could not update the routine.');
    },
    onSuccess: (response) => {
      const routine = response.items[0];
      if (routine && user?.id) void putLocalVaultRoutine(user.id, routine).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: routinesKey });
    },
  });

  const togglePause = (item: AgentRoutine) => {
    const paused = item.routine.status === 'paused';
    patchRoutineMutation.mutate({
      id: item.routine.id,
      patch: { status: paused ? 'scheduled' : 'paused' },
      optimistic: { status: paused ? 'scheduled' : 'paused' },
    });
  };

  const renameRoutine = (item: AgentRoutine, name: string) => {
    const draft = scheduleDraftFromRoutine(item.routine);
    patchRoutineMutation.mutate({
      id: item.routine.id,
      patch: {
        title: name,
        trigger_config: triggerConfigWithAgent(draft, item.agent, name),
      },
      optimistic: {
        title: name,
        trigger_config: triggerConfigWithAgent(draft, item.agent, name),
      },
    });
  };

  // Inline detail edits: schedule fields and agent settings save immediately.
  const saveSchedule = (item: AgentRoutine, draft: ScheduleDraft) => {
    const patch: RoutineUpdateInput = {
      trigger_type: draft.frequency,
      trigger_config: triggerConfigWithAgent(draft, item.agent, item.routine.title),
      first_run_at: firstRunAtFromDraft(draft),
      ends_at: endsAtFromDraft(draft),
    };
    patchRoutineMutation.mutate({
      id: item.routine.id,
      patch,
      optimistic: patch as Partial<Routine>,
    });
  };

  const saveAgent = (item: AgentRoutine, agentPatch: Partial<RoutineAgentConfig>) => {
    const agent = { ...item.agent, ...agentPatch };
    const draft = scheduleDraftFromRoutine(item.routine);
    const patch: RoutineUpdateInput = {
      description: agent.instructions,
      trigger_config: triggerConfigWithAgent(draft, agent, item.routine.title),
    };
    patchRoutineMutation.mutate({
      id: item.routine.id,
      patch,
      optimistic: patch as Partial<Routine>,
    });
  };

  const saveMeta = (item: AgentRoutine, patch: { priority?: Routine['priority']; tags?: string[] }) => {
    patchRoutineMutation.mutate({
      id: item.routine.id,
      patch,
      optimistic: patch as Partial<Routine>,
    });
  };

  const deleteRoutine = (item: AgentRoutine) => {
    const previousStatus = item.routine.status;
    queryClient.setQueryData<Routine[]>(routinesKey, (current) =>
      (current || []).filter((routine) => routine.id !== item.routine.id));
    void apiJsonWithAuth(`/api/routines/${item.routine.id}`, getToken, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' } satisfies RoutineUpdateInput),
      userId: user?.id,
    }).catch(() => {
      toast.error('Could not delete the routine.');
      void queryClient.invalidateQueries({ queryKey: routinesKey });
    });
    toast('Routine deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          void apiJsonWithAuth(`/api/routines/${item.routine.id}`, getToken, {
            method: 'PATCH',
            body: JSON.stringify({ status: previousStatus } satisfies RoutineUpdateInput),
            userId: user?.id,
          }).then(() => invalidateAll()).catch(() => toast.error('Could not restore the routine.'));
        },
      },
    });
  };

  // --- Create / duplicate -----------------------------------------------------------

  const resolveDefinitionId = useCallback(async (templateKey?: string | null) => {
    const template = templateById(templateKey || null);
    const cached = definitionsQuery.data
      || (await apiJsonWithAuth<WorkflowDefinitionListResponse>('/api/workflows/definitions', getToken, { userId: user?.id })).items;
    return sharedDefinitionId(cached, template?.workflowKind || 'daily_narrative');
  }, [definitionsQuery.data, getToken, user?.id]);

  const createRoutineMutation = useMutation({
    mutationFn: async ({ templateKey, source }: { templateKey?: string | null; source?: AgentRoutine }) => {
      const template = templateById(templateKey || source?.agent.template_key || null);
      const definitionId = source?.routine.ai_workflow_definition_id || await resolveDefinitionId(template?.id || null);
      if (!definitionId) throw new Error('Could not prepare the agent for this routine — check the backend connection.');

      const draft = source ? scheduleDraftFromRoutine(source.routine) : template ? { ...defaultScheduleDraft(), ...template.schedule } : defaultScheduleDraft();
      const name = source ? `${source.routine.title} copy` : template?.title || 'Untitled routine';
      const agent: RoutineAgentConfig = source ? {
        ...source.agent,
        template_key: source.agent.template_key,
      } : {
        instructions: template?.instructions || '',
        agent_tier: 'regular',
        data_sources: template ? [...template.dataSources] : [...ALL_DATA_SOURCE_KEYS],
        notify_push: true,
        notify_email: false,
        icon: template?.icon || 'sparkles',
        template_key: template?.id || null,
      };

      const response = await apiJsonWithAuth<RoutineListResponse>('/api/routines', getToken, {
        method: 'POST',
        body: JSON.stringify(buildAgentRoutineInput({
          name,
          agent,
          draft,
          timezone: currentTimezone(),
          definitionId,
          tags: source ? source.routine.tags : ['ai'],
        })),
        userId: user?.id,
      });
      return response.items[0] || null;
    },
    onSuccess: (routine) => {
      invalidateAll();
      if (routine) {
        setSelectedId(routine.id);
        if (user?.id) void putLocalVaultRoutine(user.id, routine).catch(() => undefined);
      }
      toast.success('Routine created');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not create the routine.'),
  });

  // --- Run now ----------------------------------------------------------------------

  const runNowMutation = useMutation({
    mutationFn: async (item: AgentRoutine) => {
      if (!item.routine.ai_workflow_definition_id) {
        throw new Error('This routine has no agent attached yet — edit it and save to attach one.');
      }
      return apiJsonWithAuth<RoutineRun>(`/api/routines/${item.routine.id}/run-now`, getToken, {
        method: 'POST',
        userId: user?.id,
      });
    },
    onSuccess: (run) => {
      queryClient.setQueryData<RoutineRun[]>(['routine-runs', 'routines-page', user?.id], (current) =>
        [run, ...(current || []).filter((item) => item.id !== run.id)]);
      void queryClient.invalidateQueries({ queryKey: ['routine-runs', 'routines-page', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs', 'routines-page', user?.id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not start the run.'),
  });

  const retryRun = (run: RoutineRunView) => {
    const item = agentRoutines.find((candidate) => candidate.routine.id === run.routineId);
    if (item) runNowMutation.mutate(item);
  };

  // --- Keyboard shortcuts ------------------------------------------------------------

  const createBlankRoutine = useCallback(() => {
    createRoutineMutation.mutate({ templateKey: null });
  }, [createRoutineMutation]);

  const duplicateRoutine = (item: AgentRoutine) => {
    createRoutineMutation.mutate({ source: item });
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createBlankRoutine();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [createBlankRoutine]);

  // --- Rendering ---------------------------------------------------------------------

  const listActions = {
    onSelect: (id: string) => setSelectedId(id),
    onRunNow: (item: AgentRoutine) => runNowMutation.mutate(item),
    onTogglePause: togglePause,
    onDuplicate: duplicateRoutine,
    onViewRuns: (item: AgentRoutine) => {
      setSelectedId(item.routine.id);
      setShowAllRuns(false);
    },
    onDelete: deleteRoutine,
  };

  const scopedRunViews = selectedRoutineId ? runViews.filter((run) => run.routineId === selectedRoutineId) : [];
  const hasRoutines = routines.length > 0;
  const installedTemplateKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of agentRoutines) {
      if (item.agent.template_key) keys.add(item.agent.template_key);
    }
    return keys;
  }, [agentRoutines]);

  return (
    <ReferencePage className="bg-white">
      <div className="grid h-full min-h-0 grid-cols-1 bg-white md:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <aside className={cn('flex min-h-0 flex-col border-r bg-white', subtleBorderClass)}>
          <header className={cn('flex h-[86px] shrink-0 items-end justify-between border-b px-6 pb-5', subtleBorderClass)}>
            <h1 className="text-[32px] font-[690] leading-none tracking-[-0.025em] text-[#111318]">Routines</h1>
            <div className="flex items-center gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title="Templates"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-[#717883] transition hover:bg-[#f6f6f3] hover:text-[#171b22]"
                  >
                    <Library className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="max-h-[620px] w-[760px] overflow-auto border-[rgba(15,23,42,0.10)] bg-white p-4">
                  <TemplateLibrary
                    heading={null}
                    installedTemplateKeys={installedTemplateKeys}
                    onSetUp={(template) => createRoutineMutation.mutate({ templateKey: template.id })}
                  />
                </PopoverContent>
              </Popover>
              <button
                type="button"
                title="Run history"
                onClick={() => setShowAllRuns((value) => !value)}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-[#717883] transition hover:bg-[#f6f6f3] hover:text-[#171b22]',
                  showAllRuns && 'bg-[#f0f1ed] text-[#171b22]',
                )}
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="New routine (⌘N)"
                disabled={createRoutineMutation.isPending}
                onClick={createBlankRoutine}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-[#717883] transition hover:bg-[#f6f6f3] hover:text-[#171b22] disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
            {routinesQuery.isLoading ? (
              <div className="space-y-1.5">
                {[0, 1, 2, 3].map((item) => <div key={item} className="h-[58px] animate-pulse rounded-[7px] bg-[#f6f6f3]" />)}
              </div>
            ) : hasRoutines ? (
              <RoutineList
                items={agentRoutines}
                selectedId={selectedRoutineId}
                now={now}
                runningRoutineIds={runningRoutineIds}
                lastRunByRoutine={lastRunByRoutine}
                actions={listActions}
              />
            ) : (
              <div className="px-3 py-8">
                <p className="text-[13px] leading-5 text-[#7b828c]">No routines yet.</p>
                <button
                  type="button"
                  onClick={createBlankRoutine}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[#111827] px-3 text-[13px] font-[650] text-white transition hover:bg-[#202938]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New routine
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto bg-white px-5 py-6 md:px-10 md:py-9">
          {showAllRuns ? (
            <div className="mx-auto max-w-[700px]">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-[21px] font-[650] tracking-[-0.02em] text-[#15181e]">Run history</h2>
                <button
                  type="button"
                  onClick={() => setShowAllRuns(false)}
                  className="h-8 rounded-[7px] px-2.5 text-[13px] font-[600] text-[#717883] transition hover:bg-[#f6f6f3] hover:text-[#171b22]"
                >
                  Detail
                </button>
              </div>
              <RunHistory runs={runViews} now={now} onRetry={retryRun} />
            </div>
          ) : selectedItem ? (
            <RoutineDetail
              item={selectedItem}
              now={now}
              runs={scopedRunViews}
              running={runningRoutineIds.has(selectedItem.routine.id)}
              onRename={renameRoutine}
              onTogglePause={togglePause}
              onRunNow={(item) => runNowMutation.mutate(item)}
              onDuplicate={duplicateRoutine}
              onDelete={deleteRoutine}
              onRetryRun={retryRun}
              onSaveSchedule={saveSchedule}
              onSaveAgent={saveAgent}
              onSaveMeta={saveMeta}
            />
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center text-center">
              <div>
                <RotateCw className="mx-auto h-7 w-7 text-[#a0a7b0]" />
                <div className="mt-3 text-[18px] font-[650] text-[#141922]">Select a routine</div>
                <p className="mt-2 text-[13px] text-[#737b86]">Pick a routine to edit its schedule and agent.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </ReferencePage>
  );
}
