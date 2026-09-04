'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, CheckSquare2, ExternalLink, Link2, RefreshCcw, Sparkles, Trash2, X } from 'lucide-react';

import type { CalendarEvent, CalendarSource, CalendarTaskSummary, RecurrenceScope, WorkflowTimelineItem } from '@ritual/shared-contracts';
import { Badge } from '@ritual/ui/badge';
import { Button } from '@ritual/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ritual/ui/tabs';

export type InspectorSelection =
  | { type: 'event'; event: CalendarEvent; occurrenceId?: string | null }
  | { type: 'task'; task: CalendarTaskSummary }
  | { type: 'workflow'; workflow: WorkflowTimelineItem };

function dateRange(event: CalendarEvent) {
  if (event.all_day) return `${event.start_date || ''} – ${event.end_date || ''}`;
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `${event.start_at ? formatter.format(new Date(event.start_at)) : ''} – ${event.end_at ? formatter.format(new Date(event.end_at)) : ''}`;
}

export function CalendarInspector({
  selection,
  writableSources,
  onClose,
  onEdit,
  onDelete,
  onPublish,
  onRsvp,
  onAllocateTask,
}: {
  selection: InspectorSelection;
  writableSources: CalendarSource[];
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent, scope: RecurrenceScope, occurrenceId?: string | null) => void;
  onPublish: (event: CalendarEvent, sourceId: string) => void;
  onRsvp: (event: CalendarEvent, response: 'accepted' | 'declined' | 'tentative' | 'needsAction') => void;
  onAllocateTask: (task: CalendarTaskSummary) => void;
}) {
  const [deleteScope, setDeleteScope] = useState<RecurrenceScope>('series');
  const [publishSource, setPublishSource] = useState(writableSources.find((source) => source.is_default_write)?.id || writableSources[0]?.id || '');
  const heading = selection.type === 'event' ? selection.event.title : selection.type === 'task' ? selection.task.title : selection.workflow.name;
  const icon = selection.type === 'event' ? <CalendarClock /> : selection.type === 'task' ? <CheckSquare2 /> : <Sparkles />;
  const event = selection.type === 'event' ? selection.event : null;
  const eventOccurrenceId = selection.type === 'event' ? selection.occurrenceId : null;
  const workflow = selection.type === 'workflow' ? selection.workflow : null;
  const selfAttendee = event?.attendees.find((attendee) => attendee.self === true);
  const isRecurring = Boolean(event?.recurrence.length || event?.recurring_event_id);
  const links = useMemo(() => {
    if (!event) return [];
    return [
      event.task_id ? { label: 'Linked task', value: event.task_id } : null,
      event.routine_run_id ? { label: 'Routine run', value: event.routine_run_id } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>;
  }, [event]);

  return (
    <aside className="ritual-calendar-inspector" aria-label={`${heading} inspector`}>
      <header>
        <div className="ritual-calendar-inspector-icon">{icon}</div>
        <div className="min-w-0 flex-1"><div className="ritual-calendar-pane-eyebrow">{selection.type}</div><h2>{heading}</h2></div>
        <Button variant="ghost" size="icon-compact" onClick={onClose} aria-label="Close inspector"><X /></Button>
      </header>
      <Tabs defaultValue="details" className="min-h-0 flex-1">
        <TabsList variant="underline" className="w-full justify-start px-4">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="ritual-calendar-inspector-content">
          {event ? (
            <>
              <div className="ritual-calendar-detail-list">
                <div><span>When</span><strong>{dateRange(event)}</strong></div>
                <div><span>Calendar</span><strong>{event.source_name || 'Ritual'}</strong></div>
                <div><span>Time zone</span><strong>{event.timezone}</strong></div>
                <div><span>Status</span><strong>{event.status}</strong></div>
                <div><span>Availability</span><strong>{event.availability}</strong></div>
                {String(event.organizer?.email || event.organizer?.displayName || '') ? <div><span>Organizer</span><strong>{String(event.organizer.email || event.organizer.displayName)}</strong></div> : null}
                {event.description ? <div><span>Notes</span><p>{event.description}</p></div> : null}
                {String(event.location?.displayName || '') ? <div><span>Location</span><p>{String(event.location.displayName)}</p></div> : null}
                {event.attendees.length ? <div><span>Guests</span><p>{event.attendees.map((item) => String(item.email || item.displayName || '')).filter(Boolean).join(', ')}</p></div> : null}
              </div>
              {selfAttendee ? <label className="ritual-calendar-scope"><CalendarClock /><span>My RSVP</span><select value={String(selfAttendee.responseStatus || 'needsAction')} onChange={(e) => onRsvp(event, e.target.value as 'accepted' | 'declined' | 'tentative' | 'needsAction')}><option value="needsAction">No response</option><option value="accepted">Going</option><option value="tentative">Maybe</option><option value="declined">Not going</option></select></label> : null}
              <Button variant="outline" className="w-full" onClick={() => onEdit(event)}>Edit event</Button>
              {event.origin === 'ritual' && writableSources.length ? (
                <div className="ritual-calendar-publish">
                  <select value={publishSource} onChange={(e) => setPublishSource(e.target.value)} aria-label="Google calendar for publication">
                    {writableSources.filter((source) => source.provider === 'google').map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                  </select>
                  <Button variant="outline" disabled={!publishSource} onClick={() => onPublish(event, publishSource)}><ExternalLink />Publish to Google</Button>
                </div>
              ) : null}
              <div className="ritual-calendar-delete">
                {isRecurring ? <select value={deleteScope} onChange={(e) => setDeleteScope(e.target.value as RecurrenceScope)} aria-label="Delete recurrence scope"><option value="occurrence">This occurrence</option><option value="following">This and following</option><option value="series">Entire series</option></select> : null}
                <Button variant="ghost" className="text-[var(--ritual-status-danger)]" onClick={() => onDelete(event, deleteScope, eventOccurrenceId)}><Trash2 />Delete</Button>
              </div>
            </>
          ) : selection.type === 'task' ? (
            <><div className="ritual-calendar-detail-list">
              <div><span>Status</span><strong>{selection.task.status}</strong></div>
              <div><span>Priority</span><strong>{selection.task.priority}</strong></div>
              <div><span>Project</span><strong>{selection.task.project || 'Inbox'}</strong></div>
              <div><span>Allocations</span><strong>{selection.task.allocation_count}</strong></div>
              <p className="ritual-calendar-inspector-note">Drag this task onto the human schedule or use the button below. Scheduling creates another linked allocation and leaves the deadline unchanged.</p>
            </div><Button variant="brand" className="w-full" onClick={() => onAllocateTask(selection.task)}><CalendarClock />Schedule task</Button></>
          ) : workflow ? (
            <div className="ritual-calendar-detail-list">
              <div><span>Type</span><strong>{workflow.item_type}</strong></div>
              <div><span>Status</span><strong>{workflow.status}</strong></div>
              <div><span>Expected</span><strong>{workflow.expected_duration_minutes} minutes</strong></div>
              <div><span>Started</span><strong>{new Date(workflow.start_at).toLocaleString()}</strong></div>
              <p className="ritual-calendar-inspector-note">Workflow executions are observational here. Change future timing in the workflow definition.</p>
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="links" className="ritual-calendar-inspector-content">
          {links.length ? links.map((link) => <div key={link.value} className="ritual-calendar-link-row"><Link2 /><span>{link.label}</span><code>{link.value}</code></div>) : <p className="ritual-calendar-inspector-note">No linked task, routine, project, artifact, workflow, or conversation.</p>}
        </TabsContent>
        <TabsContent value="activity" className="ritual-calendar-inspector-content">
          {event ? <div className="ritual-calendar-activity-row"><RefreshCcw /><div><strong>Synchronization</strong><p>{event.sync_state} · revision {event.revision}</p></div><Badge variant="outline">{event.origin}</Badge></div> : <p className="ritual-calendar-inspector-note">Open related history from the Tasks or Workflows workspace.</p>}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
