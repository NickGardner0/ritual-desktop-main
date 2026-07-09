'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  Copy,
  LayoutGrid,
  List,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  type RoutineAgentConfig,
} from '@/lib/routines/model';
import { sendRoutineNotification } from '@/lib/routines/notifications';
import { buildRunViews, type RoutineRunView } from '@/lib/routines/runs';
import { describeSchedule } from '@/lib/routines/schedule-engine.mjs';
import { templateById } from '@/lib/routines/templates';
import { formatAgo, formatUpcoming, useNow } from '@/lib/routines/time';
import { ReferencePage } from '@/lib/tasks/reference-task-shell';
import type { Routine, RoutineListResponse, RoutineRun, RoutineTaskTemplate, RoutineUpdateInput } from '@/lib/tasks/types';
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
import { RoutinesEmptyHero, TemplateLibrary } from './routine-templates';

type ModalState = {
  open: boolean;
  mode: 'create' | 'edit';
  initial: RoutineConfigureState;
  editing: AgentRoutine | null;
};

type ViewMode = 'list' | 'card';

const closedModal = (): ModalState => ({
  open: false,
  mode: 'create',
  initial: configureStateFromTemplate(null),
  editing: null,
});

function routineTaskTemplate(name: string, state: RoutineConfigureState, existing?: RoutineTaskTemplate): RoutineTaskTemplate {
  return {
    title: name,
    notes: state.notes.trim() ? state.notes.trim() : null,
    project: existing?.project || null,
    category: existing?.category || null,
    tags: state.tags,
    linked_habit_id: existing?.linked_habit_id || null,
  };
}

function LastRunDot({ lastRun, now }: { lastRun: RoutineRunView | undefined; now: Date }) {
  if (!lastRun) return <span className="h-2 w-2 rounded-full bg-[#3d7d58]" aria-label="No runs yet" />;
  if (lastRun.status === 'queued' || lastRun.status === 'running') {
    return (
      <span
        className="routine-running-dot h-2 w-2 rounded-full bg-[#8c8c8c]"
        title={lastRun.status === 'queued' ? 'Queued' : 'Running'}
      />
    );
  }
  const failed = lastRun.status === 'failed';
  return (
    <span
      className={cn('h-2 w-2 rounded-full', failed ? 'bg-[#b3261e]' : 'bg-[#3d7d58]')}
      title={`${failed ? 'Failed' : 'Ran'} ${formatAgo(lastRun.finishedAt || lastRun.occurredAt, now)}`}
    />
  );
}

function RoutineActions({
  item,
  running,
  onRunNow,
  onTogglePause,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: AgentRoutine;
  running: boolean;
  onRunNow: (item: AgentRoutine) => void;
  onTogglePause: (item: AgentRoutine) => void;
  onEdit: (item: AgentRoutine) => void;
  onDuplicate: (item: AgentRoutine) => void;
  onDelete: (item: AgentRoutine) => void;
}) {
  const paused = item.routine.status === 'paused';
  return (
    <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        title={running ? 'Already running' : 'Run now'}
        disabled={running || !item.routine.ai_workflow_definition_id}
        onClick={() => onRunNow(item)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:opacity-40"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="More"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => onEdit(item)}>Edit</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onTogglePause(item)}>
            {paused ? <Play className="mr-2 h-3.5 w-3.5" /> : <Pause className="mr-2 h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDuplicate(item)}>
            <Copy className="mr-2 h-3.5 w-3.5" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-[#b3261e] focus:text-[#b3261e]" onClick={() => onDelete(item)}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function RoutineListRow({
  item,
  selected,
  now,
  running,
  lastRun,
  onSelect,
  onRunNow,
  onTogglePause,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: AgentRoutine;
  selected: boolean;
  now: Date;
  running: boolean;
  lastRun: RoutineRunView | undefined;
  onSelect: (item: AgentRoutine) => void;
  onRunNow: (item: AgentRoutine) => void;
  onTogglePause: (item: AgentRoutine) => void;
  onEdit: (item: AgentRoutine) => void;
  onDuplicate: (item: AgentRoutine) => void;
  onDelete: (item: AgentRoutine) => void;
}) {
  const { routine } = item;
  const paused = routine.status === 'paused';
  const scheduleSummary = describeSchedule(routine.trigger_type, routine.trigger_config || {});
  const nextLabel = paused ? '' : formatUpcoming(routine.next_run_at, now);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        'group grid min-h-[52px] w-full grid-cols-[22px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[8px] px-3 text-left transition',
        selected ? 'bg-neutral-100' : 'hover:bg-neutral-50',
        paused && 'opacity-55',
      )}
    >
      <Repeat2 className="h-4 w-4 text-neutral-500" />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-medium leading-5 text-neutral-950">{routine.title}</span>
        <span className="mt-0.5 block truncate text-[13px] font-normal text-neutral-500">
          {scheduleSummary}
          {nextLabel ? ` · Next ${nextLabel}` : ''}
        </span>
      </span>
      <LastRunDot lastRun={lastRun} now={now} />
      <RoutineActions
        item={item}
        running={running}
        onRunNow={onRunNow}
        onTogglePause={onTogglePause}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </button>
  );
}

