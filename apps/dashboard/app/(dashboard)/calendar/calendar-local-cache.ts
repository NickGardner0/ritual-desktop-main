'use client';

import type { CalendarRangeReadModel } from '@ritual/shared-contracts';

import type { CalendarEventInput } from './calendar-api';

import { vaultSync } from '@/lib/privacy/vault-sync';

const CACHE_COLLECTION = 'calendar_read_models_v2';
const OUTBOX_COLLECTION = 'calendar_write_outbox_v2';
const LEGACY_COLLECTION = 'scheduled_blocks';
const LEGACY_KEYS = new Set([
  'calendar-scheduled-blocks',
  'calendar-week-scheduled-blocks',
  'ritual-calendar-scheduled-blocks',
  'scheduled-blocks',
  'week-scheduled-items',
]);
const LEGACY_PATTERN = /(calendar|week).*(scheduled|block)|scheduled.*block/i;

export type CalendarOutboxItem = {
  id: string;
  operation: 'create' | 'update' | 'delete' | 'publish' | 'rsvp';
  eventId?: string;
  input?: CalendarEventInput & {
    recurrence_scope?: 'occurrence' | 'following' | 'series';
    occurrence_id?: string | null;
    expected_revision?: number;
  };
  scope?: 'occurrence' | 'following' | 'series';
  occurrenceId?: string | null;
  sourceId?: string;
  response?: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  createdAt: string;
};

export function calendarCacheRecordId(start: string, end: string, mode: string, sources: string) {
  return `${mode}:${start}:${end}:${sources || 'all'}`;
}

export async function readCachedCalendarRange(userId: string, recordId: string) {
  try {
    const record = await vaultSync.getRecord<CalendarRangeReadModel>(userId, CACHE_COLLECTION, recordId);
    return record && !record.tombstone ? record.payload : null;
  } catch {
    return null;
  }
}

export async function writeCachedCalendarRange(userId: string, recordId: string, payload: CalendarRangeReadModel) {
  try {
    await vaultSync.initialize(userId);
    await vaultSync.putRecord({
      userId,
      collection: CACHE_COLLECTION,
      recordId,
      recordType: 'calendar_range_read_model',
      payload,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // The backend remains canonical; cache failures must not block the calendar.
  }
}

export async function listCalendarOutbox(userId: string): Promise<CalendarOutboxItem[]> {
  try {
    await vaultSync.initialize(userId);
    const records = await vaultSync.listRecords<CalendarOutboxItem>(userId, OUTBOX_COLLECTION, { limit: 500 });
    return (records || [])
      .filter((record) => !record.tombstone)
      .map((record) => record.payload)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } catch {
    return [];
  }
}

export async function enqueueCalendarMutation(
  userId: string,
  input: Omit<CalendarOutboxItem, 'id' | 'createdAt'>,
) {
  const item: CalendarOutboxItem = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await vaultSync.initialize(userId);
  await vaultSync.putRecord({
    userId,
    collection: OUTBOX_COLLECTION,
    recordId: item.id,
    recordType: 'calendar_mutation',
    payload: item,
    updatedAt: item.createdAt,
  });
  return item;
}

export async function removeCalendarMutation(userId: string, id: string) {
  await vaultSync.tombstoneRecord(userId, OUTBOX_COLLECTION, id, 'calendar_mutation');
}

export function shouldQueueCalendarMutation(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('load failed')
    || message.includes('connection refused');
}

export async function purgeLegacyCalendarStorage(userId: string) {
  if (typeof window === 'undefined') return;
  const marker = `ritual:calendar-v2-cutover:${userId}`;
  if (window.localStorage.getItem(marker)) return;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && (LEGACY_KEYS.has(key) || LEGACY_PATTERN.test(key) || key.startsWith('calendar-scheduled-blocks-migrated:'))) keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));
  try {
    const records = await vaultSync.listRecords<unknown>(userId, LEGACY_COLLECTION, { limit: 5000 });
    await Promise.all((records || []).filter((record) => !record.tombstone).map((record) => vaultSync.tombstoneRecord(userId, LEGACY_COLLECTION, record.id, record.recordType)));
  } finally {
    window.localStorage.setItem(marker, new Date().toISOString());
  }
}
