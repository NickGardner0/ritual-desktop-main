'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

import { useTaskRoutineOutboxSync } from '@/hooks/use-task-routine-outbox-sync';
import { apiJsonWithAuth } from '@/lib/api/client';
import {
  putLocalVaultRoutine,
  readLocalVaultRoutines,
  readLocalVaultTaskRoutineWriteOutboxItems,
} from '@/lib/privacy/task-vault-adapter';
import { mergeRoutinesWithOutbox } from '@/lib/tasks/local-first-writes';
import {
  buildAgentRoutineInput,
  buildAgentRoutineUpdateInput,
  currentTimezone,
  joinAgentRoutines,
  nameFromInstructions,
  sharedDefinitionId,
  type AgentRoutine,
} from '@/lib/routines/model';
import { sendRoutineNotification } from '@/lib/routines/notifications';
import { buildRunViews, type RoutineRunView } from '@/lib/routines/runs';
import { templateById } from '@/lib/routines/templates';
import { useNow } from '@/lib/routines/time';
import { ReferencePage, SegmentedTabs, subtleBorderClass } from '@/lib/tasks/reference-task-shell';
import type { Routine, RoutineListResponse, RoutineRun, RoutineUpdateInput } from '@/lib/tasks/types';
import type {
  WorkflowDefinitionListResponse,
  WorkflowRun,
  WorkflowRunListResponse,
} from '@/lib/workflows/types';
import { cn } from '@/lib/utils';

import {
  RoutineConfigureModal,
  configureStateFromRoutine,
  configureStateFromTemplate,
  type RoutineConfigureState,
} from './routine-configure-modal';
import { RoutineDetail } from './routine-detail';
import { RoutineList } from './routine-list';
import { RunHistory } from './routine-runs';
import { RoutinesEmptyHero, TemplateLibrary } from './routine-templates';

const ROUTINE_TABS = [
  { id: 'mine', label: 'Mine' },
  { id: 'templates', label: 'Templates' },
  { id: 'runs', label: 'Runs' },
] as const;

type RoutineTab = (typeof ROUTINE_TABS)[number]['id'];

type ModalState = {
  open: boolean;
  mode: 'create' | 'edit';
  initial: RoutineConfigureState;
  editing: AgentRoutine | null;
};

const closedModal = (): ModalState => ({
  open: false,
  mode: 'create',
  initial: configureStateFromTemplate(null),
  editing: null,
});

