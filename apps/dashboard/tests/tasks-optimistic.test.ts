import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOptimisticRoutine,
  buildOptimisticTask,
  buildOptimisticTaskUpdate,
  buildRoutineCreateOutboxItem,
  buildTaskCreateOutboxItem,
  buildTaskUpdateOutboxItem,
  createTaskRoutineClientEventId,
  markTaskRoutineOutboxItemFailed,
  markTaskRoutineOutboxItemSynced,
  mergeRoutinesWithOutbox,
  mergeTasksWithOutbox,
  rewriteTaskRoutineOutboxItemEntityId,
  shouldReplayTaskRoutineOutboxItem,
} from "../lib/tasks/local-first-writes";
import { applyTaskOptimisticPatch } from "../lib/tasks/optimistic";
import type { Task } from "../lib/tasks/types";

const NOW = "2026-06-29T12:00:00.000Z";

const baseTask: Task = {
  id: "task-1",
  user_id: "user-1",
  title: "Draft weekly review",
  notes: null,
  status: "open",
  priority: "none",
  due_at: null,
  scheduled_for: null,
  completed_at: null,
  source: "manual",
  project: null,
  category: "Work",
  tags: ["review"],
  routine_id: null,
  routine_run_id: null,
  linked_habit_id: null,
  linked_artifact_id: null,
  client_event_id: null,
  created_at: "2026-06-29T12:00:00Z",
  updated_at: "2026-06-29T12:00:00Z",
};

test("applyTaskOptimisticPatch updates only the target task", () => {
  const otherTask: Task = { ...baseTask, id: "task-2", title: "Keep untouched" };
  const next = applyTaskOptimisticPatch([baseTask, otherTask], "task-1", {
    status: "completed",
    priority: "high",
  }, "2026-08-31T12:00:00.000Z");

  assert.equal(next[0].status, "completed");
  assert.equal(next[0].completed_at, "2026-08-31T12:00:00.000Z");
  assert.equal(next[0].priority, "high");
  assert.deepEqual(next[0].tags, ["review"]);
  assert.equal(next[1], otherTask);
  assert.equal(baseTask.status, "open");
});

test("task local-first builders create deterministic pending records", () => {
  const clientEventId = createTaskRoutineClientEventId({
    kind: "task_create",
    entityId: "Review notes",
    now: NOW,
    random: () => 0.5,
  });
  const task = buildOptimisticTask(
    { title: "Review notes", category: "Work", due_at: NOW },
    "user-1",
    { clientEventId, now: NOW },
  );
  const outboxItem = buildTaskCreateOutboxItem(
    "user-1",
    { title: "Review notes", category: "Work", due_at: NOW },
    task,
    NOW,
  );

  assert.equal(clientEventId, "task_create:Review-notes:1782734400000:i0000000");
  assert.equal(task.id, "local-task-task_create-Review-notes-1782734400000-i0000000");
  assert.equal(task.sync_status, "pending");
  assert.equal(outboxItem.kind, "task_create");
  assert.equal(shouldReplayTaskRoutineOutboxItem(outboxItem), true);
});

test("task and routine outbox records merge into local reads", () => {
  const task = buildOptimisticTask(
    { title: "Offline task", category: "Work" },
    "user-1",
    { clientEventId: "task-event-1", now: NOW },
  );
  const taskOutbox = buildTaskCreateOutboxItem("user-1", { title: "Offline task" }, task, NOW);
  const routine = buildOptimisticRoutine(
    { title: "Offline routine", kind: "task", trigger_type: "daily" },
    "user-1",
    { clientEventId: "routine-event-1", now: NOW },
  );
  const routineOutbox = buildRoutineCreateOutboxItem(
    "user-1",
    { title: "Offline routine", kind: "task", trigger_type: "daily" },
    routine,
    NOW,
  );

  const mergedTasks = mergeTasksWithOutbox([], [taskOutbox]);
  const mergedRoutines = mergeRoutinesWithOutbox([], [routineOutbox]);

  assert.equal(mergedTasks[0].id, task.id);
  assert.equal((mergedTasks[0] as typeof task).sync_status, "pending");
  assert.equal(mergedRoutines[0].id, routine.id);
  assert.equal((mergedRoutines[0] as typeof routine).sync_status, "pending");
  assert.equal(routineOutbox.payload.input.client_event_id, "routine-event-1");
});

test("task routine outbox replay skips updates for still-local ids and marks status", () => {
  const task = buildOptimisticTask(
    { title: "Offline task" },
    "user-1",
    { clientEventId: "task-event-2", now: NOW },
  );
  const createItem = buildTaskCreateOutboxItem("user-1", { title: "Offline task" }, task, NOW);
  const localUpdateItem = {
    ...createItem,
    kind: "task_update" as const,
    payload: { patch: { title: "Edited offline" }, optimisticRecord: task },
  };

  assert.equal(shouldReplayTaskRoutineOutboxItem(createItem), true);
  assert.equal(shouldReplayTaskRoutineOutboxItem(localUpdateItem), false);
  assert.equal(markTaskRoutineOutboxItemSynced(createItem, NOW).status, "synced");
  assert.equal(markTaskRoutineOutboxItemFailed(createItem, "offline", NOW).lastError, "offline");
});

test("task local-first updates use their own outbox id and can be rewritten to server ids", () => {
  const task = buildOptimisticTask(
    { title: "Offline task" },
    "user-1",
    { clientEventId: "task-create-event", now: NOW },
  );
  const createItem = buildTaskCreateOutboxItem("user-1", { title: "Offline task" }, task, NOW);
  const updatedTask = buildOptimisticTaskUpdate(
    task,
    { title: "Edited offline" },
    "user-1",
    { clientEventId: "task-update-event", now: NOW },
  );
  const updateItem = buildTaskUpdateOutboxItem("user-1", { title: "Edited offline" }, updatedTask, NOW);
  const rewritten = rewriteTaskRoutineOutboxItemEntityId(updateItem, "task-server-1", NOW);
  const syncedCreate = markTaskRoutineOutboxItemSynced(createItem, NOW, "task-server-1");

  assert.notEqual(updateItem.id, createItem.id);
  assert.equal(updateItem.entityId, task.id);
  assert.equal(shouldReplayTaskRoutineOutboxItem(updateItem), false);
  assert.equal(rewritten.entityId, "task-server-1");
  assert.equal(shouldReplayTaskRoutineOutboxItem(rewritten), true);
  assert.equal(syncedCreate.serverEntityId, "task-server-1");
});

test("task local-first status updates keep completion timestamps consistent", () => {
  const completed = buildOptimisticTaskUpdate(
    baseTask,
    { status: "completed" },
    "user-1",
    { clientEventId: "task-completed-event", now: NOW },
  );
  const reviewed = buildOptimisticTaskUpdate(
    completed,
    { status: "in_review" },
    "user-1",
    { clientEventId: "task-review-event", now: NOW },
  );

  assert.equal(completed.completed_at, NOW);
  assert.equal(reviewed.completed_at, null);
});