function RoutineCard({
  item,
  selected,
  now,
  running,
  lastRun,
  onSelect,
  onRunNow,
  onTogglePause,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: AgentRoutine;
  selected: boolean;
  now: Date;
  running: boolean;
  lastRun: RoutineRunView | undefined;
  onSelect: (item: AgentRoutine) => void;
  onRunNow: (item: AgentRoutine) => void;
  onTogglePause: (item: AgentRoutine) => void;
  onEdit: (item: AgentRoutine) => void;
  onDuplicate: (item: AgentRoutine) => void;
  onDelete: (item: AgentRoutine) => void;
}) {
  const { routine, agent } = item;
  const scheduleSummary = describeSchedule(routine.trigger_type, routine.trigger_config || {});
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        'flex min-h-[176px] flex-col rounded-[14px] border bg-white p-6 text-left transition-colors hover:border-neutral-300',
        selected ? 'border-neutral-950' : 'border-neutral-200',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-medium leading-6 tracking-[-0.01em] text-neutral-950">{routine.title}</div>
          <p className="mt-3 line-clamp-2 text-[14px] leading-6 text-neutral-500">
            {agent.instructions || routine.description || 'No instructions set.'}
          </p>
        </div>
        <LastRunDot lastRun={lastRun} now={now} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-neutral-100 pt-4">
        <span className="min-w-0 truncate text-[13px] text-neutral-500">{scheduleSummary}</span>
        <RoutineActions
          item={item}
          running={running}
          onRunNow={onRunNow}
          onTogglePause={onTogglePause}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </button>
  );
}

