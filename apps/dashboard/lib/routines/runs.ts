import type { RoutineRun } from '@/lib/tasks/types';
import type { WorkflowRun } from '@/lib/workflows/types';

import type { AgentRoutine } from './model';

export type RunStatusKind = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

/**
 * Unified run row: routine runs are the source of attribution (every scheduled
 * or manual routine occurrence records one), enriched with the linked workflow
 * run's live status, artifact, and timing when the routine is an AI routine.
 */
export type RoutineRunView = {
  id: string;
  routineId: string | null;
  routineName: string;
  routineIcon: string;
  status: RunStatusKind;
  trigger: 'schedule' | 'manual';
  occurredAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  artifactId: string | null;
  error: string | null;
};

function workflowStatusToKind(status: WorkflowRun['status']): RunStatusKind {
  if (status === 'queued') return 'queued';
  if (status === 'processing') return 'running';
  if (status === 'completed') return 'succeeded';
  if (status === 'failed') return 'failed';
  return 'skipped';
}

function routineRunStatusToKind(status: RoutineRun['status']): RunStatusKind {
  if (status === 'scheduled') return 'queued';
  if (status === 'failed') return 'failed';
  if (status === 'skipped') return 'skipped';
  return 'succeeded';
}

function parseErrorJson(errorJson: string | null): string | null {
  if (!errorJson) return null;
  try {
    const parsed = JSON.parse(errorJson);
    if (parsed && typeof parsed.message === 'string') return parsed.message;
  } catch {
    // fall through to the raw string
  }
  return errorJson;
}

export function buildRunViews({
  workflowRuns,
  routineRuns,
  agentRoutines,
}: {
  workflowRuns: WorkflowRun[];
  routineRuns: RoutineRun[];
  agentRoutines: AgentRoutine[];
}): RoutineRunView[] {
  const workflowById = new Map(workflowRuns.map((run) => [run.id, run]));
  const byRoutineId = new Map(agentRoutines.map((item) => [item.routine.id, item]));

  const views: RoutineRunView[] = [];
  for (const run of routineRuns) {
    const owner = byRoutineId.get(run.routine_id);
    const workflowRun = run.workflow_run_id ? workflowById.get(run.workflow_run_id) || null : null;
    views.push({
      id: run.id,
      routineId: run.routine_id,
      routineName: owner?.routine.title || 'Routine',
      routineIcon: owner?.agent.icon || 'sparkles',
      status: workflowRun ? workflowStatusToKind(workflowRun.status) : routineRunStatusToKind(run.status),
      trigger: workflowRun?.trigger_source === 'manual' ? 'manual' : 'schedule',
      occurredAt: run.scheduled_for,
      startedAt: workflowRun?.started_at || run.scheduled_for,
      finishedAt: workflowRun?.finished_at || run.completed_at,
      artifactId: workflowRun?.artifact_id || null,
      error: parseErrorJson(workflowRun?.error_json || run.error_json),
    });
  }

  return views.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}
