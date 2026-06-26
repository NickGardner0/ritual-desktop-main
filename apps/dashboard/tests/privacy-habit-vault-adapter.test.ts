import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  HABIT_DEFINITIONS_COLLECTION,
  HABIT_LOGS_COLLECTION,
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
});
