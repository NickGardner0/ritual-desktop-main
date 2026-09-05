'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, MapPin, Users } from 'lucide-react';

import type { CalendarEvent, CalendarSource, RecurrenceScope } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ritual/ui/dialog';
import { Input } from '@ritual/ui/input';
import { Label } from '@ritual/ui/label';

import type { CalendarEventInput } from './calendar-api';

export type CalendarEditorSeed = {
  start: Date;
  end: Date;
  allDay: boolean;
  title?: string;
  description?: string | null;
  kind?: 'event' | 'task_allocation';
  taskId?: string | null;
  sourceId?: string | null;
};

function localInput(date: Date | null | undefined) {
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function asDateInput(value: string | null | undefined) {
  return value || '';
}

function nextDayDateInput(value: Date) {
  const next = new Date(value);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function CalendarEventEditor({
  open,
  event,
  seed,
  sources,
  timezone,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  event: CalendarEvent | null;
  seed: CalendarEditorSeed | null;
  sources: CalendarSource[];
  timezone: string;
  onOpenChange: (open: boolean) => void;
  onSave: (input: CalendarEventInput, scope: RecurrenceScope) => Promise<void>;
}) {
  const initialStart = useMemo(() => event?.start_at ? new Date(event.start_at) : seed?.start || new Date(), [event, seed]);
  const initialEnd = useMemo(() => event?.end_at ? new Date(event.end_at) : seed?.end || new Date(Date.now() + 30 * 60_000), [event, seed]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [eventTimezone, setEventTimezone] = useState(timezone);
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [availability, setAvailability] = useState<'busy' | 'free'>('busy');
  const [visibility, setVisibility] = useState<'default' | 'public' | 'private' | 'confidential'>('default');
  const [reminderMinutes, setReminderMinutes] = useState('10');
  const [recurrence, setRecurrence] = useState('');
  const [createMeet, setCreateMeet] = useState(false);
  const [scope, setScope] = useState<RecurrenceScope>('series');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const isAllDay = event?.all_day ?? seed?.allDay ?? false;
    setTitle(event?.title || seed?.title || '');
    setDescription(event?.description || seed?.description || '');
    setSourceId(event?.source_id || seed?.sourceId || sources.find((item) => item.is_default_write)?.id || sources.find((item) => item.writable)?.id || '');
    setAllDay(isAllDay);
    setStart(localInput(initialStart));
    setEnd(localInput(initialEnd));
    setStartDate(asDateInput(event?.start_date) || initialStart.toISOString().slice(0, 10));
    setEndDate(asDateInput(event?.end_date) || nextDayDateInput(initialStart));
    setEventTimezone(event?.timezone || timezone);
    setLocation(String(event?.location?.displayName || event?.location?.name || ''));
    setAttendees((event?.attendees || []).map((item) => String(item.email || '')).filter(Boolean).join(', '));
    setAvailability(event?.availability || 'busy');
    setVisibility(event?.visibility || 'default');
    const overrides = Array.isArray(event?.reminders?.overrides) ? event?.reminders?.overrides as Array<{ minutes?: unknown }> : [];
    setReminderMinutes(String(overrides[0]?.minutes ?? 10));
    setRecurrence(event?.recurrence?.[0] || '');
    setCreateMeet(Boolean(event?.conference && Object.keys(event.conference).length));
    setScope('series');
  }, [event, initialEnd, initialStart, open, seed, sources, timezone]);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || null,
        source_id: sourceId || null,
        kind: event?.kind || seed?.kind || 'event',
        origin: event?.origin || 'ritual',
        all_day: allDay,
        start_at: allDay ? null : new Date(start).toISOString(),
        end_at: allDay ? null : new Date(end).toISOString(),
        start_date: allDay ? startDate : null,
        end_date: allDay ? endDate : null,
        timezone: eventTimezone,
        status: event?.status || 'confirmed',
        availability,
        visibility,
        location: location.trim() ? { displayName: location.trim() } : {},
        conference: createMeet ? { createRequest: true } : event?.conference || {},
        organizer: event?.organizer || {},
        attendees: attendees.split(',').map((email) => email.trim()).filter(Boolean).map((email) => ({ email })),
        reminders: reminderMinutes ? { useDefault: false, overrides: [{ method: 'popup', minutes: Number(reminderMinutes) }] } : { useDefault: true },
        recurrence: recurrence.trim() ? [recurrence.trim()] : [],
        task_id: event?.task_id || seed?.taskId || null,
        client_event_id: event ? undefined : crypto.randomUUID(),
      }, scope);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-[var(--border-subtle)] px-5 py-4">
          <DialogTitle>{event ? 'Edit calendar event' : seed?.kind === 'task_allocation' ? 'Schedule task' : 'New calendar event'}</DialogTitle>
          <DialogDescription>Calendar changes are synced to the selected source. Conflicts warn but do not block saving.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-5 py-4">
          <div className="grid gap-2"><Label htmlFor="calendar-title">Title</Label><Input id="calendar-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="calendar-description">Description</Label><textarea id="calendar-description" className="ritual-calendar-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="ritual-calendar-editor-grid">
            <label><span>Calendar</span><select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>{sources.filter((item) => item.writable).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span>Time zone</span><Input value={eventTimezone} onChange={(e) => setEventTimezone(e.target.value)} /></label>
          </div>
          <label className="ritual-calendar-check-row"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />All day</label>
          <div className="ritual-calendar-editor-grid">
            <label><span>Starts</span><Input type={allDay ? 'date' : 'datetime-local'} value={allDay ? startDate : start} onChange={(e) => allDay ? setStartDate(e.target.value) : setStart(e.target.value)} /></label>
            <label><span>Ends</span><Input type={allDay ? 'date' : 'datetime-local'} value={allDay ? endDate : end} onChange={(e) => allDay ? setEndDate(e.target.value) : setEnd(e.target.value)} /></label>
          </div>
          <div className="ritual-calendar-icon-field"><MapPin /><Input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
          <div className="ritual-calendar-icon-field"><Users /><Input placeholder="Guests, comma separated" value={attendees} onChange={(e) => setAttendees(e.target.value)} /></div>
          <div className="ritual-calendar-editor-grid">
            <label><span>Show as</span><select value={availability} onChange={(e) => setAvailability(e.target.value as 'busy' | 'free')}><option value="busy">Busy</option><option value="free">Free</option></select></label>
            <label><span>Visibility</span><select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}><option value="default">Default</option><option value="public">Public</option><option value="private">Private</option><option value="confidential">Confidential</option></select></label>
            <label><span>Reminder</span><select value={reminderMinutes} onChange={(e) => setReminderMinutes(e.target.value)}><option value="">Calendar default</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option></select></label>
            <label><span>Repeat</span><Input placeholder="RRULE:FREQ=WEEKLY" value={recurrence} onChange={(e) => setRecurrence(e.target.value)} /></label>
          </div>
          <label className="ritual-calendar-check-row"><input type="checkbox" checked={createMeet} onChange={(e) => setCreateMeet(e.target.checked)} />Add Google Meet conference</label>
          {event?.recurrence?.length || event?.recurring_event_id ? (
            <label className="ritual-calendar-scope"><CalendarClock /><span>Edit</span><select value={scope} onChange={(e) => setScope(e.target.value as RecurrenceScope)}><option value="occurrence">This occurrence</option><option value="following">This and following</option><option value="series">Entire series</option></select></label>
          ) : null}
        </div>
        <DialogFooter className="border-t border-[var(--border-subtle)] px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" disabled={saving || !title.trim()} onClick={() => void submit()}>{saving ? 'Saving…' : seed?.kind === 'task_allocation' ? 'Schedule task' : 'Save event'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
