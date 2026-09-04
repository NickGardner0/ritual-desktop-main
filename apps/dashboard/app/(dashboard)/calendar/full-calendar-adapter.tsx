'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type {
  DateSelectArg,
  DatesSetArg,
  EventApi,
  EventClickArg,
  EventDropArg,
  EventInput,
  EventMountArg,
} from '@fullcalendar/core';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import { CalendarClock, CheckSquare2, CircleAlert, Sparkles } from 'lucide-react';

import type { CalendarPreferences, CalendarView } from '@ritual/shared-contracts';

export type CalendarAdapterHandle = {
  goToday: () => void;
  goPrevious: () => void;
  goNext: () => void;
  goToDate: (date: Date) => void;
};

type Props = {
  view: CalendarView;
  date: Date;
  events: EventInput[];
  preferences: CalendarPreferences;
  onRangeChange: (arg: DatesSetArg) => void;
  onSelectRange: (arg: DateSelectArg) => void;
  onEventClick: (arg: EventClickArg) => void;
  onEventChange: (event: EventApi, revert: () => void) => void;
  onTaskAllocate: (taskId: string, start: Date, end: Date) => void;
};

function calendarViewName(view: CalendarView) {
  if (view === 'month') return 'dayGridMonth';
  if (view === 'week') return 'timeGridWeek';
  return 'timeGridDay';
}

function eventClasses(arg: { event: EventApi }): string[] {
  const props = arg.event.extendedProps;
  return [
    'ritual-calendar-event',
    `ritual-calendar-event--${props.kind || 'event'}`,
    `ritual-calendar-event--${props.origin || 'ritual'}`,
    props.conflict ? 'ritual-calendar-event--conflict' : '',
    props.review ? 'ritual-calendar-event--actual' : '',
    props.proposal ? 'ritual-calendar-event--proposal' : '',
    props.syncState === 'pending' ? 'ritual-calendar-event--pending' : '',
  ].filter(Boolean);
}

function EventContent({ event, timeText }: { event: EventApi; timeText: string }) {
  const props = event.extendedProps;
  const Icon = props.kind === 'task_allocation'
    ? CheckSquare2
    : props.conflict
      ? CircleAlert
      : props.origin === 'ai'
        ? Sparkles
        : CalendarClock;
  return (
    <div className="ritual-calendar-event-content">
      <Icon aria-hidden="true" />
      <div className="min-w-0">
        {timeText ? <div className="ritual-calendar-event-time">{timeText}</div> : null}
        <div className="ritual-calendar-event-title">{event.title}</div>
        {props.providerEventType && props.providerEventType !== 'default' ? <div className="ritual-calendar-event-subtype">{String(props.providerEventType).replaceAll('_', ' ')}</div> : null}
      </div>
    </div>
  );
}

export const FullCalendarAdapter = forwardRef<CalendarAdapterHandle, Props>(function FullCalendarAdapter(
  { view, date, events, preferences, onRangeChange, onSelectRange, onEventClick, onEventChange, onTaskAllocate },
  forwardedRef,
) {
  const calendarRef = useRef<FullCalendar>(null);
  useImperativeHandle(forwardedRef, () => ({
    goToday: () => calendarRef.current?.getApi().today(),
    goPrevious: () => calendarRef.current?.getApi().prev(),
    goNext: () => calendarRef.current?.getApi().next(),
    goToDate: (nextDate) => calendarRef.current?.getApi().gotoDate(nextDate),
  }), []);

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (api && api.view.type !== calendarViewName(view)) api.changeView(calendarViewName(view));
  }, [view]);

  const handleMove = (arg: EventDropArg | EventResizeDoneArg) => onEventChange(arg.event, arg.revert);
  const snap = `${String(Math.floor(preferences.snap_minutes / 60)).padStart(2, '0')}:${String(preferences.snap_minutes % 60).padStart(2, '0')}:00`;

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView={calendarViewName(view)}
      initialDate={date}
      headerToolbar={false}
      height="100%"
      expandRows
      firstDay={preferences.week_starts_on}
      timeZone="local"
      nowIndicator
      selectable
      selectMirror
      editable
      eventResizableFromStart
      droppable
      dayMaxEvents={3}
      allDaySlot
      slotDuration="00:30:00"
      snapDuration={snap}
      slotMinTime="00:00:00"
      slotMaxTime="24:00:00"
      scrollTime={`${String(Math.floor(preferences.workday_start_minutes / 60)).padStart(2, '0')}:00:00`}
      businessHours={{
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: `${String(Math.floor(preferences.workday_start_minutes / 60)).padStart(2, '0')}:00`,
        endTime: `${String(Math.floor(preferences.workday_end_minutes / 60)).padStart(2, '0')}:00`,
      }}
      events={events}
      datesSet={onRangeChange}
      select={onSelectRange}
      eventClick={onEventClick}
      eventDrop={handleMove}
      eventResize={handleMove}
      eventReceive={(arg) => {
        const taskId = String(arg.event.extendedProps.taskId || '');
        const start = arg.event.start;
        const end = arg.event.end || (start ? new Date(start.getTime() + preferences.default_duration_minutes * 60_000) : null);
        arg.event.remove();
        if (taskId && start && end) onTaskAllocate(taskId, start, end);
      }}
      eventClassNames={eventClasses}
      eventContent={(arg) => <EventContent event={arg.event} timeText={arg.timeText} />}
      eventDidMount={(arg: EventMountArg) => {
        arg.el.setAttribute('aria-label', `${arg.event.title}${arg.timeText ? `, ${arg.timeText}` : ''}`);
      }}
      viewDidMount={(arg) => {
        if (arg.view.type !== calendarViewName(view)) arg.view.calendar.changeView(calendarViewName(view));
      }}
    />
  );
});
