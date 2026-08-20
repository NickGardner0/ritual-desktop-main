'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, CircleDashed, Flag, Tag, X } from 'lucide-react';

import { Button } from '@ritual/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { DateRangePicker } from '@/components/date-range-picker';
import { dateFromInput } from '@/lib/tasks/date-format';
import {
  clearTaskComposerDraft,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  type TaskComposerDraft,
} from '@/lib/tasks/task-composer-storage';
import type { TaskCreateInput, TaskPriority } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';
import { EntityNoteField } from '@/components/entities/entity-note-field';
import { priorityBars } from '@/lib/tasks/task-ui-shell';

import { CATEGORY_FILTERS, PRIORITIES } from '@/lib/tasks/task-constants';

export type ScheduleWhen = TaskComposerDraft['schedule'];

export type NewTaskComposerSubmit = TaskCreateInput & {
  createMore: boolean;
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const SCHEDULE_LABELS: Record<ScheduleWhen, string> = {
  today: 'Today',
  upcoming: 'Upcoming',
  anytime: 'Anytime',
  custom: 'Pick date',
};

const CATEGORY_OPTIONS = CATEGORY_FILTERS.filter((item) => item !== 'All');

function scheduleToDate(schedule: ScheduleWhen, dueDate: string) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (schedule === 'today') {
    const iso = todayStart.toISOString();
    return iso;
  }
  if (schedule === 'upcoming') {
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = tomorrow.toISOString();
    return iso;
  }
  if (schedule === 'anytime') {
    return null;
  }
  const iso = dateFromInput(dueDate);
  return iso;
}

function dateToInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const ComposerPill = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ComposerPill({ children, className, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      data-cuelume-release="release"
      className={cn(
        'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-[var(--border-floating)] bg-[var(--surface-raised)] px-2.5 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] focus-visible:ring-offset-1',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
    </button>
  );
});

function defaultFormState(defaultSchedule: ScheduleWhen): Omit<TaskComposerDraft, 'savedAt'> {
  return {
    title: '',
    notes: '',
    priority: 'none',
    category: 'Personal',
    dueDate: '',
    deadlineDate: '',
    schedule: defaultSchedule,
  };
}

export function NewTaskComposer({
  open,
  onClose,
  onSubmit,
  pending,
  defaultSchedule = 'today',
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: NewTaskComposerSubmit) => void;
  pending?: boolean;
  defaultSchedule?: ScheduleWhen;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const dueInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [category, setCategory] = useState('Personal');
  const [dueDate, setDueDate] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [schedule, setSchedule] = useState<ScheduleWhen>(defaultSchedule);
  const [createMore, setCreateMore] = useState(false);
  const portalRoot = open && typeof document !== 'undefined' ? document.body : null;

  const applyFormState = useCallback((state: Omit<TaskComposerDraft, 'savedAt'>) => {
    setTitle(state.title);
    setNotes(state.notes);
    setPriority(state.priority);
    setCategory(state.category);
    setDueDate(state.dueDate);
    setDeadlineDate(state.deadlineDate);
    setSchedule(state.schedule);
  }, []);

  const resetForm = useCallback(
    (nextSchedule: ScheduleWhen = defaultSchedule) => {
      applyFormState(defaultFormState(nextSchedule));
    },
    [applyFormState, defaultSchedule],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      applyFormState(loadTaskComposerDraft() ?? defaultFormState(defaultSchedule));
      setCreateMore(false);
      window.setTimeout(() => titleRef.current?.focus(), 40);
    });
    return () => {
      cancelled = true;
    };
  }, [open, applyFormState, defaultSchedule]);

  useEffect(() => {
    if (!open) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (!title.trim() && !notes.trim()) {
        clearTaskComposerDraft();
        return;
      }
      saveTaskComposerDraft({
        title,
        notes,
        priority,
        category,
        dueDate,
        deadlineDate,
        schedule,
      });
    }, 300);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [open, title, notes, priority, category, dueDate, deadlineDate, schedule]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleSubmit = useCallback(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || pending) return;

    const scheduledFor = scheduleToDate(schedule, dueDate);
    onSubmit({
      title: trimmedTitle,
      notes: notes.trim() || null,
      priority,
      category,
      scheduled_for: scheduledFor,
      due_at: dateFromInput(deadlineDate),
      source: 'manual',
      client_event_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createMore,
    });

    clearTaskComposerDraft();
    if (createMore) {
      resetForm(defaultSchedule);
      window.setTimeout(() => titleRef.current?.focus(), 40);
    }
  }, [
    createMore,
    deadlineDate,
    defaultSchedule,
    dueDate,
    notes,
    onSubmit,
    pending,
    priority,
    category,
    resetForm,
    schedule,
    title,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleSubmit]);

  if (!open) return null;

  const customScheduleLabel = dueDate
    ? new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : 'Pick date';
  const deadlineLabel = deadlineDate
    ? new Date(`${deadlineDate}T09:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : 'Deadline';
  const selectedDeadline = deadlineDate ? new Date(`${deadlineDate}T09:00:00`) : undefined;
  const selectedDeadlineRange = selectedDeadline
    ? { from: selectedDeadline, to: selectedDeadline }
    : undefined;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] h-[100dvh] w-screen overflow-hidden"
      data-tauri-drag-region="false"
    >
      <div
        className="absolute inset-0 bg-transparent"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        data-tauri-drag-region="false"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 grid place-items-center p-4"
        style={{ left: 'var(--ritual-sidebar-current-width, 0px)' }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-task-title"
          className={cn(
            'ritual-dialog-surface task-composer-dialog',
            'pointer-events-auto relative z-20 flex min-h-[360px] max-h-[calc(100dvh-32px)] w-full max-w-[680px] flex-col overflow-hidden',
          )}
          data-tauri-drag-region="false"
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-5">
            <h2 id="new-task-title" className="text-[14px] font-medium text-[var(--text-primary)]">
              New task
            </h2>
            <div className="flex items-center gap-0.5">
              {title.trim() || notes.trim() ? (
                <button
                  type="button"
                  onClick={() => {
                    clearTaskComposerDraft();
                    resetForm(defaultSchedule);
                  }}
                  className="rounded-[var(--radius-row)] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
                >
                  Clear draft
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="rounded-[var(--radius-row)] p-1.5 text-[var(--icon-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 px-5 pb-4 pt-5">
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                }
              }}
              placeholder="Task title"
              className="w-full bg-transparent text-[22px] font-medium leading-7 tracking-[-0.02em] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              aria-label="Task title"
            />
            <EntityNoteField
              value={notes}
              onChange={setNotes}
              placeholder="Add description..."
              rows={3}
              className="mt-3 min-h-[104px] w-full resize-none bg-transparent text-[14px] leading-5 text-[var(--text-secondary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>

          <div className="relative flex flex-wrap items-center gap-1.5 px-5 pb-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ComposerPill>
                  {priority === 'none' ? (
                    <CircleDashed className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  ) : (
                    priorityBars(priority)
                  )}
                  {PRIORITY_LABELS[priority]}
                </ComposerPill>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                {PRIORITIES.map((item) => (
                  <DropdownMenuItem key={item} onClick={() => setPriority(item)}>
                    {item === 'none' ? (
                      <CircleDashed className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    ) : (
                      priorityBars(item)
                    )}
                    {PRIORITY_LABELS[item]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ComposerPill>
                  <Tag className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  {category}
                </ComposerPill>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {CATEGORY_OPTIONS.map((item) => (
                  <DropdownMenuItem key={item} onClick={() => setCategory(item)}>
                    {item}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <ComposerPill
                  className={cn(schedule === 'custom' && dueDate && 'text-[var(--text-primary)]')}
                >
                  {schedule === 'custom' && !dueDate ? (
                    <CircleDashed className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  ) : (
                    <Calendar className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  )}
                  {schedule === 'custom' ? customScheduleLabel : SCHEDULE_LABELS[schedule]}
                </ComposerPill>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {(Object.keys(SCHEDULE_LABELS) as ScheduleWhen[]).map((item) => (
                  <DropdownMenuItem
                    key={item}
                    onClick={() => {
                      setSchedule(item);
                      if (item === 'custom') {
                        window.setTimeout(() => dueInputRef.current?.showPicker?.(), 0);
                        return;
                      }
                      setDueDate('');
                    }}
                  >
                    {SCHEDULE_LABELS[item]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={dueInputRef}
              type="date"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                if (event.target.value) setSchedule('custom');
              }}
              className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
              tabIndex={-1}
              aria-hidden
            />

            <DateRangePicker
              variant="compact"
              initialDateRange={selectedDeadlineRange}
              onDateRangeChange={(range) => {
                const deadline = range?.to ?? range?.from;
                setDeadlineDate(deadline ? dateToInput(deadline) : '');
              }}
              trigger={
                <ComposerPill className={cn(deadlineDate && 'text-[var(--text-primary)]')}>
                  <Flag className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  {deadlineLabel}
                </ComposerPill>
              }
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[var(--divider-subtle)] px-5 py-3">
            <label className="mr-auto flex cursor-pointer items-center gap-2">
              <Switch checked={createMore} onCheckedChange={setCreateMore} data-cuelume-toggle />
              <span className="text-[12px] text-[var(--text-muted)]">Create more</span>
            </label>
            <Button
              type="button"
              variant="brand"
              size="compact"
              onClick={handleSubmit}
              disabled={!title.trim() || pending}
              className="rounded-full px-3.5"
              data-cuelume-press="press"
            >
              {pending ? 'Creating…' : 'Create task'}
              <kbd className="rounded-full border border-[var(--brand-action-foreground)]/20 px-1.5 py-0.5 text-[10px] font-normal opacity-80">
                ⌘↵
              </kbd>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return portalRoot ? createPortal(modalContent, portalRoot) : null;
}
