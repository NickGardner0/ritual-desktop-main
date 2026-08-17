"use client";

import { describeSchedule, nextOccurrences } from "@/lib/routines/schedule-engine.mjs";
import type { Routine, RoutineRun, Task } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_TASKS_EVENT = "ritual:demo-routine-generated";

function now() {
  return new Date();
}

function atLocalDay(offsetDays: number, hour = 9, minute = 0) {
  const base = now();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + offsetDays);
  base.setHours(hour, minute, 0, 0);
  return base.toISOString();
}

function stableUserId(userId: string) {
  return userId || "visual-seed";
}

function makeTask(userId: string, task: Omit<Task, "user_id" | "created_at" | "updated_at" | "completed_at"> & {
  completed_at?: string | null;
}): Task {
  const createdAt = atLocalDay(-8, 10);
  return {
    ...task,
    user_id: stableUserId(userId),
    completed_at: task.completed_at ?? null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export function buildSeedTasks(userId: string): Task[] {
  return [
    makeTask(userId, {
      id: "seed-task-record-demo",
      title: "Record demo video walkthrough",
      notes: "Show the Ritual desktop flow end to end.",
      status: "open",
      priority: "high",
      due_at: atLocalDay(0, 11),
      scheduled_for: atLocalDay(0, 11),
      source: "manual",
      project: "Telos public launch",
      category: "Work",
      tags: ["launch", "demo"],
      routine_id: null,
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-record-demo",
    }),
    makeTask(userId, {
      id: "seed-task-hn-post",
      title: "Draft Hacker News launch post",
      notes: null,
      status: "open",
      priority: "high",
      due_at: atLocalDay(0, 14),
      scheduled_for: atLocalDay(0, 14),
      source: "manual",
      project: "Telos public launch",
      category: "Work",
      tags: ["writing"],
      routine_id: null,
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-hn-post",
    }),
    makeTask(userId, {
      id: "seed-task-checklist-review",
      title: "Deep work: launch checklist review",
      notes: null,
      status: "open",
      priority: "medium",
      due_at: atLocalDay(0, 15),
      scheduled_for: atLocalDay(0, 15),
      source: "manual",
      project: "Telos public launch",
      category: "Work",
      tags: ["deep-work"],
      routine_id: null,
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-checklist-review",
    }),
    makeTask(userId, {
      id: "seed-task-cpa",
      title: "Confirm CPA appointment",
      notes: null,
      status: "open",
      priority: "high",
      due_at: atLocalDay(-15, 9),
      scheduled_for: atLocalDay(-15, 9),
      source: "manual",
      project: "2025 tax filing",
      category: "Finance",
      tags: ["taxes"],
      routine_id: null,
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-cpa",
    }),
    makeTask(userId, {
      id: "seed-task-recovery-run",
      title: "Easy 5k recovery run",
      notes: null,
      status: "open",
      priority: "low",
      due_at: atLocalDay(0, 17),
      scheduled_for: atLocalDay(0, 17),
      source: "habit",
      project: "Health",
      category: "Health",
      tags: ["run"],
      routine_id: "seed-routine-daily-exercise",
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-recovery-run",
    }),
    makeTask(userId, {
      id: "seed-task-read",
      title: "Read 30 pages of current book",
      notes: null,
      status: "open",
      priority: "none",
      due_at: atLocalDay(0, 20),
      scheduled_for: atLocalDay(0, 20),
      source: "manual",
      project: "Personal",
      category: "Personal",
      tags: ["reading"],
      routine_id: null,
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-read",
    }),
    makeTask(userId, {
      id: "seed-task-planning",
      title: "Weekly planning review",
      notes: null,
      status: "open",
      priority: "medium",
      due_at: atLocalDay(-6, 16),
      scheduled_for: atLocalDay(-6, 16),
      source: "routine",
      project: "Pre-launch polish",
      category: "Personal",
      tags: ["review"],
      routine_id: "seed-routine-weekday-planning",
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-planning",
    }),
    makeTask(userId, {
      id: "seed-task-hero",
      title: "Design landing page hero",
      notes: null,
      status: "open",
      priority: "low",
      due_at: atLocalDay(-3, 13),
      scheduled_for: atLocalDay(-3, 13),
      source: "manual",
      project: "Pre-launch polish",
      category: "Work",
      tags: ["design"],
      routine_id: null,
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-hero",
    }),
    makeTask(userId, {
      id: "seed-task-groceries",
      title: "Buy groceries",
      notes: null,
      status: "open",
      priority: "none",
      due_at: atLocalDay(1, 18),
      scheduled_for: atLocalDay(1, 18),
      source: "manual",
      project: "Personal",
      category: "Personal",
      tags: ["home"],
      routine_id: "seed-routine-grocery-shopping",
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-groceries",
    }),
    makeTask(userId, {
      id: "seed-task-completed",
      title: "Publish launch assets to shared drive",
      notes: null,
      status: "completed",
      priority: "none",
      due_at: atLocalDay(-1, 12),
      scheduled_for: atLocalDay(-1, 12),
      completed_at: atLocalDay(-1, 13),
      source: "manual",
      project: "Telos public launch",
      category: "Work",
      tags: ["done"],
      routine_id: null,
      routine_run_id: null,
      linked_habit_id: null,
      linked_artifact_id: null,
      client_event_id: "seed-task-completed",
    }),
  ];
}

function routinePreview(
  routine: Pick<Routine, "trigger_type" | "trigger_config" | "first_run_at" | "ends_at" | "last_run_at">,
) {
  const dates = nextOccurrences({
    triggerType: routine.trigger_type,
    config: routine.trigger_config,
    from: new Date(),
    firstRunAt: routine.first_run_at ? new Date(routine.first_run_at) : null,
    endsAt: routine.ends_at ? new Date(routine.ends_at) : null,
    lastCompletedAt: routine.last_run_at ? new Date(routine.last_run_at) : null,
    count: 6,
  });
  return {
    cadence_summary: describeSchedule(routine.trigger_type, routine.trigger_config),
    next_preview: dates.map((date) => date.toISOString()),
  };
}

function makeRoutine(userId: string, routine: Omit<Routine, "user_id" | "cadence_summary" | "next_preview" | "created_at" | "updated_at">): Routine {
  const preview = routinePreview(routine);
  return {
    ...routine,
    user_id: stableUserId(userId),
    ...preview,
    created_at: atLocalDay(-30, 9),
    updated_at: atLocalDay(-2, 13),
  };
}

export function buildSeedRoutines(userId: string): Routine[] {
  return [
    makeRoutine(userId, {
      id: "seed-routine-daily-exercise",
      title: "Daily morning exercise",
      description: "Start each day with physical activity before work expands.",
      status: "scheduled",
      kind: "task",
      trigger_type: "daily",
      trigger_config: { interval: 1, hour: 7, minute: 30 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      priority: "high",
      tags: ["health", "morning"],
      task_template: {
        title: "Easy 5k recovery run",
        notes: "Keep it conversational unless recovery says otherwise.",
        project: "Health",
        category: "Health",
        tags: ["run", "recovery"],
        linked_habit_id: null,
      },
      ai_workflow_definition_id: null,
      first_run_at: atLocalDay(-14, 7, 30),
      ends_at: null,
      last_run_at: atLocalDay(-1, 7, 30),
      next_run_at: atLocalDay(0, 7, 30),
      client_event_id: "seed-routine-daily-exercise",
    }),
    makeRoutine(userId, {
      id: "seed-routine-grocery-shopping",
      title: "Grocery shopping",
      description: "Keep the pantry and recovery food stocked without a weekly scramble.",
      status: "scheduled",
      kind: "task",
      trigger_type: "weekly",
      trigger_config: { interval: 1, weekdays: [2, 6], hour: 18, minute: 0 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      priority: "none",
      tags: ["home"],
      task_template: {
        title: "Buy groceries",
        notes: "Check staples, produce, protein, coffee, and paper goods.",
        project: "Personal",
        category: "Personal",
        tags: ["home"],
        linked_habit_id: null,
      },
      ai_workflow_definition_id: null,
      first_run_at: atLocalDay(-21, 18),
      ends_at: null,
      last_run_at: atLocalDay(-3, 18),
      next_run_at: atLocalDay(1, 18),
      client_event_id: "seed-routine-grocery-shopping",
    }),
    makeRoutine(userId, {
      id: "seed-routine-weekly-grocery",
      title: "Weekly grocery shopping",
      description: "A calmer Sunday version when weekday shopping slips.",
      status: "scheduled",
      kind: "task",
      trigger_type: "weekly",
      trigger_config: { interval: 1, weekdays: [6], hour: 10, minute: 0 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      priority: "low",
      tags: ["home"],
      task_template: {
        title: "Weekly grocery reset",
        notes: "Plan meals and buy the basics for the week.",
        project: "Personal",
        category: "Personal",
        tags: ["home", "planning"],
        linked_habit_id: null,
      },
      ai_workflow_definition_id: null,
      first_run_at: atLocalDay(-30, 10),
      ends_at: null,
      last_run_at: atLocalDay(-2, 10),
      next_run_at: atLocalDay(6, 10),
      client_event_id: "seed-routine-weekly-grocery",
    }),
    makeRoutine(userId, {
      id: "seed-routine-budget-review",
      title: "Monthly budget review",
      description: "Review cash flow, launch expenses, and tax prep artifacts.",
      status: "scheduled",
      kind: "task",
      trigger_type: "monthly",
      trigger_config: { interval: 1, mode: "day_of_month", day: 1, hour: 9, minute: 0 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      priority: "medium",
      tags: ["finance"],
      task_template: {
        title: "Monthly budget review",
        notes: "Review runway, tax items, upcoming bills, and account drift.",
        project: "2025 tax filing",
        category: "Finance",
        tags: ["finance", "review"],
        linked_habit_id: null,
      },
      ai_workflow_definition_id: null,
      first_run_at: atLocalDay(-60, 9),
      ends_at: null,
      last_run_at: atLocalDay(-28, 9),
      next_run_at: atLocalDay(2, 9),
      client_event_id: "seed-routine-budget-review",
    }),
    makeRoutine(userId, {
      id: "seed-routine-weekday-planning",
      title: "Weekday work planning",
      description: "Generate a focused work plan from calendar, tasks, and activity context.",
      status: "scheduled",
      kind: "ai_workflow",
      trigger_type: "weekly",
      trigger_config: { interval: 1, weekdays: [0, 1, 2, 3, 4], hour: 8, minute: 45 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      priority: "medium",
      tags: ["ai", "planning"],
      task_template: {
        title: "Review Ritual work plan",
        notes: "Use the generated summary to choose one deep-work block.",
        project: "Pre-launch polish",
        category: "AI",
        tags: ["ai", "focus"],
        linked_habit_id: null,
      },
      ai_workflow_definition_id: null,
      first_run_at: atLocalDay(-20, 8, 45),
      ends_at: null,
      last_run_at: atLocalDay(-1, 8, 45),
      next_run_at: atLocalDay(0, 8, 45),
      client_event_id: "seed-routine-weekday-planning",
    }),
    makeRoutine(userId, {
      id: "seed-routine-oil-change",
      title: "Oil change maintenance",
      description: "Regenerate only after the previous maintenance task is completed.",
      status: "scheduled",
      kind: "task",
      trigger_type: "on_completion",
      trigger_config: { interval: 3, unit: "months", hour: 9, minute: 0 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      priority: "low",
      tags: ["maintenance"],
      task_template: {
        title: "Schedule oil change",
        notes: "Book service after the previous oil change is complete.",
        project: "Personal",
        category: "Personal",
        tags: ["maintenance"],
        linked_habit_id: null,
      },
      ai_workflow_definition_id: null,
      first_run_at: atLocalDay(-90, 9),
      ends_at: null,
      last_run_at: atLocalDay(-62, 9),
      next_run_at: atLocalDay(29, 9),
      client_event_id: "seed-routine-oil-change",
    }),
  ];
}

export function buildSeedRoutineRuns(userId: string, routines: Routine[] = buildSeedRoutines(userId)): RoutineRun[] {
  const byId = new Map(routines.map((routine) => [routine.id, routine]));
  const run = (
    id: string,
    routineId: string,
    offset: number,
    status: RoutineRun["status"],
    output: "task" | "report" | "note" | "prompt",
  ): RoutineRun => ({
    id,
    routine_id: routineId,
    user_id: stableUserId(userId),
    scheduled_for: atLocalDay(offset, 9),
    status,
    generated_task_id: output === "task" ? `${id}-task` : null,
    generated_scheduled_block_id: null,
    workflow_run_id: output === "report" || output === "prompt" ? `${id}-workflow` : null,
    completed_at: status === "completed" ? atLocalDay(offset, 10) : null,
    skipped_at: status === "skipped" ? atLocalDay(offset, 10) : null,
    error_json: status === "failed" ? "{\"message\":\"Calendar source unavailable\"}" : null,
    idempotency_key: `seed:${routineId}:${offset}`,
    created_at: atLocalDay(offset, 9, 2),
    updated_at: atLocalDay(offset, 9, 2),
  });

  return [
    run("seed-run-generated-exercise", byId.get("seed-routine-daily-exercise")?.id || "seed-routine-daily-exercise", 0, "generated", "task"),
    run("seed-run-completed-planning", byId.get("seed-routine-weekday-planning")?.id || "seed-routine-weekday-planning", -1, "completed", "report"),
    run("seed-run-scheduled-grocery", byId.get("seed-routine-grocery-shopping")?.id || "seed-routine-grocery-shopping", 1, "scheduled", "task"),
    run("seed-run-skipped-review", byId.get("seed-routine-budget-review")?.id || "seed-routine-budget-review", -28, "skipped", "task"),
    run("seed-run-failed-ai", byId.get("seed-routine-weekday-planning")?.id || "seed-routine-weekday-planning", -4, "failed", "report"),
  ];
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function demoTasksKey(userId: string) {
  return `ritual.demo.generated-tasks.${stableUserId(userId)}`;
}

function demoRunsKey(userId: string) {
  return `ritual.demo.routine-runs.${stableUserId(userId)}`;
}

export function readDemoGeneratedTasks(userId: string): Task[] {
  return readJson<Task[]>(demoTasksKey(userId), []);
}

export function readDemoRoutineRuns(userId: string): RoutineRun[] {
  return readJson<RoutineRun[]>(demoRunsKey(userId), []);
}

export function appendDemoRoutineGeneration(userId: string, routine?: Routine | null) {
  const sourceRoutine = routine || buildSeedRoutines(userId)[0];
  const timestamp = Date.now();
  const runId = `demo-run-${sourceRoutine.id}-${timestamp}`;
  const taskId = `demo-task-${sourceRoutine.id}-${timestamp}`;
  const generatedAt = new Date(timestamp).toISOString();
  const task: Task = makeTask(userId, {
    id: taskId,
    title: sourceRoutine.task_template?.title || sourceRoutine.title,
    notes: sourceRoutine.task_template?.notes || sourceRoutine.description,
    status: "open",
    priority: sourceRoutine.priority,
    due_at: generatedAt,
    scheduled_for: generatedAt,
    source: sourceRoutine.kind === "ai_workflow" ? "ai" : sourceRoutine.kind === "habit_prompt" ? "habit" : "routine",
    project: sourceRoutine.task_template?.project || "Ritual routines",
    category: sourceRoutine.task_template?.category || "AI",
    tags: Array.from(new Set([...(sourceRoutine.tags || []), ...(sourceRoutine.task_template?.tags || [])])),
    routine_id: sourceRoutine.id,
    routine_run_id: runId,
    linked_habit_id: sourceRoutine.task_template?.linked_habit_id || null,
    linked_artifact_id: null,
    client_event_id: `demo-generated:${runId}`,
  });
  const run: RoutineRun = {
    id: runId,
    routine_id: sourceRoutine.id,
    user_id: stableUserId(userId),
    scheduled_for: generatedAt,
    status: "generated",
    generated_task_id: task.id,
    generated_scheduled_block_id: null,
    workflow_run_id: sourceRoutine.kind === "ai_workflow" ? `demo-workflow-${timestamp}` : null,
    completed_at: null,
    skipped_at: null,
    error_json: null,
    idempotency_key: `demo:${sourceRoutine.id}:${timestamp}`,
    created_at: generatedAt,
    updated_at: generatedAt,
  };

  writeJson(demoTasksKey(userId), [task, ...readDemoGeneratedTasks(userId)].slice(0, 20));
  writeJson(demoRunsKey(userId), [run, ...readDemoRoutineRuns(userId)].slice(0, 30));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DEMO_TASKS_EVENT, { detail: { task, run } }));
  }
  return { task, run };
}

export function subscribeDemoRoutineGeneration(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(DEMO_TASKS_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(DEMO_TASKS_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function sortTasksForDisplay(tasks: Task[]) {
  return tasks.slice().sort((a, b) => {
    const aTime = new Date(a.scheduled_for || a.due_at || a.created_at || 0).getTime();
    const bTime = new Date(b.scheduled_for || b.due_at || b.created_at || 0).getTime();
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return aTime - bTime;
  });
}

export function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function relativeDayLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = now();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const delta = Math.round((target.getTime() - today.getTime()) / DAY_MS);
  if (delta < 0) return `${Math.abs(delta)} ${Math.abs(delta) === 1 ? "day" : "days"} ago`;
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