export function RoutinesClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const router = useRouter();
  useTaskRoutineOutboxSync();
  const now = useNow(30_000);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
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

  const sortedRoutines = useMemo(() => [...agentRoutines].sort((a, b) => {
    const pausedDelta = Number(a.routine.status === 'paused') - Number(b.routine.status === 'paused');
    if (pausedDelta !== 0) return pausedDelta;
    const aNext = a.routine.next_run_at ? new Date(a.routine.next_run_at).getTime() : Infinity;
    const bNext = b.routine.next_run_at ? new Date(b.routine.next_run_at).getTime() : Infinity;
    if (aNext !== bNext) return aNext - bNext;
    return a.routine.title.localeCompare(b.routine.title);
  }), [agentRoutines]);

  const installedTemplateKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const item of agentRoutines) {
      if (item.agent.template_key) keys.add(item.agent.template_key);
    }
    return keys;
  }, [agentRoutines]);

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: routinesKey });
    void queryClient.invalidateQueries({ queryKey: ['workflow-definitions', 'routines-page'] });
    void queryClient.invalidateQueries({ queryKey: ['workflow-runs', 'routines-page', user?.id] });
    void queryClient.invalidateQueries({ queryKey: ['routine-runs', 'routines-page', user?.id] });
  }, [queryClient, routinesKey, user?.id]);

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

  const resolveDefinitionId = useCallback(async (templateKey?: string | null) => {
    const template = templateById(templateKey || null);
    const cached = definitionsQuery.data
      || (await apiJsonWithAuth<WorkflowDefinitionListResponse>('/api/workflows/definitions', getToken, { userId: user?.id })).items;
    return sharedDefinitionId(cached, template?.workflowKind || 'daily_narrative');
  }, [definitionsQuery.data, getToken, user?.id]);

  const submitModalMutation = useMutation({
    mutationFn: async ({ state, editing }: { state: RoutineConfigureState; editing: AgentRoutine | null }) => {
      const name = state.name.trim() || nameFromInstructions(state.instructions);
      const definitionId = editing?.routine.ai_workflow_definition_id || await resolveDefinitionId(state.templateKey);
      if (!definitionId) throw new Error('Could not prepare the agent for this routine. Check the backend connection.');

      const agent: RoutineAgentConfig = {
        instructions: state.instructions.trim(),
        agent_tier: state.agentTier,
        data_sources: state.dataSources,
        notify_push: state.notifyPush,
        notify_email: state.notifyEmail,
        icon: state.icon,
        template_key: state.templateKey,
      };

      const taskTemplate = routineTaskTemplate(name, state, editing?.routine.task_template);

      if (editing) {
        const patch: RoutineUpdateInput = {
          ...buildAgentRoutineUpdateInput({ name, agent, draft: state.draft, paused: state.paused }),
          kind: 'ai_workflow',
          priority: state.priority,
          tags: state.tags,
          task_template: taskTemplate,
          ai_workflow_definition_id: definitionId,
        };
        const response = await apiJsonWithAuth<RoutineListResponse>(`/api/routines/${editing.routine.id}`, getToken, {
          method: 'PATCH',
          body: JSON.stringify(patch),
          userId: user?.id,
        });
        return { routine: response.items[0] || null, created: false };
      }

      const payload = {
        ...buildAgentRoutineInput({
          name,
          agent,
          draft: state.draft,
          timezone: currentTimezone(),
          definitionId,
          tags: state.tags.length ? state.tags : ['ai'],
        }),
        status: state.paused ? 'paused' as const : 'scheduled' as const,
        priority: state.priority,
        task_template: taskTemplate,
      };
      const response = await apiJsonWithAuth<RoutineListResponse>('/api/routines', getToken, {
        method: 'POST',
        body: JSON.stringify(payload),
        userId: user?.id,
      });
      return { routine: response.items[0] || null, created: true };
    },
    onSuccess: ({ routine, created }) => {
      invalidateAll();
      setModal(closedModal());
      if (routine) {
        setSelectedId(routine.id);
        if (user?.id) void putLocalVaultRoutine(user.id, routine).catch(() => undefined);
      }
      toast.success(created ? 'Routine created' : 'Routine saved');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save the routine.'),
  });

  const runNowMutation = useMutation({
    mutationFn: async (item: AgentRoutine) => {
      if (!item.routine.ai_workflow_definition_id) {
        throw new Error('This routine has no agent attached yet. Edit and save it to attach one.');
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

  const openCreateModal = useCallback((templateKey?: string | null) => {
    setModal({
      open: true,
      mode: 'create',
      initial: configureStateFromTemplate(templateById(templateKey || null)),
      editing: null,
    });
  }, []);

  const openEditModal = useCallback((item: AgentRoutine) => {
    setSelectedId(item.routine.id);
    setModal({ open: true, mode: 'edit', initial: configureStateFromRoutine(item), editing: item });
  }, []);

  const duplicateRoutine = (item: AgentRoutine) => {
    const initial = configureStateFromRoutine(item);
    setModal({
      open: true,
      mode: 'create',
      initial: { ...initial, name: `${initial.name} copy`, paused: false },
      editing: null,
    });
  };

  const togglePause = (item: AgentRoutine) => {
    const paused = item.routine.status === 'paused';
    patchRoutineMutation.mutate({
      id: item.routine.id,
      patch: { status: paused ? 'scheduled' : 'paused' },
      optimistic: { status: paused ? 'scheduled' : 'paused' },
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

  const hasRoutines = routines.length > 0;

  return (
    <ReferencePage className="bg-white text-neutral-950">
      <div className="relative h-full min-h-0 overflow-auto bg-white">
        <main className="mx-auto flex w-full max-w-[980px] flex-col px-8 pb-16 pt-16">
          <header className="mb-7 flex items-center justify-between gap-4">
            <h1 className="text-[24px] font-medium leading-none tracking-[-0.02em] text-neutral-950">Routines</h1>
            <div className="flex items-center gap-3">
              {hasRoutines ? (
                <div className="flex h-9 items-center rounded-[8px] border border-neutral-200 bg-white p-[3px] shadow-sm">
                  <button
                    type="button"
                    aria-label="List view"
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition',
                      viewMode === 'list' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-500 hover:text-neutral-950',
                    )}
                  >
                    <List className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Card view"
                    onClick={() => setViewMode('card')}
                    className={cn(
                      'inline-flex h-7 w-7 items-center justify-center rounded-[6px] transition',
                      viewMode === 'card' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-500 hover:text-neutral-950',
                    )}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                title="New routine (⌘N)"
                disabled={submitModalMutation.isPending}
                onClick={() => openCreateModal()}
                className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-neutral-950 px-4 text-[14px] font-medium text-white shadow-sm transition hover:bg-neutral-800 disabled:opacity-40"
              >
                <CalendarPlus className="h-4 w-4" strokeWidth={1.9} />
                New routine
              </button>
            </div>
          </header>

          {routinesQuery.isLoading ? (
            <div className="space-y-4">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-[64px] animate-pulse rounded-[12px] border border-neutral-200 bg-white" />
              ))}
            </div>
          ) : !hasRoutines ? (
            <div>
              <RoutinesEmptyHero />
              <TemplateLibrary
                installedTemplateKeys={installedTemplateKeys}
                onSetUp={(template) => openCreateModal(template.id)}
              />
            </div>
          ) : viewMode === 'card' ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sortedRoutines.map((item) => (
                <RoutineCard
                  key={item.routine.id}
                  item={item}
                  selected={selectedId === item.routine.id}
                  now={now}
                  running={runningRoutineIds.has(item.routine.id)}
                  lastRun={lastRunByRoutine.get(item.routine.id)}
                  onSelect={openEditModal}
                  onRunNow={(candidate) => runNowMutation.mutate(candidate)}
                  onTogglePause={togglePause}
                  onEdit={openEditModal}
                  onDuplicate={duplicateRoutine}
                  onDelete={deleteRoutine}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-1 rounded-[14px] border border-neutral-200 bg-white p-2">
              {sortedRoutines.map((item) => (
                <RoutineListRow
                  key={item.routine.id}
                  item={item}
                  selected={selectedId === item.routine.id}
                  now={now}
                  running={runningRoutineIds.has(item.routine.id)}
                  lastRun={lastRunByRoutine.get(item.routine.id)}
                  onSelect={openEditModal}
                  onRunNow={(candidate) => runNowMutation.mutate(candidate)}
                  onTogglePause={togglePause}
                  onEdit={openEditModal}
                  onDuplicate={duplicateRoutine}
                  onDelete={deleteRoutine}
                />
              ))}
            </div>
          )}
        </main>
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
