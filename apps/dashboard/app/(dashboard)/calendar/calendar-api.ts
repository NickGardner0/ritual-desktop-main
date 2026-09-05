'use client';

import type {
  CalendarEvent,
  CalendarRangeReadModel,
  CalendarSource,
  CalendarTaskSummary,
  RecurrenceScope,
} from '@ritual/shared-contracts';

import { apiFetchWithAuth } from '@/lib/api/client';

type GetToken = (options?: { skipCache?: boolean }) => Promise<string | null>;

export type CalendarEventInput = {
  title: string;
  description?: string | null;
  source_id?: string | null;
  kind?: 'event' | 'task_allocation';
  origin?: 'ritual' | 'google' | 'ai';
  start_at?: string | null;
  end_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  timezone: string;
  all_day: boolean;
  status?: 'confirmed' | 'tentative' | 'canceled';
  availability?: 'busy' | 'free';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  location?: Record<string, unknown>;
  conference?: Record<string, unknown>;
  organizer?: Record<string, unknown>;
  attendees?: Array<Record<string, unknown>>;
  reminders?: Record<string, unknown>;
  recurrence?: string[];
  task_id?: string | null;
  client_event_id?: string | null;
};

async function requestJson<T>(
  path: string,
  getToken: GetToken,
  userId?: string | null,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetchWithAuth(path, getToken, { ...init, userId });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message?: unknown }).message)
        : `Calendar request failed (${response.status})`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function readCalendarRange(
  getToken: GetToken,
  userId: string | undefined,
  input: { start: string; end: string; timezone: string; mode: 'plan' | 'review'; sources?: string[] },
) {
  const query = new URLSearchParams({
    start: input.start,
    end: input.end,
    timezone: input.timezone,
    mode: input.mode,
  });
  if (input.sources?.length) query.set('sources', input.sources.join(','));
  return requestJson<CalendarRangeReadModel>(`/api/calendar/range?${query}`, getToken, userId);
}

export function readCalendarEvent(getToken: GetToken, userId: string | undefined, id: string) {
  return requestJson<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(id)}`, getToken, userId);
}

export function searchCalendar(getToken: GetToken, userId: string | undefined, query: string) {
  return requestJson<{
    events: CalendarEvent[];
    tasks: CalendarTaskSummary[];
    workflows: Array<{ id: string; name: string; start_at: string; end_at: string; status: string }>;
  }>(`/api/calendar/search?q=${encodeURIComponent(query)}`, getToken, userId);
}

export function findCalendarAvailability(
  getToken: GetToken,
  userId: string | undefined,
  input: {
    start: string;
    end: string;
    timezone: string;
    minimum_minutes?: number;
    source_ids?: string[];
    workday_start_minutes?: number;
    workday_end_minutes?: number;
  },
) {
  return requestJson<{ formatted_text: string; windows: Array<{ start_at: string; end_at: string }> }>(
    '/api/calendar/availability',
    getToken,
    userId,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function createCalendarEvent(getToken: GetToken, userId: string | undefined, input: CalendarEventInput) {
  return requestJson<CalendarEvent>('/api/calendar/events', getToken, userId, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCalendarEvent(
  getToken: GetToken,
  userId: string | undefined,
  id: string,
  input: Partial<CalendarEventInput> & {
    recurrence_scope?: RecurrenceScope;
    occurrence_id?: string | null;
    expected_revision?: number;
  },
) {
  return requestJson<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(id)}`, getToken, userId, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteCalendarEvent(
  getToken: GetToken,
  userId: string | undefined,
  id: string,
  scope: RecurrenceScope,
  occurrenceId?: string | null,
) {
  const query = new URLSearchParams({ scope });
  if (occurrenceId) query.set('occurrence_id', occurrenceId);
  return requestJson<{ success: boolean }>(
    `/api/calendar/events/${encodeURIComponent(id)}?${query}`,
    getToken,
    userId,
    { method: 'DELETE' },
  );
}

export function publishCalendarEvent(getToken: GetToken, userId: string | undefined, id: string, sourceId: string) {
  return requestJson<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(id)}/publish`, getToken, userId, {
    method: 'POST',
    body: JSON.stringify({ source_id: sourceId }),
  });
}

export function rsvpCalendarEvent(
  getToken: GetToken,
  userId: string | undefined,
  id: string,
  response: 'accepted' | 'declined' | 'tentative' | 'needsAction',
) {
  return requestJson<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(id)}/rsvp`, getToken, userId, {
    method: 'POST',
    body: JSON.stringify({ response }),
  });
}

export function updateCalendarSource(
  getToken: GetToken,
  userId: string | undefined,
  sourceId: string,
  input: Partial<Pick<CalendarSource, 'is_visible' | 'is_default_write' | 'color'>>,
) {
  return requestJson<CalendarSource>(`/api/calendar/sources/${encodeURIComponent(sourceId)}`, getToken, userId, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function createCalendarTask(getToken: GetToken, userId: string | undefined, title: string) {
  return requestJson<CalendarTaskSummary>('/api/tasks', getToken, userId, {
    method: 'POST',
    body: JSON.stringify({ title, source: 'manual', status: 'open', client_event_id: crypto.randomUUID() }),
  });
}

export function completeCalendarTask(getToken: GetToken, userId: string | undefined, id: string) {
  return requestJson<CalendarTaskSummary>(`/api/tasks/${encodeURIComponent(id)}`, getToken, userId, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }),
  });
}

export function connectGoogleCalendar(getToken: GetToken, userId: string | undefined) {
  return requestJson<{ authorization_url: string }>(
    '/api/integrations/google-calendar/connect?return_url=%2Fcalendar',
    getToken,
    userId,
    { method: 'POST' },
  );
}

export function applyCalendarProposals(getToken: GetToken, userId: string | undefined, proposalIds: string[]) {
  return requestJson<{ applied: string[]; failed: Record<string, string>; events: CalendarEvent[] }>(
    '/api/calendar/proposals/apply',
    getToken,
    userId,
    { method: 'POST', body: JSON.stringify({ proposal_ids: proposalIds }) },
  );
}

export function rejectCalendarProposal(getToken: GetToken, userId: string | undefined, proposalId: string) {
  return requestJson<{ success: boolean }>(
    `/api/calendar/proposals/${encodeURIComponent(proposalId)}/reject`,
    getToken,
    userId,
    { method: 'POST' },
  );
}
