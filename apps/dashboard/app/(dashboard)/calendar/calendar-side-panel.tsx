'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DayPicker } from 'react-day-picker';

import type { CalendarSource } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';

import { miniCalendarWeek, type VisibleRange } from './calendar-helpers';

export function CalendarSidePanel({
  date,
  range,
  weekStartsOn,
  sources,
  visibleSourceIds,
  onDate,
  onToggleSource,
}: {
  date: Date;
  range: VisibleRange;
  weekStartsOn: 0 | 1;
  sources: CalendarSource[];
  visibleSourceIds: string[];
  onDate: (date: Date) => void;
  onToggleSource: (source: CalendarSource) => void;
}) {
  const [calendarMonth, setCalendarMonth] = useState(date);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const visibleWeek = useMemo(() => miniCalendarWeek(date, weekStartsOn), [date, weekStartsOn]);
  useEffect(() => setCalendarMonth(date), [date]);

  return (
    <aside className="ritual-calendar-side-panel" aria-label="Calendar navigation and sources">
      <section className="ritual-calendar-mini">
        <DayPicker
          mode="single"
          weekStartsOn={weekStartsOn}
          month={calendarMonth}
          selected={date}
          onMonthChange={setCalendarMonth}
          onSelect={(next) => { if (next) onDate(next); }}
          showOutsideDays
          fixedWeeks
          modifiers={{ visibleWeek: { from: visibleWeek.start, to: visibleWeek.end }, visibleRange: { from: range.start, to: new Date(range.end.getTime() - 1) } }}
          modifiersClassNames={{ visibleWeek: 'is-visible-week', visibleRange: 'is-visible-range' }}
          className="ritual-calendar-mini-picker"
          classNames={{
            months: 'ritual-mini-months',
            month: 'ritual-mini-month',
            caption: 'ritual-mini-caption',
            caption_label: 'ritual-mini-caption-label',
            nav: 'ritual-mini-nav',
            nav_button: 'ritual-mini-nav-button',
            nav_button_previous: 'ritual-mini-nav-previous',
            nav_button_next: 'ritual-mini-nav-next',
            table: 'ritual-mini-table',
            head_row: 'ritual-mini-head-row',
            head_cell: 'ritual-mini-head-cell',
            row: 'ritual-mini-row',
            cell: 'ritual-mini-cell',
            day: 'ritual-mini-day',
            day_selected: 'is-selected',
            day_today: 'is-today',
            day_outside: 'is-outside',
            day_disabled: 'is-disabled',
            day_hidden: 'is-hidden',
          }}
          components={{
            IconLeft: () => <ChevronLeft />,
            IconRight: () => <ChevronRight />,
          }}
        />
      </section>

      <section className="ritual-calendar-source-panel">
        <button type="button" className="ritual-calendar-panel-heading" onClick={() => setSourcesOpen((value) => !value)} aria-expanded={sourcesOpen}>
          <span>Calendars</span><ChevronDown className={sourcesOpen ? '' : 'is-collapsed'} />
        </button>
        {sourcesOpen ? <div className="ritual-calendar-source-list">
          {sources.map((source) => {
            const checked = visibleSourceIds.includes(source.id);
            return (
              <label key={source.id} className="ritual-calendar-source-row">
                <input type="checkbox" checked={checked} onChange={() => onToggleSource(source)} />
                <span className="ritual-calendar-source-dot" style={{ backgroundColor: source.color || 'var(--calendar-external-event)' }} />
                <span>{source.name}</span>
                {source.provider ? <small>{source.provider}</small> : null}
              </label>
            );
          })}
          {!sources.length ? <p className="ritual-calendar-panel-empty">Calendars appear here after the first sync.</p> : null}
        </div> : null}
      </section>
      <div className="ritual-calendar-side-footer">
        <Button variant="ghost" size="compact" onClick={() => onDate(new Date())}>Jump to today</Button>
      </div>
    </aside>
  );
}