export function RoutinesClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const router = useRouter();
  useTaskRoutineOutboxSync();
  const now = useNow(30_000);

  const [activeTab, setActiveTab] = useState<RoutineTab>('mine');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runsFilter, setRunsFilter] = useState<string>('all');
  const [modal, setModal] = useState<ModalState>(closedModal);

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
    patchRoutineMutation.mutate({
      id: item.routine.id,
      patch: { title: name },
      optimistic: { title: name },
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

  // --- Create / save through the configure modal -----------------------------------

  const submitModalMutation = useMutation({
    mutationFn: async ({ state, editing }: { state: RoutineConfigureState; editing: AgentRoutine | null }) => {
      const timezone = currentTimezone();
      const name = state.name.trim() || nameFromInstructions(state.instructions);
      const template = templateById(state.templateKey);
      const agent = {
        instructions: state.instructions.trim(),
        agent_tier: state.agentTier,
        data_sources: state.dataSources,
        notify_push: state.notifyPush,
        notify_email: state.notifyEmail,
        icon: state.icon,
        template_key: state.templateKey,
      };

      // Runs execute against the shared per-kind definition (definitions are
      // unique per user+kind); listing them also seeds the defaults.
      const resolveDefinitionId = async () => {
        const cached = definitionsQuery.data
          || (await apiJsonWithAuth<WorkflowDefinitionListResponse>('/api/workflows/definitions', getToken, { userId: user?.id })).items;
        return sharedDefinitionId(cached, template?.workflowKind || 'daily_narrative');
      };

      if (editing) {
        const definitionId = editing.routine.ai_workflow_definition_id || (await resolveDefinitionId());
        const patch: RoutineUpdateInput = {
          ...buildAgentRoutineUpdateInput({ name, agent, draft: state.draft, paused: editing.routine.status === 'paused' }),
          kind: 'ai_workflow',
          ai_workflow_definition_id: definitionId,
        };
        const response = await apiJsonWithAuth<RoutineListResponse>(`/api/routines/${editing.routine.id}`, getToken, {
          method: 'PATCH',
          body: JSON.stringify(patch),
          userId: user?.id,
        });
        return { routine: response.items[0] || null, created: false };
      }

      const definitionId = await resolveDefinitionId();
      if (!definitionId) throw new Error('Could not prepare the agent for this routine — check the backend connection.');
      const response = await apiJsonWithAuth<RoutineListResponse>('/api/routines', getToken, {
        method: 'POST',
        body: JSON.stringify(buildAgentRoutineInput({ name, agent, draft: state.draft, timezone, definitionId })),
        userId: user?.id,
      });
      return { routine: response.items[0] || null, created: true };
    },
    onSuccess: ({ routine, created }) => {
      invalidateAll();
      setModal(closedModal());
      if (routine) {
        setSelectedId(routine.id);
        setActiveTab('mine');
        if (user?.id) void putLocalVaultRoutine(user.id, routine).catch(() => undefined);
      }
      toast.success(created ? 'Routine created' : 'Routine saved');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save the routine.'),
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

  // --- Modal openers & keyboard shortcuts --------------------------------------------

  const openCreateModal = useCallback((templateKey?: string | null) => {
    setModal({
      open: true,
      mode: 'create',
      initial: configureStateFromTemplate(templateById(templateKey || null)),
      editing: null,
    });
  }, []);

  const openEditModal = useCallback((item: AgentRoutine) => {
    setModal({ open: true, mode: 'edit', initial: configureStateFromRoutine(item), editing: item });
  }, []);

  const duplicateRoutine = (item: AgentRoutine) => {
    const initial = configureStateFromRoutine(item);
    setModal({
      open: true,
      mode: 'create',
      initial: { ...initial, name: `${initial.name} copy` },
      editing: null,
    });
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && !modal.open) {
        event.preventDefault();
        openCreateModal();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modal.open, openCreateModal]);

  // --- Rendering ---------------------------------------------------------------------

  const listActions = {
    onSelect: (id: string) => setSelectedId(id),
    onRunNow: (item: AgentRoutine) => runNowMutation.mutate(item),
    onTogglePause: togglePause,
    onEdit: openEditModal,
    onDuplicate: duplicateRoutine,
    onViewRuns: (item: AgentRoutine) => {
      setRunsFilter(item.routine.id);
      setActiveTab('runs');
    },
    onDelete: deleteRoutine,
  };

  const filteredRunViews = runsFilter === 'all' ? runViews : runViews.filter((run) => run.routineId === runsFilter);
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
    <ReferencePage>
      <header className={cn('flex shrink-0 items-center justify-between gap-5 border-b px-6 pb-3.5 pt-5', subtleBorderClass)}>
        <div className="flex min-w-0 items-center gap-5">
          <h1 className="truncate text-[22px] font-[680] leading-none tracking-[-0.025em] text-[#10141d]">Routines</h1>
          <SegmentedTabs value={activeTab} options={ROUTINE_TABS} onChange={setActiveTab} />
        </div>
        <button
          type="button"
          title="New routine (⌘N)"
          onClick={() => openCreateModal()}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm bg-[#111827] px-2.5 text-[13px] font-[650] text-white transition hover:bg-[#202938]"
        >
          <Plus className="h-3.5 w-3.5" />
          New routine
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'templates' ? (
          <div className="h-full overflow-auto px-8 py-6">
            <div className="mx-auto max-w-[980px]">
              <TemplateLibrary
                heading={null}
                installedTemplateKeys={installedTemplateKeys}
                onSetUp={(template) => openCreateModal(template.id)}
              />
            </div>
          </div>
        ) : activeTab === 'runs' ? (
          <div className="h-full overflow-auto px-8 py-6">
            <div className="mx-auto max-w-[820px]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-[13px] font-[650] uppercase tracking-[0.12em] text-[#8a929c]">Run history</div>
                <select
                  value={runsFilter}
                  onChange={(event) => setRunsFilter(event.target.value)}
                  aria-label="Filter runs by routine"
                  className="h-8 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/90 px-2 text-[13px] font-[560] text-[#22262d] outline-none focus:border-[rgba(15,23,42,0.24)]"
                >
                  <option value="all">All routines</option>
                  {agentRoutines.map((item) => (
                    <option key={item.routine.id} value={item.routine.id}>{item.routine.title}</option>
                  ))}
                </select>
              </div>
              <RunHistory runs={filteredRunViews} now={now} onRetry={retryRun} />
            </div>
          </div>
        ) : !hasRoutines ? (
          <div className="h-full overflow-auto px-8 py-8">
            <div className="mx-auto max-w-[980px] space-y-8">
              {routinesQuery.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-[10px] bg-[#f1f3ef]" />)}
                </div>
              ) : (
                <>
                  <RoutinesEmptyHero onNewRoutine={() => openCreateModal()} />
                  <TemplateLibrary
                    installedTemplateKeys={installedTemplateKeys}
                    onSetUp={(template) => openCreateModal(template.id)}
                  />
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
            <aside className={cn('min-h-0 overflow-auto border-r bg-white/42 px-2.5 py-3', subtleBorderClass)}>
              <RoutineList
                items={agentRoutines}
                selectedId={selectedRoutineId}
                now={now}
                runningRoutineIds={runningRoutineIds}
                lastRunByRoutine={lastRunByRoutine}
                actions={listActions}
              />
            </aside>
            <section className="min-h-0 overflow-auto px-8 py-7">
              {selectedItem ? (
                <RoutineDetail
                  item={selectedItem}
                  now={now}
                  runs={scopedRunViews}
                  running={runningRoutineIds.has(selectedItem.routine.id)}
                  onRename={renameRoutine}
                  onTogglePause={togglePause}
                  onRunNow={(item) => runNowMutation.mutate(item)}
                  onEdit={openEditModal}
                  onDuplicate={duplicateRoutine}
                  onDelete={deleteRoutine}
                  onRetryRun={retryRun}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-center">
                  <div>
                    <RotateCw className="mx-auto h-8 w-8 text-[#a0a7b0]" />
                    <div className="mt-3 text-[20px] font-[680] text-[#141922]">Select a routine</div>
                    <p className="mt-2 text-[14px] text-[#737b86]">Pick a routine on the left to see its schedule and runs.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <RoutineConfigureModal
        open={modal.open}
        mode={modal.mode}
        initial={modal.initial}
        lastRunAt={modal.editing?.routine.last_run_at || null}
        submitting={submitModalMutation.isPending}
        onClose={() => setModal(closedModal())}
        onSubmit={(state) => submitModalMutation.mutate({ state, editing: modal.editing })}
      />
    </ReferencePage>
  );
}
