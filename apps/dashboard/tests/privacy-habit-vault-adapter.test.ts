import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  HABIT_DEFINITIONS_COLLECTION,
  HABIT_LOGS_COLLECTION,
  HABIT_WRITE_OUTBOX_COLLECTION,
  readLocalVaultHabitWriteOutboxItems,
  readLocalVaultHabitLogs,
  readLocalVaultHabits,
} from "../lib/privacy/habit-vault-adapter";
import type { DesktopVaultRecord } from "../lib/privacy/vault-client";

describe("habit vault adapter", () => {
  test("returns local vault habits and filters tombstones", async () => {
    const records: Array<DesktopVaultRecord> = [
      {
        id: "habit-1",
        collection: HABIT_DEFINITIONS_COLLECTION,
        recordType: "habit_definition",
        updatedAt: "2026-06-23T00:00:00Z",
        tombstone: false,
        payload: {
          id: "habit-1",
          name: "Private Medication",
          category: "Health",
        },
      },
      {
        id: "habit-2",
        collection: HABIT_DEFINITIONS_COLLECTION,
        recordType: "habit_definition",
        updatedAt: "2026-06-23T00:00:01Z",
        tombstone: true,
        payload: {
          id: "habit-2",
          name: "Deleted Habit",
          category: "Health",
        },
      },
    ];

    const habits = await readLocalVaultHabits("user-1", {
      async listRecords<T>(_userId: string, collection: string): Promise<Array<DesktopVaultRecord<T>>> {
        assert.equal(collection, HABIT_DEFINITIONS_COLLECTION);
        return records as Array<DesktopVaultRecord<T>>;
      },
    });

    assert.equal(habits?.length, 1);
    assert.equal(habits?.[0].name, "Private Medication");
  });

  test("normalizes local vault habit log duration", async () => {
    const records: Array<DesktopVaultRecord> = [
      {
        id: "log-1",
        collection: HABIT_LOGS_COLLECTION,
        recordType: "habit_log",
        updatedAt: "2026-06-23T00:00:00Z",
        tombstone: false,
        payload: {
          id: "log-1",
          habit_id: "habit-1",
          date: "2026-06-23",
          status: "completed",
        },
      },
    ];

    const logs = await readLocalVaultHabitLogs("user-1", {
      async listRecords<T>(_userId: string, collection: string): Promise<Array<DesktopVaultRecord<T>>> {
        assert.equal(collection, HABIT_LOGS_COLLECTION);
        return records as Array<DesktopVaultRecord<T>>;
      },
    });

    assert.equal(logs?.length, 1);
    assert.equal(logs?.[0].duration, 0);
  });

  test("returns null when vault has no live records", async () => {
    const habits = await readLocalVaultHabits("user-1", {
      async listRecords() {
        return [];
      },
    });

    assert.equal(habits, null);
  });

  test("returns live habit write outbox items in created order", async () => {
    const records: Array<DesktopVaultRecord> = [
      {
        id: "outbox-2",
        collection: HABIT_WRITE_OUTBOX_COLLECTION,
        recordType: "habit_log_create",
        updatedAt: "2026-06-23T00:00:02Z",
        tombstone: false,
        payload: {
          id: "outbox-2",
          user_id: "user-1",
          kind: "habit_log_create",
          status: "pending",
          entityId: "log-2",
          clientEventId: "event-2",
          createdAt: "2026-06-23T00:00:02Z",
          updatedAt: "2026-06-23T00:00:02Z",
          payload: {
            input: { habit_id: "habit-1", date: "2026-06-23", status: "completed", duration: 1 },
            optimisticRecord: {
              id: "log-2",
              habit_id: "habit-1",
              date: "2026-06-23",
              status: "completed",
              duration: 1,
              client_event_id: "event-2",
              sync_status: "pending",
            },
          },
        },
      },
      {
        id: "outbox-1",
        collection: HABIT_WRITE_OUTBOX_COLLECTION,
        recordType: "habit_create",
        updatedAt: "2026-06-23T00:00:01Z",
        tombstone: false,
        payload: {
          id: "outbox-1",
          user_id: "user-1",
          kind: "habit_create",
          status: "pending",
          entityId: "habit-local",
          clientEventId: "event-1",
          createdAt: "2026-06-23T00:00:01Z",
          updatedAt: "2026-06-23T00:00:01Z",
          payload: {
            input: { name: "Read", category: "Learning" },
            optimisticRecord: {
              id: "habit-local",
              name: "Read",
              category: "Learning",
              client_event_id: "event-1",
              sync_status: "pending",
            },
          },
        },
      },
    ];

    const items = await readLocalVaultHabitWriteOutboxItems("user-1", {
      async listRecords<T>(_userId: string, collection: string): Promise<Array<DesktopVaultRecord<T>>> {
        assert.equal(collection, HABIT_WRITE_OUTBOX_COLLECTION);
        return records as Array<DesktopVaultRecord<T>>;
      },
    });

    assert.equal(items?.length, 2);
    assert.equal(items?.[0].id, "outbox-1");
    assert.equal(items?.[1].id, "outbox-2");
  });
});
