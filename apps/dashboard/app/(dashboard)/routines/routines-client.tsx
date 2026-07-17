'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@ritual/ui/button';
import { cn } from '@ritual/ui/cn';
import { Plus, Repeat2 } from 'lucide-react';
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
  type RoutineAgentConfig,
} from '@/lib/routines/model';
import { sendRoutineNotification } from '@/lib/routines/notifications';
import { buildRunViews } from '@/lib/routines/runs';
import { describeSchedule } from '@/lib/routines/schedule-engine.mjs';
import { templateById } from '@/lib/routines/templates';
import type { Routine, RoutineListResponse, RoutineRun, RoutineTaskTemplate, RoutineUpdateInput } from '@/lib/tasks/types';
import type {
  WorkflowDefinitionListResponse,
  WorkflowRun,
  WorkflowRunListResponse,
} from '@/lib/workflows/types';

import {
  RoutineConfigurePanel,
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

function RoutineListRow({
  item,
  selected,
  onSelect,
}: {
  item: AgentRoutine;
  selected: boolean;
  onSelect: (item: AgentRoutine) => void;
}) {
  const { routine } = item;
  const paused = routine.status === 'paused';
  const scheduleSummary = describeSchedule(routine.trigger_type, routine.trigger_config || {});

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(item);
        }
      }}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-[10px] text-left outline-none transition-colors select-none',
        'focus-visible:ring-2 focus-visible:ring-[#111827]/20',
        selected ? 'bg-[rgba(15,23,42,0.04)]' : 'hover:bg-[rgba(15,23,42,0.03)]',
        paused && 'opacity-55',
      )}
    >
      <Repeat2 className="h-4 w-4 shrink-0 text-[var(--icon-muted,#8a929c)]" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-[600] leading-5 text-[var(--text-primary)]">
        {routine.title}
      </span>
      <span className="max-w-[240px] shrink-0 truncate text-right text-[13px] font-[500] text-[var(--text-muted)]">
        {paused ? 'Paused' : scheduleSummary}
      </span>
    </div>
  );
}

export function RoutinesClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const router = useRouter();
  useTaskRoutineOutboxSync();

  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const seenRunStatuses = useRef<Map<string, string> | null>(null);
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-content text-[var(--text-primary)]">
      <div className="relative h-full min-h-0 overflow-auto bg-surface-content">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--border-muted)] bg-[var(--surface-content)]/95 px-8 backdrop-blur">
          <h1 className="text-2xl font-medium leading-tight">Routines</h1>
          <Button
            type="button"
            title="New routine (⌘N)"
            disabled={submitModalMutation.isPending}
            onClick={() => openCreateModal()}
            className="h-9 rounded-md border border-black bg-black px-3 text-[13px] font-medium text-white shadow-none transition-all duration-200 hover:bg-[#3D3C38] hover:text-white"
          >
            <Plus className="h-4 w-4" />
            New routine
          </Button>
        </header>

        <main className="mx-auto max-w-6xl px-8 pb-12 pt-8">
          {routinesQuery.isLoading ? (
            <div className="mx-auto max-w-[640px] space-y-1">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="h-11 animate-pulse rounded-[7px] bg-surface-panel" />
              ))}
            </div>
          ) : !hasRoutines ? (
            <div className="mx-auto max-w-4xl space-y-8">
              <RoutinesEmptyHero onNewRoutine={() => openCreateModal()} />
              <TemplateLibrary
                installedTemplateKeys={installedTemplateKeys}
                onSetUp={(template) => openCreateModal(template.id)}
              />
            </div>
          ) : (
            <div className="mx-auto flex max-w-[640px] flex-col">
              {sortedRoutines.map((item) => (
                <RoutineListRow
                  key={item.routine.id}
                  item={item}
                  selected={selectedId === item.routine.id}
                  onSelect={openEditModal}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <RoutineConfigurePanel
        open={modal.open}
        mode={modal.mode}
        initial={modal.initial}
        lastRunAt={modal.editing?.routine.last_run_at || null}
        submitting={submitModalMutation.isPending}
        onClose={() => setModal(closedModal())}
        onSubmit={(state) => submitModalMutation.mutate({ state, editing: modal.editing })}
      />
    </div>
  );
}
