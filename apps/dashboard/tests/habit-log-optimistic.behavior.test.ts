import { describe, expect, test } from 'vitest';

import { buildHabitLogEditIdempotencyKey } from '@/app/(dashboard)/activity/logs-client.helpers';

describe('habit-log optimistic edit identity', () => {
  test('is stable for the same revision and edit', () => {
    const log = { id: 'log-1', revision: 3 };
    const update = { status: 'skipped' as const, date: '2026-08-22' };

    expect(buildHabitLogEditIdempotencyKey(log, update)).toBe(
      buildHabitLogEditIdempotencyKey(log, update),
    );
  });

  test('changes when either revision or editable payload changes', () => {
    const base = buildHabitLogEditIdempotencyKey(
      { id: 'log-1', revision: 3 },
      { status: 'skipped' },
    );

    expect(buildHabitLogEditIdempotencyKey(
      { id: 'log-1', revision: 4 },
      { status: 'skipped' },
    )).not.toBe(base);
    expect(buildHabitLogEditIdempotencyKey(
      { id: 'log-1', revision: 3 },
      { status: 'completed' },
    )).not.toBe(base);
  });
});
