'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { DateSelectArg, DatesSetArg, EventApi, EventClickArg, EventContentArg, EventDropArg, EventInput, EventMountArg } from '@fullcalendar/core';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';

import type { CalendarPreferences, CalendarView } from '@ritual/shared-contracts';

export type CalendarAdapterHandle = {
  goToday: () => void;
  goPrevious: () => void;
  goNext: () => void;
  goToDate: (date: Date) => void;
  unselect: () => void;
  focusEvent: (eventId: string) => DOMRect | null;
};

type Props = {
  view: CalendarView;
  date: Date;
  events: EventInput[];
  selectedEventId?: string | null;
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

function eventClasses(arg: { event: EventApi; isMirror?: boolean }, selectedEventId?: string | null): string[] {
  const props = arg.event.extendedProps;
  return [
    'ritual-calendar-event',
    `ritual-calendar-event--${props.kind || 'event'}`,
    `ritual-calendar-event--${props.origin || 'ritual'}`,
    props.status === 'declined' || props.responseStatus === 'declined' ? 'ritual-calendar-event--declined' : '',
    props.status === 'tentative' || props.responseStatus === 'tentative' ? 'ritual-calendar-event--tentative' : '',
    props.conflict ? 'ritual-calendar-event--conflict' : '',
    props.review ? 'ritual-calendar-event--actual' : '',
    props.proposal ? 'ritual-calendar-event--proposal' : '',
    props.syncState === 'pending' ? 'ritual-calendar-event--pending' : '',
    selectedEventId && props.eventId === selectedEventId ? 'ritual-calendar-event--selected' : '',
    arg.isMirror ? 'ritual-calendar-event--selection' : '',
  ].filter(Boolean);
}

function EventContent(arg: EventContentArg) {
  if (arg.isMirror) {
    return <div className="ritual-calendar-selection-content"><strong>New event</strong><span>{arg.timeText}</span></div>;
  }
  const location = String(arg.event.extendedProps.location || '');
  return (
    <div className="ritual-calendar-event-content">
      <div className="ritual-calendar-event-line">
        <strong>{arg.event.title}</strong>
        {arg.timeText ? <span>{arg.timeText}</span> : null}
      </div>
      {location ? <small>{location}</small> : null}
    </div>
  );
}

export const FullCalendarAdapter = forwardRef<CalendarAdapterHandle, Props>(function FullCalendarAdapter(
  { view, date, events, selectedEventId, preferences, onRangeChange, onSelectRange, onEventClick, onEventChange, onTaskAllocate },
  forwardedRef,
) {
  const calendarRef = useRef<FullCalendar>(null);
  useImperativeHandle(forwardedRef, () => ({
    goToday: () => calendarRef.current?.getApi().today(),
    goPrevious: () => calendarRef.current?.getApi().prev(),
    goNext: () => calendarRef.current?.getApi().next(),
    goToDate: (nextDate) => calendarRef.current?.getApi().gotoDate(nextDate),
    unselect: () => calendarRef.current?.getApi().unselect(),
    focusEvent: (eventId) => {
      const element = document.querySelector(`[data-calendar-event-id="${CSS.escape(eventId)}"]`) as HTMLElement | null;
      if (!element) return null;
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      element.focus({ preventScroll: true });
      return element.getBoundingClientRect();
    },
  }), []);

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (api && api.view.type !== calendarViewName(view)) api.changeView(calendarViewName(view));
  }, [view]);

  const handleMove = (arg: EventDropArg | EventResizeDoneArg) => onEventChange(arg.event, arg.revert);
  const snap = `${String(Math.floor(preferences.snap_minutes / 60)).padStart(2, '0')}:${String(preferences.snap_minutes % 60).padStart(2, '0')}:00`;
  const scrollMinutes = Math.max(0, preferences.workday_start_minutes - 60);
  const scrollTime = `${String(Math.floor(scrollMinutes / 60)).padStart(2, '0')}:${String(scrollMinutes % 60).padStart(2, '0')}:00`;
  const hour12 = preferences.time_format === '12h';

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView={calendarViewName(view)}
      initialDate={date}
      headerToolbar={false}
      height="100%"
      expandRows={false}
      firstDay={preferences.week_starts_on}
      weekends={preferences.show_weekends}
      timeZone="local"
      nowIndicator
      selectable
      selectMirror
      selectMinDistance={0}
      unselectAuto={false}
      editable
      eventResizableFromStart
      droppable
      dayMaxEvents={3}
      allDaySlot
      slotDuration="00:30:00"
      snapDuration={snap}
      slotMinTime="00:00:00"
      slotMaxTime="24:00:00"
      scrollTime={scrollTime}
      scrollTimeReset={false}
      slotLabelFormat={{ hour: 'numeric', minute: '2-digit', omitZeroMinute: true, meridiem: hour12 ? 'short' : false, hour12 }}
      eventTimeFormat={{ hour: 'numeric', minute: '2-digit', omitZeroMinute: true, meridiem: hour12 ? 'narrow' : false, hour12 }}
      businessHours={{
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: `${String(Math.floor(preferences.workday_start_minutes / 60)).padStart(2, '0')}:${String(preferences.workday_start_minutes % 60).padStart(2, '0')}`,
        endTime: `${String(Math.floor(preferences.workday_end_minutes / 60)).padStart(2, '0')}:${String(preferences.workday_end_minutes % 60).padStart(2, '0')}`,
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
      dayHeaderContent={(arg) => (
        <div className={`ritual-calendar-day-heading${arg.isToday ? ' is-today' : ''}${view === 'month' ? ' is-month' : ''}`}>
          <span>{arg.date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
          {view === 'month' ? null : <strong>{arg.date.getUTCDate()}</strong>}
        </div>
      )}
      eventClassNames={(arg) => eventClasses(arg, selectedEventId)}
      eventContent={EventContent}
      eventDidMount={(arg: EventMountArg) => {
        const eventId = String(arg.event.extendedProps.eventId || '');
        const sourceColor = String(arg.event.extendedProps.sourceColor || 'var(--calendar-external-event)');
        if (eventId) arg.el.dataset.calendarEventId = eventId;
        arg.el.style.setProperty('--ritual-event-color', sourceColor);
        arg.el.setAttribute('tabindex', '0');
        arg.el.setAttribute('aria-label', `${arg.event.title}${arg.timeText ? `, ${arg.timeText}` : ''}`);
      }}
      viewDidMount={(arg) => {
        if (arg.view.type !== calendarViewName(view)) arg.view.calendar.changeView(calendarViewName(view));
      }}
    />
  );
});
