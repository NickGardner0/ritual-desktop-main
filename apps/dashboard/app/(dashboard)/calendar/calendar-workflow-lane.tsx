'use client';

import { useEffect, useRef } from 'react';
import { CircleAlert, CircleCheck, Clock3, PauseCircle, Sparkles, X } from 'lucide-react';

import type { WorkflowTimelineItem } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';

const pixelsPerMinute = 1;

function statusIcon(status: string) {
  if (status === 'failed') return <CircleAlert />;
  if (status === 'completed') return <CircleCheck />;
  if (status === 'approval_blocked') return <PauseCircle />;
  return <Clock3 />;
}

function topAndHeight(item: WorkflowTimelineItem, day: Date) {
  const start = new Date(item.start_at);
  const end = new Date(item.end_at);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  return {
    top: Math.max(0, (start.getTime() - dayStart) / 60_000) * pixelsPerMinute,
    height: Math.max(28, (end.getTime() - start.getTime()) / 60_000 * pixelsPerMinute),
  };
}

function occursOnLocalDay(item: WorkflowTimelineItem, day: Date) {
  const start = new Date(item.start_at);
  return start.getFullYear() === day.getFullYear()
    && start.getMonth() === day.getMonth()
    && start.getDate() === day.getDate();
}

export function CalendarWorkflowLane({
  items,
  day,
  onInspect,
  onClose,
}: {
  items: WorkflowTimelineItem[];
  day: Date;
  onInspect: (item: WorkflowTimelineItem) => void;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = items.filter((item) => occursOnLocalDay(item, day));

  useEffect(() => {
    let cleanup = () => undefined;
    let frame = 0;
    const bind = () => {
      const workflowScroll = scrollRef.current;
      const calendarScroll = document.querySelector<HTMLElement>(
        '.ritual-calendar-human .fc-timegrid-body .fc-scroller-liquid-absolute, .ritual-calendar-human .fc-scroller-liquid-absolute',
      );
      if (!workflowScroll || !calendarScroll) {
        frame = window.requestAnimationFrame(bind);
        return;
      }
      let syncing = false;
      const copyScroll = (source: HTMLElement, target: HTMLElement) => {
        if (syncing || Math.abs(source.scrollTop - target.scrollTop) < 1) return;
        syncing = true;
        target.scrollTop = source.scrollTop;
        window.requestAnimationFrame(() => { syncing = false; });
      };
      const fromCalendar = () => copyScroll(calendarScroll, workflowScroll);
      const fromWorkflow = () => copyScroll(workflowScroll, calendarScroll);
      workflowScroll.scrollTop = calendarScroll.scrollTop;
      calendarScroll.addEventListener('scroll', fromCalendar, { passive: true });
      workflowScroll.addEventListener('scroll', fromWorkflow, { passive: true });
      cleanup = () => {
        calendarScroll.removeEventListener('scroll', fromCalendar);
        workflowScroll.removeEventListener('scroll', fromWorkflow);
      };
    };
    frame = window.requestAnimationFrame(bind);
    return () => {
      window.cancelAnimationFrame(frame);
      cleanup();
    };
  }, [day]);

  return (
    <aside className="ritual-calendar-workflows" aria-label="Agent and workflow timeline">
      <header className="ritual-calendar-pane-header">
        <div><div className="ritual-calendar-pane-eyebrow">Agents</div><h2>Workflows <span>{visible.length}</span></h2></div>
        <Button variant="ghost" size="icon-compact" onClick={onClose} aria-label="Close workflow timeline"><X /></Button>
      </header>
      <div ref={scrollRef} className="ritual-calendar-workflow-scroll">
        <div className="ritual-calendar-workflow-axis" style={{ height: 1440 }}>
          {Array.from({ length: 24 }, (_, hour) => <div key={hour} className="ritual-calendar-workflow-hour" style={{ top: hour * 60 }}><span>{hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}</span></div>)}
          {visible.map((item) => {
            const layout = topAndHeight(item, day);
            return (
              <button
                key={item.id}
                type="button"
                className={`ritual-calendar-workflow-item is-${item.item_type} status-${item.status}`}
                style={layout}
                onClick={() => onInspect(item)}
              >
                {item.item_type === 'planned' ? <Sparkles /> : statusIcon(item.status)}
                <span><strong>{item.name}</strong><small>{item.status.replaceAll('_', ' ')}</small></span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
