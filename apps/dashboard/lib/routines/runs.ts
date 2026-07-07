import type { RoutineRun } from '@/lib/tasks/types';
import type { WorkflowRun } from '@/lib/workflows/types';

import type { AgentRoutine } from './model';
import type { RunStatusKind } from './ui';

/** Unified run row across workflow runs (AI routines) and routine runs (task routines). */
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
  definitionId: string | null;
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
  const byDefinition = new Map<string, AgentRoutine>();
  const byRoutineId = new Map<string, AgentRoutine>();
  for (const item of agentRoutines) {
    if (item.routine.ai_workflow_definition_id) byDefinition.set(item.routine.ai_workflow_definition_id, item);
    byRoutineId.set(item.routine.id, item);
  }

  const views: RoutineRunView[] = [];

  for (const run of workflowRuns) {
    const owner = byDefinition.get(run.workflow_definition_id);
    if (!owner) continue; // runs of non-routine workflows don't belong here
    views.push({
      id: run.id,
      routineId: owner.routine.id,
      routineName: owner.routine.title,
      routineIcon: owner.agent.icon,
      status: workflowStatusToKind(run.status),
      trigger: run.trigger_source === 'manual' ? 'manual' : 'schedule',
      occurredAt: run.started_at || run.created_at || new Date().toISOString(),
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      artifactId: run.artifact_id,
      error: parseErrorJson(run.error_json),
      definitionId: run.workflow_definition_id,
    });
  }

  for (const run of routineRuns) {
    // AI routine occurrences surface through their workflow run instead.
    if (run.workflow_run_id) continue;
    const owner = byRoutineId.get(run.routine_id);
    views.push({
      id: run.id,
      routineId: run.routine_id,
      routineName: owner?.routine.title || 'Routine',
      routineIcon: owner?.agent.icon || 'sparkles',
      status: routineRunStatusToKind(run.status),
      trigger: 'schedule',
      occurredAt: run.scheduled_for,
      startedAt: run.scheduled_for,
      finishedAt: run.completed_at,
      artifactId: null,
      error: parseErrorJson(run.error_json),
      definitionId: null,
    });
  }

  return views.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}
