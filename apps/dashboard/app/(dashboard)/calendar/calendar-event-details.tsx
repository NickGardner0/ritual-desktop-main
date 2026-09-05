'use client';

import { CalendarClock, ExternalLink, MapPin, Pencil, Trash2, Users, Video, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { CalendarEvent, CalendarSource, RecurrenceScope } from '@ritual/shared-contracts';
import { Badge } from '@ritual/ui/badge';
import { Button } from '@ritual/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@ritual/ui/popover';

export type CalendarEventSelection = {
  event: CalendarEvent;
  occurrenceId?: string | null;
  anchorRect?: { top: number; left: number; width: number; height: number } | null;
};

function eventDateRange(event: CalendarEvent, timeFormat: '12h' | '24h') {
  if (event.all_day) {
    const start = event.start_date ? new Date(`${event.start_date}T12:00:00`) : null;
    const end = event.end_date ? new Date(`${event.end_date}T12:00:00`) : null;
    const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
    return [start ? format.format(start) : '', end ? format.format(end) : ''].filter(Boolean).join(' – ');
  }
  const format = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: timeFormat === '12h',
  });
  return [event.start_at ? format.format(new Date(event.start_at)) : '', event.end_at ? format.format(new Date(event.end_at)) : ''].filter(Boolean).join(' – ');
}

function conferenceUrl(event: CalendarEvent) {
  const entryPoints = Array.isArray(event.conference?.entryPoints) ? event.conference.entryPoints as Array<Record<string, unknown>> : [];
  const entry = entryPoints.find((item) => typeof item.uri === 'string');
  return typeof entry?.uri === 'string' ? entry.uri : typeof event.conference?.hangoutLink === 'string' ? event.conference.hangoutLink : null;
}

export function CalendarEventDetails({
  selection,
  sources,
  timeFormat,
  onClose,
  onEdit,
  onDelete,
  onPublish,
  onRsvp,
}: {
  selection: CalendarEventSelection | null;
  sources: CalendarSource[];
  timeFormat: '12h' | '24h';
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent, scope: RecurrenceScope, occurrenceId?: string | null) => void;
  onPublish: (event: CalendarEvent, sourceId: string) => void;
  onRsvp: (event: CalendarEvent, response: 'accepted' | 'declined' | 'tentative' | 'needsAction') => void;
}) {
  const event = selection?.event ?? null;
  const writableSources = sources.filter((source) => source.writable);
  const eventSource = sources.find((source) => source.id === event?.source_id);
  const editable = eventSource ? eventSource.writable : event?.origin === 'ritual';
  const [deleteScope, setDeleteScope] = useState<RecurrenceScope>('series');
  const [publishSource, setPublishSource] = useState(writableSources.find((source) => source.provider === 'google' && source.is_default_write)?.id || writableSources.find((source) => source.provider === 'google')?.id || '');
  const selfAttendee = event?.attendees.find((attendee) => attendee.self === true);
  const isRecurring = Boolean(event?.recurrence.length || event?.recurring_event_id);
  const location = event ? String(event.location?.displayName || event.location?.name || '') : '';
  const guests = useMemo(() => event?.attendees.map((item) => String(item.displayName || item.email || '')).filter(Boolean) ?? [], [event]);
  const meetingUrl = event ? conferenceUrl(event) : null;
  useEffect(() => {
    setDeleteScope('series');
    setPublishSource(writableSources.find((source) => source.provider === 'google' && source.is_default_write)?.id || writableSources.find((source) => source.provider === 'google')?.id || '');
  }, [event?.id, sources]);
  const rect = selection?.anchorRect;
  const anchorStyle = rect
    ? { position: 'fixed' as const, top: rect.top, left: rect.left, width: rect.width, height: rect.height, pointerEvents: 'none' as const }
    : { position: 'fixed' as const, top: '50%', left: '50%', width: 1, height: 1, pointerEvents: 'none' as const };

  return (
    <Popover open={Boolean(event)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <PopoverAnchor asChild><span aria-hidden style={anchorStyle} /></PopoverAnchor>
      {event ? <PopoverContent className="ritual-calendar-event-popover" side="right" align="start" collisionPadding={12}>
        <header>
          <span className="ritual-calendar-event-accent" style={{ background: event.source_color || 'var(--calendar-external-event)' }} />
          <div><h2>{event.title}</h2><p>{event.source_name || 'Ritual'}</p></div>
          <Button variant="ghost" size="icon-compact" onClick={onClose} aria-label="Close event details"><X /></Button>
        </header>
        <div className="ritual-calendar-event-detail-list">
          <div><CalendarClock /><span>{eventDateRange(event, timeFormat)}</span></div>
          {location ? <div><MapPin /><span>{location}</span></div> : null}
          {guests.length ? <div><Users /><span>{guests.join(', ')}</span></div> : null}
          {meetingUrl ? <div><Video /><a href={meetingUrl} target="_blank" rel="noreferrer">Join conference</a></div> : null}
          {event.description ? <p>{event.description}</p> : null}
          <div className="ritual-calendar-event-badges"><Badge variant="outline">{event.status}</Badge><Badge variant="outline">{event.availability}</Badge>{event.sync_state !== 'synced' ? <Badge variant="outline">{event.sync_state}</Badge> : null}</div>
        </div>
        {selfAttendee ? <label className="ritual-calendar-detail-control"><span>My RSVP</span><select value={String(selfAttendee.responseStatus || 'needsAction')} onChange={(change) => onRsvp(event, change.target.value as 'accepted' | 'declined' | 'tentative' | 'needsAction')}><option value="needsAction">No response</option><option value="accepted">Going</option><option value="tentative">Maybe</option><option value="declined">Not going</option></select></label> : null}
        <footer>
          {editable ? <Button variant="outline" size="compact" onClick={() => onEdit(event)}><Pencil />Edit</Button> : <span className="ritual-calendar-readonly">Read-only calendar</span>}
          {event.origin === 'ritual' && publishSource ? <Button variant="outline" size="compact" onClick={() => onPublish(event, publishSource)}><ExternalLink />Publish</Button> : null}
          {editable ? <div className="ritual-calendar-delete-action">
            {isRecurring ? <select aria-label="Delete recurrence scope" value={deleteScope} onChange={(change) => setDeleteScope(change.target.value as RecurrenceScope)}><option value="occurrence">This event</option><option value="following">This and following</option><option value="series">Entire series</option></select> : null}
            <Button variant="ghost" size="icon-compact" className="text-[var(--ritual-status-danger)]" onClick={() => onDelete(event, deleteScope, selection?.occurrenceId)} aria-label="Delete event"><Trash2 /></Button>
          </div> : null}
        </footer>
      </PopoverContent> : null}
    </Popover>
  );
}
