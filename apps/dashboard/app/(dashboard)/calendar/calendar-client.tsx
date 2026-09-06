'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateSelectArg, DatesSetArg, EventApi, EventClickArg, EventInput } from '@fullcalendar/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, CheckCircle2, LoaderCircle, Search, Sparkles, Unplug } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import type { CalendarEvent, CalendarMode, CalendarRangeReadModel, CalendarSource, CalendarTaskSummary, CalendarView, RecurrenceScope } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@ritual/ui/dialog';
import { Input } from '@ritual/ui/input';
import { useAuth, useUser } from '@/lib/desktop-session';

import { applyCalendarProposals, completeCalendarTask, connectGoogleCalendar, createCalendarEvent, createCalendarTask, deleteCalendarEvent, findCalendarAvailability, publishCalendarEvent, readCalendarEvent, readCalendarRange, rejectCalendarProposal, rsvpCalendarEvent, searchCalendar, updateCalendarEvent, updateCalendarSource, type CalendarEventInput } from './calendar-api';
import { CalendarEventDetails, type CalendarEventSelection } from './calendar-event-details';
import { CalendarEventEditor, type CalendarEditorSeed } from './calendar-event-editor';
import { calendarPeriodLabel, calendarSelectionSeed, calendarVisibleRange, defaultTimedSelection, rangeContainsDate, type VisibleRange } from './calendar-helpers';
import { CalendarHeader } from './calendar-header';
import { calendarCacheRecordId, enqueueCalendarMutation, listCalendarOutbox, purgeLegacyCalendarStorage, readCachedCalendarRange, removeCalendarMutation, shouldQueueCalendarMutation, writeCachedCalendarRange, type CalendarOutboxItem } from './calendar-local-cache';
import { CalendarSidePanel } from './calendar-side-panel';
import { CalendarTaskInbox } from './calendar-task-inbox';
import { FullCalendarAdapter, type CalendarAdapterHandle } from './full-calendar-adapter';
import { useCalendarPreferences } from './use-calendar-preferences';
import './calendar-v2.css';

