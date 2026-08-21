import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  MemoryVaultStorage,
  getVaultRecord,
  listVaultRecords,
  putVaultRecord,
} from "../lib/privacy/local-vault";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
  });
}

describe("local vault pilot", () => {
  test("stores encrypted records without plaintext payload leakage", async () => {
    const storage = new MemoryVaultStorage();
    const passphrase = "test passphrase";

    await putVaultRecord(storage, passphrase, {
      id: "habit-log-1",
      type: "habit_log",
      updatedAt: "2026-06-23T12:00:00.000Z",
      payload: {
        habitName: "Private medication habit",
        notes: "contains sensitive notes",
        amount: 2,
      },
    });

    const raw = [...storage.values.values()].join("\n");
    assert.doesNotMatch(raw, /Private medication habit/);
    assert.doesNotMatch(raw, /contains sensitive notes/);

    const record = await getVaultRecord<{
      habitName: string;
      notes: string;
      amount: number;
    }>(storage, passphrase, "habit-log-1");

    assert.equal(record?.payload.habitName, "Private medication habit");
    assert.equal(record?.payload.notes, "contains sensitive notes");
    assert.equal(record?.payload.amount, 2);

    const records = await listVaultRecords(storage, passphrase);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, "habit-log-1");
  });
});
