/** Calendar V2 read, availability, and approval-gated proposal executors. */

import { fetchPythonApi, fetchPythonApiPost, getTimezoneYmd } from './shared-api.js';

const CALENDAR_TIMEOUT_MS = 8000;

function dayAfter(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function executeGetCalendarEvents(
  token: string,
  params: { startDate?: string; endDate?: string; mode?: 'plan' | 'review' },
  timezone?: string,
) {
  const today = getTimezoneYmd(new Date(), timezone);
  const startDate = params.startDate || today;
  const endDate = params.endDate || today;
  try {
    const response = await fetchPythonApi('/api/calendar/range', token, {
      start: `${startDate}T00:00:00Z`,
      end: `${dayAfter(endDate)}T00:00:00Z`,
      timezone: timezone || 'UTC',
      mode: params.mode || 'plan',
    }, { timeoutMs: CALENDAR_TIMEOUT_MS });
    const events = (response.occurrences || []).map((item: Record<string, unknown>) => ({
      id: item.event_id,
      occurrence_id: item.id,
      title: item.title,
      start: item.start_at || item.start_date,
      end: item.end_at || item.end_date,
      all_day: item.all_day,
      kind: item.kind,
      source: item.source_name,
      conflict: item.conflict,
      sync_state: item.sync_state,
    }));
    return JSON.stringify({
      success: true,
      start_date: startDate,
      end_date: endDate,
      timezone: response.timezone,
      mode: response.mode,
      events,
      tasks: response.tasks || [],
      workflows: response.workflows || [],
      review: response.review || null,
      pending_proposals: response.proposals || [],
      event_count: events.length,
    });
  } catch (error) {
    console.error('getCalendarEvents error:', error);
    return JSON.stringify({ success: false, error: 'Calendar data is currently unavailable.' });
  }
}

export async function executeSearchCalendar(token: string, params: { query: string }) {
  try {
    const response = await fetchPythonApi('/api/calendar/search', token, { q: params.query }, { timeoutMs: CALENDAR_TIMEOUT_MS });
    return JSON.stringify({ success: true, ...response });
  } catch (error) {
    return JSON.stringify({ success: false, error: String(error) });
  }
}

export async function executeFindCalendarAvailability(token: string, params: {
  start: string;
  end: string;
  timezone?: string;
  minimumMinutes?: number;
  workdayStartMinutes?: number;
  workdayEndMinutes?: number;
}) {
  try {
    const response = await fetchPythonApiPost('/api/calendar/availability', token, {
      start: params.start,
      end: params.end,
      timezone: params.timezone || 'UTC',
      minimum_minutes: params.minimumMinutes || 30,
      workday_start_minutes: params.workdayStartMinutes || 480,
      workday_end_minutes: params.workdayEndMinutes || 1080,
    }, { timeoutMs: CALENDAR_TIMEOUT_MS });
    return JSON.stringify({ success: true, ...response });
  } catch (error) {
    return JSON.stringify({ success: false, error: String(error) });
  }
}

type ProposalChange = {
  action: 'create_event' | 'update_event' | 'move_event' | 'resize_event' | 'delete_event' | 'rsvp' | 'publish' | 'create_task_allocation';
  event_id?: string;
  occurrence_id?: string;
  recurrence_scope?: 'occurrence' | 'following' | 'series';
  after?: Record<string, unknown>;
};

export async function executeProposeCalendarChanges(
  token: string,
  params: { changes: ProposalChange[] },
  conversationId?: string | null,
) {
  try {
    const proposals = await fetchPythonApiPost('/api/calendar/proposals', token, {
      changes: params.changes,
      conversation_id: conversationId || null,
    }, { timeoutMs: CALENDAR_TIMEOUT_MS });
    return JSON.stringify({
      success: true,
      persisted_calendar_changes: false,
      approval_required: true,
      proposals,
      message: `Prepared ${proposals.length} editable calendar change${proposals.length === 1 ? '' : 's'}. The user must select and apply them in Calendar.`,
    });
  } catch (error) {
    return JSON.stringify({ success: false, error: String(error) });
  }
}