function occurrenceEvents(
  data: CalendarRangeReadModel | undefined,
  mode: CalendarMode,
  view: CalendarView,
  outbox: CalendarOutboxItem[],
): EventInput[] {
  if (!data) return [];
  const sourceById = new Map(data.sources.map((source) => [source.id, source]));
  let calendarEvents = data.occurrences.map((item): EventInput => {
    const source = item.source_id ? sourceById.get(item.source_id) : null;
    const editable = Boolean(source?.writable) && item.sync_state !== 'conflict' && item.status !== 'canceled';
    return {
      id: item.id,
      title: item.title,
      start: item.all_day ? item.start_date || undefined : item.start_at || undefined,
      end: item.all_day ? item.end_date || undefined : item.end_at || undefined,
      allDay: item.all_day,
      editable,
      startEditable: editable,
      durationEditable: editable,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: 'inherit',
      extendedProps: {
        eventId: item.event_id,
        occurrenceId: item.id,
        kind: item.kind,
        origin: item.origin,
        taskId: item.task_id,
        status: item.status,
        responseStatus: item.self_response_status,
        location: String(item.location?.displayName || item.location?.name || ''),
        conflict: item.conflict,
        syncState: item.sync_state,
        providerEventType: item.provider_event_type,
        sourceColor: item.source_color,
      },
    };
  });
  for (const queued of outbox) {
    if (queued.operation === 'delete' && queued.eventId) {
      calendarEvents = calendarEvents.filter((item) => item.extendedProps?.eventId !== queued.eventId);
    } else if (queued.operation === 'update' && queued.eventId && queued.input) {
      calendarEvents = calendarEvents.map((item) => item.extendedProps?.eventId === queued.eventId ? {
        ...item,
        title: queued.input?.title || item.title,
        start: queued.input?.all_day ? queued.input.start_date || item.start : queued.input?.start_at || item.start,
        end: queued.input?.all_day ? queued.input.end_date || item.end : queued.input?.end_at || item.end,
        allDay: queued.input?.all_day ?? item.allDay,
        extendedProps: { ...item.extendedProps, syncState: 'pending', outboxId: queued.id },
      } : item);
    } else if (queued.operation === 'create' && queued.input) {
      calendarEvents.push({
        id: `outbox:${queued.id}`,
        title: queued.input.title,
        start: queued.input.all_day ? queued.input.start_date || undefined : queued.input.start_at || undefined,
        end: queued.input.all_day ? queued.input.end_date || undefined : queued.input.end_at || undefined,
        allDay: queued.input.all_day,
        editable: false,
        extendedProps: { kind: queued.input.kind || 'event', origin: queued.input.origin || 'ritual', syncState: 'pending', outboxId: queued.id },
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
    const markerDate = String(item.date || '');
    if (!markerDate) return [];
    return [{ id: `habit:${String(item.id || index)}`, title: `✓ ${String(item.habit_name || 'Habit')}`, start: markerDate, allDay: true, editable: false, extendedProps: { review: true, kind: 'habit_completion', origin: 'ritual' } }];
  }) : [];
  return [...calendarEvents, ...proposals, ...activity, ...habitMarkers];
}

function ProposalBar({ proposals, getToken, userId, onDone }: { proposals: CalendarRangeReadModel['proposals']; getToken: ReturnType<typeof useAuth>['getToken']; userId?: string; onDone: () => Promise<unknown> }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(proposals.map((item) => item.id)));
  useEffect(() => setSelected(new Set(proposals.map((item) => item.id))), [proposals]);
  if (!proposals.length) return null;
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="ritual-calendar-proposals"><div><Sparkles /><span><strong>AI scheduling preview</strong><small>{proposals.length} editable change{proposals.length === 1 ? '' : 's'} · review before applying</small></span></div><div className="ritual-calendar-proposal-list">{proposals.map((proposal) => <label key={proposal.id}><input type="checkbox" checked={selected.has(proposal.id)} onChange={() => toggle(proposal.id)} /><span>{String(proposal.after.title || proposal.before?.title || proposal.action.replaceAll('_', ' '))}</span>{proposal.conflicts.length ? <em>{proposal.conflicts.length} conflict</em> : null}<button type="button" onClick={() => void rejectCalendarProposal(getToken, userId, proposal.id).then(onDone)}>Dismiss</button></label>)}</div><Button variant="brand" size="compact" disabled={!selected.size} onClick={() => void applyCalendarProposals(getToken, userId, [...selected]).then((result) => { if (Object.keys(result.failed).length) toast.error('Some calendar changes need a fresh proposal'); else toast.success(`Applied ${result.applied.length} calendar changes`); return onDone(); })}>Apply {selected.size}</Button></div>;
}

function SearchPanel({ open, onOpenChange, getToken, userId, onOpenEvent, onOpenTask }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getToken: ReturnType<typeof useAuth>['getToken'];
  userId?: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenTask: (task: CalendarTaskSummary) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchCalendar>> | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setResults(null); return; }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchCalendar(getToken, userId, query.trim()).then(setResults).catch(() => setResults(null)).finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [getToken, open, query, userId]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-lg p-0"><DialogHeader className="border-b border-[var(--border-subtle)] px-5 py-4"><DialogTitle>Search calendar</DialogTitle><DialogDescription>Find events, attendees, projects, and tasks.</DialogDescription></DialogHeader><div className="ritual-calendar-search-panel"><label><Search /><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search calendar…" /></label>{loading ? <div className="ritual-calendar-search-empty"><LoaderCircle className="animate-spin" />Searching…</div> : null}{results ? <div className="ritual-calendar-search-results">{results.events.map((event) => <button key={event.id} onClick={() => { onOpenEvent(event); onOpenChange(false); }}><CalendarDays /><span><strong>{event.title}</strong><small>{event.source_name || 'Ritual'} · {event.start_at ? new Date(event.start_at).toLocaleString() : event.start_date}</small></span></button>)}{results.tasks.map((task) => <button key={task.id} onClick={() => { onOpenTask(task); onOpenChange(false); }}><CheckCircle2 /><span><strong>{task.title}</strong><small>{task.project || 'Inbox'} · {task.allocation_count} allocations</small></span></button>)}{!results.events.length && !results.tasks.length ? <div className="ritual-calendar-search-empty">No matches</div> : null}</div> : null}</div></DialogContent></Dialog>;
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
  const [range, setRange] = useState<VisibleRange>(() => calendarVisibleRange(date, preferences.view, preferences.week_starts_on));
  const [selection, setSelection] = useState<CalendarEventSelection | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSeed, setEditorSeed] = useState<CalendarEditorSeed | null>(null);
  const [editorEvent, setEditorEvent] = useState<CalendarEvent | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingSearchFocus, setPendingSearchFocus] = useState<CalendarEvent | null>(null);
  const [copying, setCopying] = useState(false);
  const [outbox, setOutbox] = useState<CalendarOutboxItem[]>([]);

  const sourceKey = preferences.visible_source_ids.join(',');
  const rangeStart = range.start.toISOString();
  const rangeEnd = range.end.toISOString();
  const cacheId = calendarCacheRecordId(rangeStart, rangeEnd, preferences.mode, sourceKey);
  const queryKey = ['calendar-v2', user?.id, rangeStart, rangeEnd, preferences.mode, sourceKey];
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
  const sourceIds = preferences.visible_source_ids.length ? preferences.visible_source_ids : sources.filter((source) => source.is_visible).map((source) => source.id);

  useEffect(() => { if (user?.id) void purgeLegacyCalendarStorage(user.id); }, [user?.id]);
  useEffect(() => { if (user?.id) void listCalendarOutbox(user.id).then(setOutbox); else setOutbox([]); }, [user?.id]);
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
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => {
    if (!data) return;
    const taskId = searchParams.get('task');
    const occurrenceId = searchParams.get('occurrence');
    if (taskId && data.tasks.some((item) => item.id === taskId)) patchPreferences({ tasks_open: true });
    if (occurrenceId) {
      const occurrence = data.occurrences.find((item) => item.id === occurrenceId);
      if (occurrence) void readCalendarEvent(getToken, user?.id, occurrence.event_id).then((event) => setSelection({ event, occurrenceId })).catch(() => undefined);
    }
  }, [data, getToken, patchPreferences, searchParams, user?.id]);
  useEffect(() => {
    if (!pendingSearchFocus) return;
    let attempts = 0;
    let timer = 0;
    const focus = () => {
      const bounds = adapterRef.current?.focusEvent(pendingSearchFocus.id);
      if (bounds) {
        setSelection({ event: pendingSearchFocus, anchorRect: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height } });
        setPendingSearchFocus(null);
        return;
      }
      attempts += 1;
      if (attempts < 20) timer = window.setTimeout(focus, 100);
      else setPendingSearchFocus(null);
    };
    timer = window.setTimeout(focus, 0);
    return () => window.clearTimeout(timer);
  }, [events, pendingSearchFocus]);

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ['calendar-v2', user?.id] }), [queryClient, user?.id]);
  const refreshOutbox = useCallback(async () => { if (!user?.id) return []; const pending = await listCalendarOutbox(user.id); setOutbox(pending); return pending; }, [user?.id]);
  const queueMutation = useCallback(async (input: Omit<CalendarOutboxItem, 'id' | 'createdAt'>) => { if (!user?.id) throw new Error('Calendar changes require an active user'); await enqueueCalendarMutation(user.id, input); await refreshOutbox(); }, [refreshOutbox, user?.id]);
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
      } catch { break; }
    }
    await refreshOutbox();
    if (applied) { toast.success(`Synced ${applied} offline calendar change${applied === 1 ? '' : 's'}`); await invalidate(); }
  }, [getToken, invalidate, refreshOutbox, user?.id]);
  useEffect(() => { const flush = () => void flushOutbox(); window.addEventListener('online', flush); void flushOutbox(); return () => window.removeEventListener('online', flush); }, [flushOutbox]);

  const mutation = useMutation({ mutationFn: async (work: () => Promise<unknown>) => work(), onSuccess: () => void invalidate(), onError: (error) => toast.error(error instanceof Error ? error.message : 'Calendar change failed') });
  const openOccurrence = useCallback(async (arg: EventClickArg) => {
    const eventId = String(arg.event.extendedProps.eventId || '');
    if (!eventId) return;
    try {
      const event = await readCalendarEvent(getToken, user?.id, eventId);
      const bounds = arg.el.getBoundingClientRect();
      setSelection({ event, occurrenceId: String(arg.event.extendedProps.occurrenceId || '') || null, anchorRect: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height } });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to open event'); }
  }, [getToken, user?.id]);

  const saveEditor = useCallback(async (input: CalendarEventInput, scope: RecurrenceScope) => {
    try {
      if (editorEvent) {
        const update = { ...input, recurrence_scope: scope, occurrence_id: selection?.occurrenceId || null, expected_revision: editorEvent.revision };
        const updated = await updateCalendarEvent(getToken, user?.id, editorEvent.id, update);
        setSelection({ event: updated, occurrenceId: selection?.occurrenceId || null });
        toast.success('Event updated');
      } else {
        const created = await createCalendarEvent(getToken, user?.id, input);
        setSelection({ event: created });
        toast.success(input.kind === 'task_allocation' ? 'Task scheduled' : 'Event created');
      }
      await invalidate();
    } catch (error) {
      if (!shouldQueueCalendarMutation(error)) throw error;
      if (editorEvent) await queueMutation({ operation: 'update', eventId: editorEvent.id, input: { ...input, recurrence_scope: scope, occurrence_id: selection?.occurrenceId || null, expected_revision: editorEvent.revision } });
      else await queueMutation({ operation: 'create', input });
      setSelection(null);
      toast.info('Calendar change saved offline and will sync when connected');
    }
  }, [editorEvent, getToken, invalidate, queueMutation, selection?.occurrenceId, user?.id]);

  const handleMove = useCallback((eventApi: EventApi, revert: () => void) => {
    const eventId = String(eventApi.extendedProps.eventId || '');
    if (!eventId || !eventApi.start || !eventApi.end) { revert(); return; }
    const localDate = (value: Date) => {
      const offset = value.getTimezoneOffset() * 60_000;
      return new Date(value.getTime() - offset).toISOString().slice(0, 10);
    };
    const input = eventApi.allDay
      ? { start_at: null, end_at: null, start_date: localDate(eventApi.start), end_date: localDate(eventApi.end), all_day: true, recurrence_scope: 'occurrence' as const, occurrence_id: String(eventApi.extendedProps.occurrenceId || '') || null }
      : { start_at: eventApi.start.toISOString(), end_at: eventApi.end.toISOString(), start_date: null, end_date: null, all_day: false, recurrence_scope: 'occurrence' as const, occurrence_id: String(eventApi.extendedProps.occurrenceId || '') || null };
    mutation.mutate(async () => {
      try { return await updateCalendarEvent(getToken, user?.id, eventId, input); }
      catch (error) {
        if (!shouldQueueCalendarMutation(error)) { revert(); throw error; }
        await queueMutation({ operation: 'update', eventId, input: { ...input, title: eventApi.title, timezone: preferences.timezone } as CalendarOutboxItem['input'] });
        toast.info('Calendar change saved offline');
      }
    });
  }, [getToken, mutation, preferences.timezone, queueMutation, user?.id]);

  const handleTaskAllocate = useCallback((taskId: string, start: Date, end: Date) => {
    const task = data?.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const input: CalendarEventInput = { title: task.title, description: task.notes, kind: 'task_allocation', origin: 'ritual', task_id: task.id, source_id: sources.find((source) => !source.account_id)?.id || null, start_at: start.toISOString(), end_at: end.toISOString(), timezone: preferences.timezone, all_day: false, availability: 'busy', client_event_id: crypto.randomUUID() };
    mutation.mutate(async () => { try { return await createCalendarEvent(getToken, user?.id, input); } catch (error) { if (!shouldQueueCalendarMutation(error)) throw error; await queueMutation({ operation: 'create', input }); toast.info('Task allocation saved offline'); } });
  }, [data?.tasks, getToken, mutation, preferences.timezone, queueMutation, sources, user?.id]);

  const handleDelete = useCallback((event: CalendarEvent, scope: RecurrenceScope, occurrenceId?: string | null) => { mutation.mutate(async () => { try { await deleteCalendarEvent(getToken, user?.id, event.id, scope, occurrenceId); } catch (error) { if (!shouldQueueCalendarMutation(error)) throw error; await queueMutation({ operation: 'delete', eventId: event.id, scope, occurrenceId }); toast.info('Deletion saved offline'); } setSelection(null); }); }, [getToken, mutation, queueMutation, user?.id]);
  const handlePublish = useCallback((event: CalendarEvent, sourceId: string) => { mutation.mutate(async () => { try { const updated = await publishCalendarEvent(getToken, user?.id, event.id, sourceId); setSelection({ event: updated }); } catch (error) { if (!shouldQueueCalendarMutation(error)) throw error; await queueMutation({ operation: 'publish', eventId: event.id, sourceId }); toast.info('Publication is pending connectivity'); } }); }, [getToken, mutation, queueMutation, user?.id]);
  const handleRsvp = useCallback((event: CalendarEvent, response: 'accepted' | 'declined' | 'tentative' | 'needsAction') => { mutation.mutate(async () => { try { const updated = await rsvpCalendarEvent(getToken, user?.id, event.id, response); setSelection({ event: updated }); } catch (error) { if (!shouldQueueCalendarMutation(error)) throw error; await queueMutation({ operation: 'rsvp', eventId: event.id, response }); toast.info('RSVP is pending connectivity'); } }); }, [getToken, mutation, queueMutation, user?.id]);

  const setView = (view: CalendarView) => { patchPreferences({ view }); setRange(calendarVisibleRange(date, view, preferences.week_starts_on)); };
  const onDatesSet = (arg: DatesSetArg) => { setRange({ start: arg.start, end: arg.end }); setDate(arg.view.calendar.getDate()); };
  const openNewEvent = () => { setEditorEvent(null); setEditorSeed(defaultTimedSelection(date, preferences.workday_start_minutes, preferences.default_duration_minutes)); setEditorOpen(true); };
  const allocateTask = (task: CalendarTaskSummary) => { const seed = defaultTimedSelection(date, preferences.workday_start_minutes, preferences.default_duration_minutes); setEditorEvent(null); setEditorSeed({ ...seed, title: task.title, description: task.notes, kind: 'task_allocation', taskId: task.id, sourceId: sources.find((source) => !source.account_id)?.id || null }); setEditorOpen(true); };
  const goToDate = (next: Date) => { setDate(next); adapterRef.current?.goToDate(next); };
  const toggleSource = (source: CalendarSource) => {
    const visible = sourceIds.includes(source.id);
    if (visible && sourceIds.length === 1) { toast.info('Keep at least one calendar visible'); return; }
    const next = visible ? sourceIds.filter((id) => id !== source.id) : [...sourceIds, source.id];
    patchPreferences({ visible_source_ids: next });
    mutation.mutate(() => updateCalendarSource(getToken, user?.id, source.id, { is_visible: !visible }));
  };
  const copyAvailability = async () => {
    setCopying(true);
    try {
      const value = await findCalendarAvailability(getToken, user?.id, { start: rangeStart, end: rangeEnd, timezone: preferences.timezone, source_ids: sourceIds, minimum_minutes: preferences.default_duration_minutes, workday_start_minutes: preferences.workday_start_minutes, workday_end_minutes: preferences.workday_end_minutes });
      const text = `${value.formatted_text}\n\nTime zone: ${preferences.timezone}`;
      await navigator.clipboard.writeText(text);
      toast.success('Availability copied');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to copy availability'); }
    finally { setCopying(false); }
  };
  const connectGoogle = () => mutation.mutate(async () => { const result = await connectGoogleCalendar(getToken, user?.id); window.location.assign(result.authorization_url); });
  const openSearchEvent = (event: CalendarEvent) => {
    const eventDate = event.start_at ? new Date(event.start_at) : event.start_date ? new Date(`${event.start_date}T12:00:00`) : date;
    goToDate(eventDate);
    setSelection({ event });
    setPendingSearchFocus(event);
  };
  const periodLabel = preferences.view === 'week' ? calendarPeriodLabel(range, preferences.view) : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const syncState = outbox.length ? 'pending' : calendarQuery.isFetching ? 'refreshing' : data?.sync.some((item) => item.status === 'error') ? 'error' : 'ready';
  const showingCachedData = Boolean((data as (CalendarRangeReadModel & { offline?: boolean }) | undefined)?.offline);

  return (
    <div className={`ritual-calendar-shell view-${preferences.view} mode-${preferences.mode}`}>
      <CalendarHeader periodLabel={periodLabel} view={preferences.view} mode={preferences.mode} preferences={preferences} showToday={!rangeContainsDate(range, new Date())} syncState={syncState} pendingCount={outbox.length} googleConnected={sources.some((source) => source.provider === 'google')} copying={copying} onCreate={openNewEvent} onCopyAvailability={() => void copyAvailability()} onView={setView} onToday={() => adapterRef.current?.goToday()} onPrevious={() => adapterRef.current?.goPrevious()} onNext={() => adapterRef.current?.goNext()} onSearch={() => setSearchOpen(true)} onConnectGoogle={connectGoogle} onPatchPreferences={patchPreferences} />
      <div className="ritual-calendar-workspace">
        <main className="ritual-calendar-human" aria-label="Calendar schedule">
          <FullCalendarAdapter ref={adapterRef} view={preferences.view} date={date} events={events} selectedEventId={selection?.event.id} preferences={preferences} onRangeChange={onDatesSet} onSelectRange={(arg: DateSelectArg) => { setSelection(null); setEditorEvent(null); setEditorSeed(calendarSelectionSeed(arg.start, arg.end, arg.allDay, preferences.snap_minutes)); setEditorOpen(true); }} onEventClick={(arg) => void openOccurrence(arg)} onEventChange={handleMove} onTaskAllocate={handleTaskAllocate} />
          {calendarQuery.isLoading ? <div className="ritual-calendar-status is-loading"><LoaderCircle className="animate-spin" />Loading calendar…</div> : null}
          {calendarQuery.isError ? <div className="ritual-calendar-status is-error"><Unplug /><span><strong>Calendar unavailable</strong><small>The grid remains usable; retry when the local backend is available.</small></span><Button variant="outline" size="compact" onClick={() => void calendarQuery.refetch()}>Try again</Button></div> : null}
          {showingCachedData ? <div className="ritual-calendar-status is-offline"><AlertTriangle /><span>Showing cached calendar data</span></div> : null}
          {preferences.mode === 'review' && data?.review ? <div className="ritual-calendar-review-strip"><span><strong>{data.review.planned_minutes}</strong> planned minutes</span><span><strong>{data.review.attributable_actual_minutes}</strong> linked actual minutes</span><span><strong>{data.review.completed_task_count}</strong> completed tasks</span><p>Evidence and correlations only; no causal health claims.</p></div> : null}
          {data?.proposals.length ? <ProposalBar proposals={data.proposals} getToken={getToken} userId={user?.id} onDone={invalidate} /> : null}
        </main>
        {preferences.side_panel_open ? <CalendarSidePanel date={date} range={range} weekStartsOn={preferences.week_starts_on} sources={sources} visibleSourceIds={sourceIds} onDate={goToDate} onToggleSource={toggleSource} /> : null}
        {preferences.tasks_open ? <div className="ritual-calendar-task-drawer"><CalendarTaskInbox tasks={data?.tasks || []} defaultDurationMinutes={preferences.default_duration_minutes} onCreate={async (title) => { await createCalendarTask(getToken, user?.id, title); await invalidate(); }} onComplete={(task) => mutation.mutate(() => completeCalendarTask(getToken, user?.id, task.id))} onInspect={allocateTask} onClose={() => patchPreferences({ tasks_open: false })} /></div> : null}
        <CalendarEventDetails selection={selection} sources={sources} timeFormat={preferences.time_format} onClose={() => setSelection(null)} onEdit={(event) => { setEditorEvent(event); setEditorSeed(null); setEditorOpen(true); setSelection(null); }} onDelete={handleDelete} onPublish={handlePublish} onRsvp={handleRsvp} />
      </div>
      <CalendarEventEditor open={editorOpen} event={editorEvent} seed={editorSeed} sources={sources} timezone={preferences.timezone} onOpenChange={(open) => { setEditorOpen(open); if (!open) adapterRef.current?.unselect(); }} onSave={saveEditor} />
      <SearchPanel open={searchOpen} onOpenChange={setSearchOpen} getToken={getToken} userId={user?.id} onOpenEvent={openSearchEvent} onOpenTask={(task) => { patchPreferences({ tasks_open: true }); allocateTask(task); }} />
    </div>
  );
}
