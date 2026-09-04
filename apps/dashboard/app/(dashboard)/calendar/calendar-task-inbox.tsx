'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Draggable } from '@fullcalendar/interaction';
import { Check, Circle, GripVertical, Plus, Search, X } from 'lucide-react';

import type { CalendarTaskSummary } from '@ritual/shared-contracts';
import { Button } from '@ritual/ui/button';
import { Input } from '@ritual/ui/input';

type GroupId = 'overdue' | 'today' | 'unscheduled';

function localDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function groupsForTasks(tasks: CalendarTaskSummary[]) {
  const today = localDay(new Date());
  const groups: Record<GroupId, CalendarTaskSummary[]> = { overdue: [], today: [], unscheduled: [] };
  tasks.forEach((task) => {
    const due = task.due_at ? localDay(new Date(task.due_at)) : null;
    if (due !== null && due < today) groups.overdue.push(task);
    else if (due === today) groups.today.push(task);
    else groups.unscheduled.push(task);
  });
  return [
    { id: 'overdue' as const, title: 'Overdue', tasks: groups.overdue },
    { id: 'today' as const, title: 'Due today', tasks: groups.today },
    { id: 'unscheduled' as const, title: 'Unscheduled', tasks: groups.unscheduled },
  ];
}

export function CalendarTaskInbox({
  tasks,
  defaultDurationMinutes,
  onCreate,
  onComplete,
  onInspect,
  onClose,
}: {
  tasks: CalendarTaskSummary[];
  defaultDurationMinutes: number;
  onCreate: (title: string) => Promise<void>;
  onComplete: (task: CalendarTaskSummary) => void;
  onInspect: (task: CalendarTaskSummary) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('all');
  const [priority, setPriority] = useState('all');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!rootRef.current) return;
    const draggable = new Draggable(rootRef.current, {
      itemSelector: '[data-calendar-task]',
      eventData: (element) => ({
        title: element.getAttribute('data-task-title') || 'Task allocation',
        duration: { minutes: defaultDurationMinutes },
        create: true,
        extendedProps: {
          taskId: element.getAttribute('data-task-id'),
          kind: 'task_allocation',
          origin: 'ritual',
        },
      }),
    });
    return () => draggable.destroy();
  }, [defaultDurationMinutes]);

  const projects = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.project).filter(Boolean) as string[])).sort(),
    [tasks],
  );
  const visible = useMemo(() => tasks.filter((task) => {
    const haystack = `${task.title} ${task.notes || ''} ${task.project || ''}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase()))
      && (project === 'all' || task.project === project)
      && (priority === 'all' || task.priority === priority);
  }), [priority, project, query, tasks]);

  return (
    <aside ref={rootRef} className="ritual-calendar-tasks" aria-label="Task inbox">
      <header className="ritual-calendar-pane-header">
        <div>
          <div className="ritual-calendar-pane-eyebrow">Tasks</div>
          <h2>Inbox <span>{visible.length}</span></h2>
        </div>
        <Button variant="ghost" size="icon-compact" onClick={onClose} aria-label="Close task inbox"><X /></Button>
      </header>

      <div className="ritual-calendar-task-tools">
        <label className="ritual-calendar-search">
          <Search aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
        </label>
        <div className="ritual-calendar-task-filters">
          <select value={project} onChange={(event) => setProject(event.target.value)} aria-label="Filter tasks by project">
            <option value="all">All projects</option>
            {projects.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Filter tasks by priority">
            <option value="all">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="none">No priority</option>
          </select>
        </div>
        <form
          className="ritual-calendar-quick-task"
          onSubmit={(event) => {
            event.preventDefault();
            const title = draft.trim();
            if (!title) return;
            setDraft('');
            void onCreate(title);
          }}
        >
          <Plus aria-hidden="true" />
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task…" aria-label="Quick-create a task" />
        </form>
      </div>

      <div className="ritual-calendar-task-groups">
        {groupsForTasks(visible).map((group) => (
          <section key={group.id}>
            <h3 className={group.id === 'overdue' ? 'is-overdue' : ''}>{group.title}<span>{group.tasks.length}</span></h3>
            {group.tasks.length ? group.tasks.map((task) => (
              <div
                key={task.id}
                data-calendar-task
                data-task-id={task.id}
                data-task-title={task.title}
                className="ritual-calendar-task-row"
                tabIndex={0}
                role="button"
                aria-label={`${task.title}. Drag to schedule, or press Enter to inspect.`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onInspect(task);
                }}
                onClick={() => onInspect(task)}
              >
                <button
                  type="button"
                  className="ritual-calendar-task-check"
                  onClick={(event) => { event.stopPropagation(); onComplete(task); }}
                  aria-label={`Complete ${task.title}`}
                >
                  <Circle /><Check />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="ritual-calendar-task-title">{task.title}</div>
                  <div className="ritual-calendar-task-meta">
                    {task.project || task.category || 'Inbox'}
                    {task.allocation_count ? ` · ${task.allocation_count} allocation${task.allocation_count === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
                <GripVertical className="ritual-calendar-drag-handle" aria-hidden="true" />
              </div>
            )) : <p className="ritual-calendar-empty-group">Nothing here</p>}
          </section>
        ))}
      </div>
    </aside>
  );
}
