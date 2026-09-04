'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateSelectArg, DatesSetArg, EventApi, EventClickArg, EventInput } from '@fullcalendar/core';
import { addDays, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarSearch, CheckCircle2, Copy, LoaderCircle, Search, Sparkles, Unplug, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import type { CalendarEvent, CalendarMode, CalendarRangeReadModel, CalendarSource, CalendarTaskSummary, CalendarView, RecurrenceScope } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@ritual/ui/dialog';
import { Input } from '@ritual/ui/input';
import { useAuth, useUser } from '@/lib/desktop-session';

import { applyCalendarProposals, completeCalendarTask, connectGoogleCalendar, createCalendarEvent, createCalendarTask, deleteCalendarEvent, findCalendarAvailability, publishCalendarEvent, readCalendarEvent, readCalendarRange, rejectCalendarProposal, rsvpCalendarEvent, searchCalendar, updateCalendarEvent, updateCalendarSource, type CalendarEventInput } from './calendar-api';
import { CalendarDock } from './calendar-dock';
import { CalendarEventEditor, type CalendarEditorSeed } from './calendar-event-editor';
import { CalendarInspector, type InspectorSelection } from './calendar-inspector';
import { calendarCacheRecordId, enqueueCalendarMutation, listCalendarOutbox, purgeLegacyCalendarStorage, readCachedCalendarRange, removeCalendarMutation, shouldQueueCalendarMutation, writeCachedCalendarRange, type CalendarOutboxItem } from './calendar-local-cache';
import { CalendarTaskInbox } from './calendar-task-inbox';
import { CalendarWorkflowLane } from './calendar-workflow-lane';
import { FullCalendarAdapter, type CalendarAdapterHandle } from './full-calendar-adapter';
import { useCalendarPreferences } from './use-calendar-preferences';
import './calendar-v2.css';

type VisibleRange = { start: Date; end: Date };

function initialRange(date: Date, view: CalendarView, weekStartsOn: 0 | 1): VisibleRange {
  if (view === 'month') return { start: startOfWeek(startOfMonth(date), { weekStartsOn }), end: addDays(endOfWeek(endOfMonth(date), { weekStartsOn }), 1) };
  if (view === 'week') return { start: startOfWeek(date, { weekStartsOn }), end: addDays(endOfWeek(date, { weekStartsOn }), 1) };
  return { start: startOfDay(date), end: addDays(startOfDay(date), 1) };
}

function occurrenceEvents(data: CalendarRangeReadModel | undefined, mode: CalendarMode, view: CalendarView, outbox: CalendarOutboxItem[]): EventInput[] {
  if (!data) return [];
  let calendarEvents = data.occurrences.map((item): EventInput => ({
    id: item.id,
    title: item.title,
    start: item.all_day ? item.start_date || undefined : item.start_at || undefined,
    end: item.all_day ? item.end_date || undefined : item.end_at || undefined,
    allDay: item.all_day,
    editable: item.origin !== 'google' || item.sync_state !== 'conflict',
    backgroundColor: item.source_color || undefined,
    borderColor: item.source_color || undefined,
    extendedProps: { eventId: item.event_id, occurrenceId: item.id, kind: item.kind, origin: item.origin, taskId: item.task_id, conflict: item.conflict, syncState: item.sync_state, providerEventType: item.provider_event_type },
  }));
  for (const mutation of outbox) {
    if (mutation.operation === 'delete' && mutation.eventId) {
      calendarEvents = calendarEvents.filter((item) => item.extendedProps?.eventId !== mutation.eventId);
      continue;
    }
    if (mutation.operation === 'update' && mutation.eventId && mutation.input) {
      calendarEvents = calendarEvents.map((item) => item.extendedProps?.eventId === mutation.eventId ? {
        ...item,
        title: mutation.input?.title || item.title,
        start: mutation.input?.all_day ? mutation.input.start_date || item.start : mutation.input?.start_at || item.start,
        end: mutation.input?.all_day ? mutation.input.end_date || item.end : mutation.input?.end_at || item.end,
        allDay: mutation.input?.all_day ?? item.allDay,
        extendedProps: { ...item.extendedProps, syncState: 'pending', outboxId: mutation.id },
      } : item);
      continue;
    }
    if (mutation.operation === 'create' && mutation.input) {
      calendarEvents.push({
        id: `outbox:${mutation.id}`,
        title: mutation.input.title,
        start: mutation.input.all_day ? mutation.input.start_date || undefined : mutation.input.start_at || undefined,
        end: mutation.input.all_day ? mutation.input.end_date || undefined : mutation.input.end_at || undefined,
        allDay: mutation.input.all_day,
        editable: false,
        extendedProps: { kind: mutation.input.kind || 'event', origin: mutation.input.origin || 'ritual', syncState: 'pending', outboxId: mutation.id },
      });
    }
  }
  const proposals = data.proposals.flatMap((proposal): EventInput[] => {
    const after = proposal.after;
    const allDay = Boolean(after.all_day);
    const start = String(allDay ? after.start_date || '' : after.start_at || '');
    const end = String(allDay ? after.end_date || '' : after.end_at || '');
    if (!start || !end || proposal.action === 'delete_event') return [];
    return [{ id: `proposal:${proposal.id}`, title: String(after.title || proposal.before?.title || 'Proposed calendar change'), start, end, allDay, editable: false, extendedProps: { proposal: true, kind: 'proposal', origin: 'ai', conflict: proposal.conflicts.length > 0 } }];
  });
  if (mode !== 'review') return [...calendarEvents, ...proposals];
  const activity = (data.review?.activity_sessions || []).flatMap((item, index): EventInput[] => {
    const row = item as Record<string, unknown>;
    const start = String(row.start_at || row.started_at || '');
    const end = String(row.end_at || row.finished_at || '');
    if (!start || !end) return [];
    return [{ id: `activity:${String(row.id || index)}`, title: String(row.project || row.title || row.application || 'Computer activity'), start, end, editable: false, extendedProps: { review: true, kind: 'actual_execution', origin: 'ritual' } }];
  });
  const habitMarkers = view === 'month' ? (data.review?.habit_markers || []).flatMap((item, index): EventInput[] => {
    const date = String(item.date || '');
    if (!date) return [];
    return [{ id: `habit:${String(item.id || index)}`, title: `✓ ${String(item.habit_name || 'Habit')}`, start: date, allDay: true, editable: false, extendedProps: { review: true, kind: 'habit_completion', origin: 'ritual' } }];
  }) : [];
  return [...calendarEvents, ...proposals, ...activity, ...habitMarkers];
}

function ProposalBar({ proposals, getToken, userId, onDone }: { proposals: CalendarRangeReadModel['proposals']; getToken: ReturnType<typeof useAuth>['getToken']; userId?: string; onDone: () => Promise<unknown> }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposals.map((item) => item.id)));
  useEffect(() => setSelected(new Set(proposals.map((item) => item.id))), [proposals]);
  if (!proposals.length) return null;
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="ritual-calendar-proposals"><div><Sparkles /><span><strong>AI scheduling preview</strong><small>{proposals.length} editable change{proposals.length === 1 ? '' : 's'} · review before applying</small></span></div><div className="ritual-calendar-proposal-list">{proposals.map((proposal) => <label key={proposal.id}><input type="checkbox" checked={selected.has(proposal.id)} onChange={() => toggle(proposal.id)} /><span>{String(proposal.after.title || proposal.before?.title || proposal.action.replaceAll('_', ' '))}</span>{proposal.conflicts.length ? <em>{proposal.conflicts.length} conflict</em> : null}<button type="button" onClick={() => void rejectCalendarProposal(getToken, userId, proposal.id).then(onDone)}>Dismiss</button></label>)}</div><Button variant="brand" size="compact" disabled={!selected.size} onClick={() => void applyCalendarProposals(getToken, userId, [...selected]).then((result) => { if (Object.keys(result.failed).length) toast.error('Some calendar changes need a fresh proposal'); else toast.success(`Applied ${result.applied.length} calendar changes`); return onDone(); })}>Apply {selected.size} change{selected.size === 1 ? '' : 's'}</Button></div>;
}

