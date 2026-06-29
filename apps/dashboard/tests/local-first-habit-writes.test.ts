import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHabitCreateOutboxItem,
  buildHabitLogCreateOutboxItem,
  buildOptimisticHabit,
  buildOptimisticHabitLog,
  createHabitClientEventId,
  getHabitLogOptimisticDelta,
  mergeHabitLogsWithOutbox,
  mergeHabitsWithOutbox,
  shouldReplayHabitOutboxItem,
} from "../lib/habits/local-first-writes";

const NOW = "2026-06-28T12:00:00.000Z";

test("createHabitClientEventId is deterministic when clock and random are supplied", () => {
  const id = createHabitClientEventId({
    kind: "habit_log_create",
    entityId: "habit 1",
    date: "2026-06-28",
    now: NOW,
    random: () => 0.5,
  });

  assert.equal(id, "habit_log_create:habit-1:2026-06-28:1782648000000:i0000000");
});

test("buildOptimisticHabitLog creates a complete local pending log", () => {
  const log = buildOptimisticHabitLog(
    {
      habit_id: "habit-1",
      date: "2026-06-28",
      status: "completed",
      amount: 2,
      duration: 0,
    },
    "user-1",
    { clientEventId: "event-1", now: NOW },
  );

  assert.equal(log.id, "local-habit-log-event-1");
  assert.equal(log.user_id, "user-1");
  assert.equal(log.completed_at, NOW);
  assert.equal(log.client_event_id, "event-1");
  assert.equal(log.sync_status, "pending");
});

test("habit log outbox merges pending local logs into reads", () => {
  const log = buildOptimisticHabitLog(
    { habit_id: "habit-1", date: "2026-06-28", status: "completed", duration: 60 },
    "user-1",
    { clientEventId: "event-1", now: NOW },
  );
  const outboxItem = buildHabitLogCreateOutboxItem(
    "user-1",
    { habit_id: "habit-1", date: "2026-06-28", status: "completed", duration: 60 },
    log,
    NOW,
  );

  const merged = mergeHabitLogsWithOutbox([], [outboxItem]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, log.id);
  assert.equal(getHabitLogOptimisticDelta(merged[0]), 60);
});

test("habit create outbox merges pending local habits into reads", () => {
  const habit = buildOptimisticHabit(
    { name: "Read", category: "Learning", unit_type: "pages" },
    "user-1",
    { clientEventId: "habit-event-1", now: NOW },
  );
  const outboxItem = buildHabitCreateOutboxItem(
    "user-1",
    { name: "Read", category: "Learning", unit_type: "pages" },
    habit,
    NOW,
  );

  const merged = mergeHabitsWithOutbox([{ id: "habit-1", name: "Sleep", category: "Health" }], [outboxItem]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, habit.id);
  assert.equal((merged[0] as typeof habit).sync_status, "pending");
});

test("outbox replay policy retries idempotent log writes and pending creates only", () => {
  const habit = buildOptimisticHabit(
    { name: "Read", category: "Learning" },
    "user-1",
    { clientEventId: "habit-event-1", now: NOW },
  );
  const createItem = buildHabitCreateOutboxItem("user-1", { name: "Read", category: "Learning" }, habit, NOW);
  const failedCreateItem = { ...createItem, status: "failed" as const };
  const log = buildOptimisticHabitLog(
    { habit_id: "habit-1", date: "2026-06-28", status: "completed", duration: 60 },
    "user-1",
    { clientEventId: "event-1", now: NOW },
  );
  const failedLogItem = {
    ...buildHabitLogCreateOutboxItem("user-1", log, log, NOW),
    status: "failed" as const,
  };

  assert.equal(shouldReplayHabitOutboxItem(createItem), true);
  assert.equal(shouldReplayHabitOutboxItem(failedCreateItem), false);
  assert.equal(shouldReplayHabitOutboxItem(failedLogItem), true);
});
