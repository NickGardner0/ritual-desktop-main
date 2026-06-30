'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, X } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { dateFromInput } from '@/lib/tasks/date-format';
import {
  clearTaskComposerDraft,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  type TaskComposerDraft,
} from '@/lib/tasks/task-composer-storage';
import type { TaskCreateInput, TaskPriority } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';

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

function scheduleToDates(schedule: ScheduleWhen, dueDate: string) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (schedule === 'today') {
    const iso = todayStart.toISOString();
    return { scheduled_for: iso, due_at: iso };
  }
  if (schedule === 'upcoming') {
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = tomorrow.toISOString();
    return { scheduled_for: iso, due_at: iso };
  }
  if (schedule === 'anytime') {
    return { scheduled_for: null, due_at: null };
  }
  const iso = dateFromInput(dueDate);
  return { scheduled_for: iso, due_at: iso };
}

function ComposerPill({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm border border-[var(--border-subtle)] bg-[var(--content-bg)] px-2.5 text-[12.5px] text-[rgba(39,37,30,0.75)] hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 focus-visible:ring-offset-1',
        className,
      )}
    >
      {children}
      <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
    </button>
  );
}

function defaultFormState(defaultSchedule: ScheduleWhen): Omit<TaskComposerDraft, 'savedAt'> {
  return {
    title: '',
    notes: '',
    priority: 'none',
    category: 'Personal',
    dueDate: '',
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
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const dueInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<number | null>(null);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [category, setCategory] = useState('Personal');
  const [dueDate, setDueDate] = useState('');
  const [schedule, setSchedule] = useState<ScheduleWhen>(defaultSchedule);
  const [createMore, setCreateMore] = useState(false);

  const resetForm = useCallback(
    (nextSchedule: ScheduleWhen = defaultSchedule) => {
      const defaults = defaultFormState(nextSchedule);
      setTitle(defaults.title);
      setNotes(defaults.notes);
      setPriority(defaults.priority);
      setCategory(defaults.category);
      setDueDate(defaults.dueDate);
      setSchedule(defaults.schedule);
    },
    [defaultSchedule],
  );

  useEffect(() => {
    if (!open) return;
    const draft = loadTaskComposerDraft();
    if (draft) {
      setTitle(draft.title);
      setNotes(draft.notes);
      setPriority(draft.priority);
      setCategory(draft.category);
      setDueDate(draft.dueDate);
      setSchedule(draft.schedule);
    } else {
      resetForm(defaultSchedule);
    }
    setCreateMore(false);
    window.setTimeout(() => titleRef.current?.focus(), 40);
  }, [open, defaultSchedule, resetForm]);

  useEffect(() => {
    if (!open) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (!title.trim() && !notes.trim()) {
        clearTaskComposerDraft();
        return;
      }
      saveTaskComposerDraft({ title, notes, priority, category, dueDate, schedule });
    }, 300);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [open, title, notes, priority, category, dueDate, schedule]);

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

    const dates = scheduleToDates(schedule, dueDate);
    onSubmit({
      title: trimmedTitle,
      notes: notes.trim() || null,
      priority,
      category,
      ...dates,
      source: 'manual',
      client_event_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createMore,
    });

    clearTaskComposerDraft();
    if (createMore) {
      resetForm(defaultSchedule);
      window.setTimeout(() => titleRef.current?.focus(), 40);
    }
  }, [createMore, defaultSchedule, dueDate, notes, onSubmit, pending, priority, category, resetForm, schedule, title]);

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

  const dueLabel = dueDate
    ? new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Due date';

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      data-tauri-drag-region="false"
    >
      <div
        className="absolute inset-0 bg-[#f7f6f2]/55 dark:bg-[#121212]/80"
        onClick={onClose}
        data-tauri-drag-region="false"
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="New task"
        className="relative z-10 flex w-[90vw] max-w-[520px] flex-col overflow-hidden rounded-sm border border-[var(--border-subtle)] bg-[var(--content-bg)] text-[var(--text-primary)] shadow-[0_22px_60px_-42px_rgba(15,23,42,0.48),0_2px_10px_-6px_rgba(15,23,42,0.16)]"
        data-tauri-drag-region="false"
      >
        <div className="flex flex-shrink-0 items-center justify-end gap-1 px-4 pb-1 pt-4">
          {(title.trim() || notes.trim()) ? (
            <button
              type="button"
              onClick={() => {
                clearTaskComposerDraft();
                resetForm(defaultSchedule);
              }}
              className="rounded-sm px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
            >
              Clear draft
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-[var(--icon-muted)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-2">
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                notesRef.current?.focus();
              }
            }}
            placeholder="New task"
            className="w-full bg-transparent text-[17px] font-medium leading-snug tracking-[-0.01em] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <textarea
            ref={notesRef}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add description..."
            rows={3}
            className="mt-2.5 w-full resize-none bg-transparent text-[14px] leading-relaxed text-[rgba(39,37,30,0.78)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ComposerPill>{PRIORITY_LABELS[priority]}</ComposerPill>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 rounded-sm">
              {PRIORITIES.map((item) => (
                <DropdownMenuItem key={item} onClick={() => setPriority(item)}>
                  {PRIORITY_LABELS[item]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ComposerPill>{category}</ComposerPill>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 rounded-sm">
              {CATEGORY_OPTIONS.map((item) => (
                <DropdownMenuItem key={item} onClick={() => setCategory(item)}>
                  {item}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ComposerPill>{SCHEDULE_LABELS[schedule]}</ComposerPill>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 rounded-sm">
              {(Object.keys(SCHEDULE_LABELS) as ScheduleWhen[]).map((item) => (
                <DropdownMenuItem
                  key={item}
                  onClick={() => {
                    setSchedule(item);
                    if (item === 'custom') {
                      window.setTimeout(() => dueInputRef.current?.showPicker?.(), 0);
                    }
                  }}
                >
                  {SCHEDULE_LABELS[item]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={() => dueInputRef.current?.showPicker?.()}
            className="relative"
          >
            <ComposerPill className={cn(dueDate && 'text-[var(--text-primary)]')}>
              <Calendar className="h-3 w-3 opacity-60" />
              {dueLabel}
            </ComposerPill>
            <input
              ref={dueInputRef}
              type="date"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                if (event.target.value) setSchedule('custom');
              }}
              className="pointer-events-none absolute inset-0 opacity-0"
              tabIndex={-1}
            />
          </button>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-subtle)] px-6 py-3.5">
          <label className="mr-auto flex cursor-pointer items-center gap-2">
            <Switch checked={createMore} onCheckedChange={setCreateMore} />
            <span className="text-[12px] text-[var(--text-muted)]">Create more</span>
          </label>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim() || pending}
            className="inline-flex items-center gap-2 rounded-sm border border-[#27251E] bg-[#27251E] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#3d3a32] disabled:opacity-40"
          >
            Create task
            <kbd className="rounded-sm border border-white/20 px-1.5 py-0.5 text-[10px] font-normal opacity-80">
              ⌘↵
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