function SearchPanel({ open, onOpenChange, timezone, range, sourceIds, getToken, userId, onOpenEvent, onOpenTask }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  range: VisibleRange;
  sourceIds: string[];
  getToken: ReturnType<typeof useAuth>['getToken'];
  userId?: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTask: (task: CalendarTaskSummary) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchCalendar>> | null>(null);
  const [availability, setAvailability] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setResults(null); return; }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchCalendar(getToken, userId, query.trim()).then(setResults).catch(() => setResults(null)).finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [getToken, open, query, userId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogHeader className="border-b border-[var(--border-subtle)] px-5 py-4"><DialogTitle>Search and availability</DialogTitle><DialogDescription>Search events, tasks, projects, attendees, and workflows.</DialogDescription></DialogHeader>
        <div className="ritual-calendar-search-panel">
          <label><Search /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search calendar…" /></label>
          {loading ? <div className="ritual-calendar-search-empty"><LoaderCircle className="animate-spin" />Searching…</div> : null}
          {results ? <div className="ritual-calendar-search-results">
            {results.events.map((event) => <button key={event.id} onClick={() => { onOpenEvent(event); onOpenChange(false); }}><CalendarSearch /><span><strong>{event.title}</strong><small>{event.source_name || 'Ritual'} · {event.start_at ? new Date(event.start_at).toLocaleString() : event.start_date}</small></span></button>)}
            {results.tasks.map((task) => <button key={task.id} onClick={() => { onOpenTask(task); onOpenChange(false); }}><CheckCircle2 /><span><strong>{task.title}</strong><small>{task.project || 'Inbox'} · {task.allocation_count} allocations</small></span></button>)}
            {!results.events.length && !results.tasks.length ? <div className="ritual-calendar-search-empty">No matches</div> : null}
          </div> : null}
          <div className="ritual-calendar-availability-box">
            <div><strong>Availability in this view</strong><p>Confirmed busy events and task allocations block time; workflows and free events do not.</p></div>
            <Button variant="outline" onClick={() => {
              setLoading(true);
              void findCalendarAvailability(getToken, userId, { start: range.start.toISOString(), end: range.end.toISOString(), timezone, source_ids: sourceIds, minimum_minutes: 30 }).then((value) => setAvailability(value.formatted_text)).catch((error) => toast.error(error instanceof Error ? error.message : 'Availability failed')).finally(() => setLoading(false));
            }}>Find free time</Button>
            {availability ? <div className="ritual-calendar-availability-result"><pre>{availability}</pre><Button variant="ghost" size="icon-compact" aria-label="Copy availability" onClick={() => void navigator.clipboard.writeText(availability).then(() => toast.success('Availability copied'))}><Copy /></Button></div> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResizeHandle({ side, onResize }: { side: 'tasks' | 'agents'; onResize: (width: number) => void }) {
  return <div className="ritual-calendar-resize" role="separator" aria-label={`Resize ${side} pane`} aria-orientation="vertical" onPointerDown={(event) => {
    const origin = event.clientX;
    const element = event.currentTarget;
    const pane = side === 'tasks' ? element.previousElementSibling : element.nextElementSibling;
    const initial = pane?.getBoundingClientRect().width || 300;
    element.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => onResize(Math.max(240, Math.min(440, initial + (next.clientX - origin) * (side === 'tasks' ? 1 : -1))));
    const up = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
  }} />;
}

export function CalendarClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const adapterRef = useRef<CalendarAdapterHandle>(null);
  const { preferences, patchPreferences } = useCalendarPreferences();
  const [date, setDate] = useState(() => {
    const requested = searchParams.get('date');
    const parsed = requested ? new Date(`${requested}T12:00:00`) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });
  const [range, setRange] = useState(() => initialRange(date, preferences.view, preferences.week_starts_on));
  const [selection, setSelection] = useState<InspectorSelection | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSeed, setEditorSeed] = useState<CalendarEditorSeed | null>(null);
  const [editorEvent, setEditorEvent] = useState<CalendarEvent | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [outbox, setOutbox] = useState<CalendarOutboxItem[]>([]);

  const sourceKey = preferences.visible_source_ids.join(',');
  const rangeStart = range.start.toISOString();
  const rangeEnd = range.end.toISOString();
  const cacheId = calendarCacheRecordId(rangeStart, rangeEnd, preferences.mode, sourceKey);
  const queryKey = ['calendar-v2', user?.id, range.start.toISOString(), range.end.toISOString(), preferences.mode, sourceKey];
  const calendarQuery = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const fresh = await readCalendarRange(getToken, user?.id, { start: rangeStart, end: rangeEnd, timezone: preferences.timezone, mode: preferences.mode, sources: preferences.visible_source_ids.length ? preferences.visible_source_ids : undefined });
        if (user?.id) void writeCachedCalendarRange(user.id, cacheId, fresh);
        return fresh;
      } catch (error) {
        const cached = user?.id ? await readCachedCalendarRange(user.id, cacheId) : null;
        if (cached) return { ...cached, offline: true };
        throw error;
      }
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
  });
  const data = calendarQuery.data;
  const sources = useMemo(() => data?.sources || [], [data?.sources]);
  const events = useMemo(() => occurrenceEvents(data, preferences.mode, preferences.view, outbox), [data, outbox, preferences.mode, preferences.view]);

  useEffect(() => {
    if (user?.id) void purgeLegacyCalendarStorage(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) void listCalendarOutbox(user.id).then(setOutbox);
    else setOutbox([]);
  }, [user?.id]);

  useEffect(() => {
    if (!sources.length || preferences.visible_source_ids.length) return;
    patchPreferences({ visible_source_ids: sources.filter((source) => source.is_visible).map((source) => source.id), default_write_source_id: sources.find((source) => source.is_default_write)?.id || null });
  }, [patchPreferences, preferences.visible_source_ids.length, sources]);

  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['calendar-v2', user?.id] });
    window.addEventListener('ritual:calendar-changed', refresh);
    return () => window.removeEventListener('ritual:calendar-changed', refresh);
  }, [queryClient, user?.id]);

  useEffect(() => {
    if (!data) return;
    const taskId = searchParams.get('task');
    const workflowId = searchParams.get('workflow');
    const occurrenceId = searchParams.get('occurrence');
    if (taskId) {
      const task = data.tasks.find((item) => item.id === taskId);
      if (task) setSelection({ type: 'task', task });
      return;
    }
    if (workflowId) {
      const workflow = data.workflows.find((item) => item.id === workflowId || item.definition_id === workflowId || item.run_id === workflowId);
      if (workflow) setSelection({ type: 'workflow', workflow });
      return;
    }
    if (occurrenceId) {
      const occurrence = data.occurrences.find((item) => item.id === occurrenceId);
      if (occurrence) void readCalendarEvent(getToken, user?.id, occurrence.event_id).then((event) => setSelection({ type: 'event', event, occurrenceId })).catch(() => undefined);
    }
  }, [data, getToken, searchParams, user?.id]);

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['calendar-v2', user?.id] }), [queryClient, user?.id]);

  const refreshOutbox = useCallback(async () => {
    if (!user?.id) return [];
    const pending = await listCalendarOutbox(user.id);
    setOutbox(pending);
    return pending;
  }, [user?.id]);

  const queueMutation = useCallback(async (input: Omit<CalendarOutboxItem, 'id' | 'createdAt'>) => {
    if (!user?.id) throw new Error('Calendar changes require an active user');
    await enqueueCalendarMutation(user.id, input);
    await refreshOutbox();
  }, [refreshOutbox, user?.id]);

  const flushOutbox = useCallback(async () => {
    if (!user?.id || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    const pending = await listCalendarOutbox(user.id);
    let applied = 0;
    for (const item of pending) {
      try {
        if (item.operation === 'create' && item.input) await createCalendarEvent(getToken, user.id, item.input);
        else if (item.operation === 'update' && item.eventId && item.input) await updateCalendarEvent(getToken, user.id, item.eventId, item.input);
        else if (item.operation === 'delete' && item.eventId) await deleteCalendarEvent(getToken, user.id, item.eventId, item.scope || 'series', item.occurrenceId);
        else if (item.operation === 'publish' && item.eventId && item.sourceId) await publishCalendarEvent(getToken, user.id, item.eventId, item.sourceId);
        else if (item.operation === 'rsvp' && item.eventId && item.response) await rsvpCalendarEvent(getToken, user.id, item.eventId, item.response);
        else continue;
        await removeCalendarMutation(user.id, item.id);
        applied += 1;
      } catch {
        break;
      }
    }
    await refreshOutbox();
    if (applied) {
      toast.success(`Synced ${applied} offline calendar change${applied === 1 ? '' : 's'}`);
      await invalidate();
    }
  }, [getToken, invalidate, refreshOutbox, user?.id]);

  useEffect(() => {
    const flush = () => void flushOutbox();
    window.addEventListener('online', flush);
    void flushOutbox();
    return () => window.removeEventListener('online', flush);
  }, [flushOutbox]);

  const mutation = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Calendar change failed'),
  });

  const openOccurrence = useCallback(async (arg: EventClickArg) => {
    const eventId = String(arg.event.extendedProps.eventId || '');
    if (!eventId) return;
    try {
      const event = await readCalendarEvent(getToken, user?.id, eventId);
      setSelection({ type: 'event', event, occurrenceId: String(arg.event.extendedProps.occurrenceId || '') || null });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to open event'); }
  }, [getToken, user?.id]);

  const saveEditor = useCallback(async (input: CalendarEventInput, scope: RecurrenceScope) => {
    try {
      if (editorEvent) {
        const update = { ...input, recurrence_scope: scope, occurrence_id: selection?.type === 'event' ? selection.occurrenceId : null, expected_revision: editorEvent.revision };
        const updated = await updateCalendarEvent(getToken, user?.id, editorEvent.id, update);
        setSelection({ type: 'event', event: updated, occurrenceId: selection?.type === 'event' ? selection.occurrenceId : null });
        toast.success('Event updated');
      } else {
        const created = await createCalendarEvent(getToken, user?.id, input);
        setSelection({ type: 'event', event: created });
        toast.success(input.kind === 'task_allocation' ? 'Task allocated' : 'Event created');
      }
      await invalidate();
    } catch (error) {
      if (!shouldQueueCalendarMutation(error)) throw error;
      if (editorEvent) {
        await queueMutation({ operation: 'update', eventId: editorEvent.id, input: { ...input, recurrence_scope: scope, occurrence_id: selection?.type === 'event' ? selection.occurrenceId : null, expected_revision: editorEvent.revision } });
      } else {
        await queueMutation({ operation: 'create', input });
      }
      setSelection(null);
      toast.info('Calendar change saved offline and will sync when connected');
    }
  }, [editorEvent, getToken, invalidate, queueMutation, selection, user?.id]);

  const handleMove = useCallback((eventApi: EventApi, revert: () => void) => {
    const eventId = String(eventApi.extendedProps.eventId || '');
    if (!eventId || !eventApi.start || !eventApi.end) { revert(); return; }
    const startAt = eventApi.start.toISOString();
    const endAt = eventApi.end.toISOString();
    const input = { start_at: startAt, end_at: endAt, all_day: eventApi.allDay, recurrence_scope: 'occurrence' as const, occurrence_id: String(eventApi.extendedProps.occurrenceId || '') || null };
    mutation.mutate(async () => {
      try { return await updateCalendarEvent(getToken, user?.id, eventId, input); }
      catch (error) {
        if (!shouldQueueCalendarMutation(error)) { revert(); throw error; }
        await queueMutation({ operation: 'update', eventId, input: { ...input, title: eventApi.title, timezone: preferences.timezone } as CalendarOutboxItem['input'] });
        toast.info('Move saved offline');
      }
    });
  }, [getToken, mutation, preferences.timezone, queueMutation, user?.id]);

  const handleTaskAllocate = useCallback((taskId: string, start: Date, end: Date) => {
    const task = data?.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const input: CalendarEventInput = { title: task.title, description: task.notes, kind: 'task_allocation', origin: 'ritual', task_id: task.id, source_id: sources.find((source) => !source.account_id)?.id || null, start_at: start.toISOString(), end_at: end.toISOString(), timezone: preferences.timezone, all_day: false, availability: 'busy', client_event_id: crypto.randomUUID() };
    mutation.mutate(async () => {
      try { return await createCalendarEvent(getToken, user?.id, input); }
      catch (error) {
        if (!shouldQueueCalendarMutation(error)) throw error;
        await queueMutation({ operation: 'create', input });
        toast.info('Task allocation saved offline');
      }
    });
  }, [data?.tasks, getToken, mutation, preferences.timezone, queueMutation, sources, user?.id]);

  const handleDelete = useCallback((event: CalendarEvent, scope: RecurrenceScope, occurrenceId?: string | null) => {
    mutation.mutate(async () => {
      try { await deleteCalendarEvent(getToken, user?.id, event.id, scope, occurrenceId); }
      catch (error) {
        if (!shouldQueueCalendarMutation(error)) throw error;
        await queueMutation({ operation: 'delete', eventId: event.id, scope, occurrenceId });
        toast.info('Deletion saved offline');
      }
      setSelection(null);
    });
  }, [getToken, mutation, queueMutation, user?.id]);

  const handlePublish = useCallback((event: CalendarEvent, sourceId: string) => {
    mutation.mutate(async () => {
      try {
        const updated = await publishCalendarEvent(getToken, user?.id, event.id, sourceId);
        setSelection({ type: 'event', event: updated });
      } catch (error) {
        if (!shouldQueueCalendarMutation(error)) throw error;
        await queueMutation({ operation: 'publish', eventId: event.id, sourceId });
        toast.info('Publication is pending connectivity');
      }
    });
  }, [getToken, mutation, queueMutation, user?.id]);

  const handleRsvp = useCallback((event: CalendarEvent, response: 'accepted' | 'declined' | 'tentative' | 'needsAction') => {
    mutation.mutate(async () => {
      try {
        const updated = await rsvpCalendarEvent(getToken, user?.id, event.id, response);
        setSelection({ type: 'event', event: updated });
      } catch (error) {
        if (!shouldQueueCalendarMutation(error)) throw error;
        await queueMutation({ operation: 'rsvp', eventId: event.id, response });
        toast.info('RSVP is pending connectivity');
      }
    });
  }, [getToken, mutation, queueMutation, user?.id]);

  const setView = (view: CalendarView) => { patchPreferences({ view }); setRange(initialRange(date, view, preferences.week_starts_on)); };
  const onDatesSet = (arg: DatesSetArg) => { setRange({ start: arg.start, end: arg.end }); setDate(arg.view.currentStart); };
  const createAtDefaultTime = () => {
    const start = new Date(date);
    start.setHours(Math.floor(preferences.workday_start_minutes / 60), preferences.workday_start_minutes % 60, 0, 0);
    setEditorEvent(null);
    setEditorSeed({ start, end: new Date(start.getTime() + preferences.default_duration_minutes * 60_000), allDay: false });
    setEditorOpen(true);
  };
  const allocateTaskWithKeyboard = (task: CalendarTaskSummary) => {
    const start = new Date(date);
    start.setHours(Math.floor(preferences.workday_start_minutes / 60), preferences.workday_start_minutes % 60, 0, 0);
    setEditorEvent(null);
    setEditorSeed({
      start,
      end: new Date(start.getTime() + preferences.default_duration_minutes * 60_000),
      allDay: false,
      title: task.title,
      description: task.notes,
      kind: 'task_allocation',
      taskId: task.id,
      sourceId: sources.find((source) => !source.account_id)?.id || null,
    });
    setEditorOpen(true);
  };
  const sourceIds = preferences.visible_source_ids.length ? preferences.visible_source_ids : sources.filter((source) => source.is_visible).map((source) => source.id);

  return (
    <div className={`ritual-calendar-shell view-${preferences.view} mode-${preferences.mode}`}>
      <div className="ritual-calendar-topline">
        <div><span>Calendar</span><strong>{preferences.mode === 'plan' ? 'Protect your intentions.' : 'Compare the plan with what happened.'}</strong></div>
        <div className="ritual-calendar-sync-state">{outbox.length ? <><LoaderCircle />{outbox.length} pending offline</> : calendarQuery.isFetching ? <><LoaderCircle className="animate-spin" />Refreshing</> : data?.sync.some((item) => item.status === 'error') ? <><AlertTriangle />Sync needs attention</> : <><CheckCircle2 />Up to date</>}</div>
      </div>
      <div className="ritual-calendar-workspace">
        {preferences.tasks_open ? <><div style={{ width: preferences.pane_widths.tasks }} className="ritual-calendar-pane-wrapper is-tasks"><CalendarTaskInbox tasks={data?.tasks || []} defaultDurationMinutes={preferences.default_duration_minutes} onCreate={async (title) => { await createCalendarTask(getToken, user?.id, title); await invalidate(); }} onComplete={(task) => mutation.mutate(() => completeCalendarTask(getToken, user?.id, task.id))} onInspect={(task) => setSelection({ type: 'task', task })} onClose={() => patchPreferences({ tasks_open: false })} /></div><ResizeHandle side="tasks" onResize={(width) => patchPreferences({ pane_widths: { ...preferences.pane_widths, tasks: width } })} /></> : null}
        <main className="ritual-calendar-human" aria-label="Human schedule">
          {calendarQuery.isLoading ? <div className="ritual-calendar-loading"><LoaderCircle className="animate-spin" /><span>Loading your calendar…</span></div> : calendarQuery.isError ? <div className="ritual-calendar-error"><Unplug /><strong>Calendar is offline</strong><p>Ritual will retry when the local backend is available.</p><Button variant="outline" onClick={() => void calendarQuery.refetch()}>Try again</Button></div> : <FullCalendarAdapter ref={adapterRef} view={preferences.view} date={date} events={events} preferences={preferences} onRangeChange={onDatesSet} onSelectRange={(arg: DateSelectArg) => { setEditorEvent(null); setEditorSeed({ start: arg.start, end: arg.end, allDay: arg.allDay }); setEditorOpen(true); }} onEventClick={(arg) => void openOccurrence(arg)} onEventChange={handleMove} onTaskAllocate={handleTaskAllocate} />}
          {preferences.mode === 'review' && data?.review ? <div className="ritual-calendar-review-strip"><span><strong>{data.review.planned_minutes}</strong> planned minutes</span><span><strong>{data.review.attributable_actual_minutes}</strong> linked actual minutes</span><span><strong>{data.review.completed_task_count}</strong> completed tasks</span><span><strong>{data.review.habit_markers.length}</strong> habit check-ins</span><p>Evidence and correlations only; no causal health claims.</p></div> : null}
          {data?.proposals.length ? <ProposalBar proposals={data.proposals} getToken={getToken} userId={user?.id} onDone={invalidate} /> : null}
        </main>
        {preferences.agents_open && preferences.view === 'day' ? <><ResizeHandle side="agents" onResize={(width) => patchPreferences({ pane_widths: { ...preferences.pane_widths, agents: width } })} /><div style={{ width: preferences.pane_widths.agents }} className="ritual-calendar-pane-wrapper is-agents"><CalendarWorkflowLane items={data?.workflows || []} day={date} onInspect={(workflow) => setSelection({ type: 'workflow', workflow })} onClose={() => patchPreferences({ agents_open: false })} /></div></> : null}
        {selection ? <CalendarInspector selection={selection} writableSources={sources.filter((source) => source.writable)} onClose={() => setSelection(null)} onEdit={(event) => { setEditorEvent(event); setEditorSeed(null); setEditorOpen(true); }} onDelete={handleDelete} onPublish={handlePublish} onRsvp={handleRsvp} onAllocateTask={allocateTaskWithKeyboard} /> : null}
      </div>
      <CalendarDock date={date} view={preferences.view} mode={preferences.mode} sources={sources} tasksOpen={preferences.tasks_open} agentsOpen={preferences.agents_open} onToday={() => adapterRef.current?.goToday()} onPrevious={() => adapterRef.current?.goPrevious()} onNext={() => adapterRef.current?.goNext()} onView={setView} onMode={(mode) => patchPreferences({ mode })} onToggleSource={(source: CalendarSource) => { const visible = sourceIds.includes(source.id); if (visible && sourceIds.length === 1) { toast.info('Keep at least one calendar visible'); return; } const next = visible ? sourceIds.filter((id) => id !== source.id) : [...sourceIds, source.id]; patchPreferences({ visible_source_ids: next }); mutation.mutate(() => updateCalendarSource(getToken, user?.id, source.id, { is_visible: !visible })); }} onToggleTasks={() => patchPreferences({ tasks_open: !preferences.tasks_open })} onToggleAgents={() => patchPreferences({ agents_open: !preferences.agents_open })} onCreateEvent={createAtDefaultTime} onSearch={() => setSearchOpen(true)} />
      {!sources.some((source) => source.provider === 'google') && !calendarQuery.isLoading ? <button className="ritual-calendar-connect" onClick={() => mutation.mutate(async () => { const result = await connectGoogleCalendar(getToken, user?.id); window.location.assign(result.authorization_url); })}><CalendarSearch /><span><strong>Connect Google Calendar</strong><small>Explicitly sync selected calendar data with Ritual</small></span><X className="opacity-0" /></button> : null}
      <CalendarEventEditor open={editorOpen} event={editorEvent} seed={editorSeed} sources={sources} timezone={preferences.timezone} onOpenChange={setEditorOpen} onSave={saveEditor} />
      <SearchPanel open={searchOpen} onOpenChange={setSearchOpen} timezone={preferences.timezone} range={range} sourceIds={sourceIds} getToken={getToken} userId={user?.id} onOpenEvent={(event) => setSelection({ type: 'event', event })} onOpenTask={(task) => setSelection({ type: 'task', task })} />
    </div>
  );
}
