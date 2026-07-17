'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronsRight, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { cn } from '@ritual/ui/cn';
import { Input } from '@ritual/ui/input';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useRightDockTarget } from '@/contexts/RightDockContext';
import {
  AGENT_TIERS,
  ALL_DATA_SOURCE_KEYS,
  defaultScheduleDraft,
  scheduleDraftFromRoutine,
  triggerConfigFromDraft,
  type AgentRoutine,
  type AgentTier,
  type ScheduleDraft,
} from '@/lib/routines/model';
import { nextOccurrences } from '@/lib/routines/schedule-engine.mjs';
import { templateScheduleDraft, type RoutineTemplate } from '@/lib/routines/templates';
import { formatOccurrence, toDate, useNow } from '@/lib/routines/time';
import { WEEKDAYS } from '@/lib/tasks/routine-editor';
import type { TaskPriority } from '@/lib/tasks/types';

export type RoutineConfigureState = {
  name: string;
  instructions: string;
  notes: string;
  tags: string[];
  priority: TaskPriority;
  paused: boolean;
  agentTier: AgentTier;
  notifyPush: boolean;
  notifyEmail: boolean;
  icon: string;
  dataSources: string[];
  templateKey: string | null;
  draft: ScheduleDraft;
};

export function configureStateFromTemplate(template: RoutineTemplate | null): RoutineConfigureState {
  if (!template) {
    return {
      name: '',
      instructions: '',
      notes: '',
      tags: [],
      priority: 'none',
      paused: false,
      agentTier: 'regular',
      notifyPush: true,
      notifyEmail: false,
      icon: 'sparkles',
      dataSources: [...ALL_DATA_SOURCE_KEYS],
      templateKey: null,
      draft: defaultScheduleDraft(),
    };
  }
  return {
    name: template.title,
    instructions: template.instructions,
    notes: '',
    tags: [],
    priority: 'none',
    paused: false,
    agentTier: 'regular',
    notifyPush: true,
    notifyEmail: false,
    icon: template.icon,
    dataSources: [...template.dataSources],
    templateKey: template.id,
    draft: templateScheduleDraft(template),
  };
}

export function configureStateFromRoutine(item: AgentRoutine): RoutineConfigureState {
  return {
    name: item.routine.title,
    instructions: item.agent.instructions,
    notes: item.routine.task_template?.notes || '',
    tags: item.routine.tags || [],
    priority: item.routine.priority,
    paused: item.routine.status === 'paused',
    agentTier: item.agent.agent_tier,
    notifyPush: item.agent.notify_push,
    notifyEmail: item.agent.notify_email,
    icon: item.agent.icon,
    dataSources: item.agent.data_sources.length ? [...item.agent.data_sources] : [...ALL_DATA_SOURCE_KEYS],
    templateKey: item.agent.template_key,
    draft: scheduleDraftFromRoutine(item.routine),
  };
}

const FREQUENCIES: Array<{ id: ScheduleDraft['frequency']; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'on_completion', label: 'On completion' },
];

const PRIORITIES: Array<{ id: TaskPriority; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const groupClass = 'divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]';
const rowClass = 'flex min-h-[30px] items-center justify-between gap-3 px-0 py-1.5';
const labelClass = 'text-[13px] text-[var(--text-secondary)]';
const chipClass =
  'h-7 rounded-control border border-[var(--border-subtle)] bg-transparent px-2 text-[13px] font-medium text-[var(--text-primary)] outline-none transition-colors hover:bg-[var(--row-hover)] focus-visible:ring-1 focus-visible:ring-ring/20';
const dateChipClass =
  'h-7 max-w-[148px] rounded-control border-0 bg-transparent px-1.5 text-right text-[13px] font-medium text-[var(--text-primary)] outline-none transition-colors hover:bg-[var(--row-hover)] focus-visible:ring-1 focus-visible:ring-ring/20 [&::-webkit-calendar-picker-indicator]:opacity-40';
const wellClass =
  'rounded-row border border-[var(--border-subtle)] bg-transparent px-3 py-2';
const segmentClass =
  'h-7 rounded-control px-2.5 text-[12px] font-medium';
const tagClass =
  'inline-flex h-6 items-center gap-1 rounded-row bg-[var(--row-hover)] px-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--row-active)] hover:text-[var(--text-primary)]';

function ordinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const mod10 = day % 10;
  if (mod10 === 1) return `${day}st`;
  if (mod10 === 2) return `${day}nd`;
  if (mod10 === 3) return `${day}rd`;
  return `${day}th`;
}

function intervalUnit(draft: ScheduleDraft): string {
  if (draft.frequency === 'daily') return draft.interval === 1 ? 'day' : 'days';
  if (draft.frequency === 'weekly') return draft.interval === 1 ? 'week' : 'weeks';
  if (draft.frequency === 'monthly') return draft.interval === 1 ? 'month' : 'months';
  if (draft.frequency === 'yearly') return draft.interval === 1 ? 'year' : 'years';
  return draft.onCompletionUnit;
}

function PanelRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(rowClass, className)}>
      <span className={labelClass}>{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function TagsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  const commit = () => {
    const tag = text.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setText('');
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-[var(--text-muted)]">Tags</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(value.filter((item) => item !== tag))}
            className={tagClass}
            aria-label={`Remove tag ${tag}`}
          >
            {tag}
            <X className="h-3 w-3 opacity-60" />
          </button>
        ))}
        {adding ? (
          <Input
            autoFocus
            value={text}
            placeholder="tag"
            className="h-6 w-24 rounded-control border border-[var(--border-subtle)] bg-transparent px-2 text-[12px] shadow-none focus-visible:ring-1"
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setText('');
                setAdding(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-6 items-center gap-1 rounded-control border border-dashed border-[var(--border-default)] px-2 text-[12px] text-[var(--text-muted)] transition-colors hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
          >
            <Plus className="h-3 w-3" />
            tag
          </button>
        )}
      </div>
    </div>
  );
}

function InstructionsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        className="flex w-full items-center justify-between gap-3 rounded-row px-1 py-2 text-left transition-colors hover:bg-[var(--row-hover)]"
      >
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[var(--text-primary)]">Instructions</div>
          <p className="mt-0.5 text-[12px] leading-4 text-[var(--text-muted)]">
            Describe what the AI should do when this routine runs.
          </p>
        </div>
        <span
          className={cn(
            'max-w-[140px] shrink-0 truncate text-right text-[13px]',
            value ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]',
          )}
        >
          {value || 'Not set'}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg gap-0 border-border bg-background p-0 sm:rounded-xl [&>button]:hidden">
          <DialogHeader className="px-5 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-base font-medium">Instructions</DialogTitle>
                <DialogDescription className="mt-1 text-[13px] text-[var(--text-secondary)]">
                  Describe what you&rsquo;d like the AI to gather, analyze, or do for this routine.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="h-7 w-7 shrink-0 rounded-control text-[var(--text-secondary)]"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="px-5 py-3">
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="e.g. Review my overdue tasks each morning and draft a prioritized plan for the day"
              className="min-h-40 w-full resize-none rounded-row border border-[var(--border-subtle)] bg-transparent px-3 py-2.5 text-[13px] leading-5 text-[var(--text-primary)] outline-none ring-offset-background placeholder:text-[var(--text-muted)] focus-visible:ring-1 focus-visible:ring-ring/20"
            />
          </div>
          <DialogFooter className="gap-2 border-t border-[var(--border-subtle)] px-5 py-3 sm:justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(draft.trim());
                setOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScheduleEditor({
  draft,
  paused,
  onChange,
  onPausedChange,
}: {
  draft: ScheduleDraft;
  paused: boolean;
  onChange: (patch: Partial<ScheduleDraft>) => void;
  onPausedChange: (paused: boolean) => void;
}) {
  const timeValue = `${String(draft.hour).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`;

  return (
    <div className="flex flex-col gap-3">
      <section className={groupClass}>
        <PanelRow label="Trigger">
          <select
            value={draft.frequency}
            onChange={(event) => onChange({ frequency: event.target.value as ScheduleDraft['frequency'], interval: 1 })}
            className={cn(chipClass, 'min-w-[112px]')}
            aria-label="Trigger frequency"
          >
            {FREQUENCIES.map((frequency) => (
              <option key={frequency.id} value={frequency.id}>{frequency.label}</option>
            ))}
          </select>
        </PanelRow>
        <PanelRow label="Paused">
          <Switch checked={paused} onCheckedChange={onPausedChange} />
        </PanelRow>
      </section>

      <section className={groupClass}>
        <PanelRow label="Every">
          <Input
            type="number"
            min={1}
            max={99}
            value={draft.interval}
            onChange={(event) => onChange({ interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
            className={cn(chipClass, 'w-[64px] text-center')}
            aria-label="Interval"
          />
          <span className="text-[13px] text-[var(--text-muted)]">
            {intervalUnit(draft).replace(/s$/, draft.interval === 1 ? '' : 's')}
          </span>
        </PanelRow>

        {draft.frequency === 'weekly' ? (
          <PanelRow label="On" className="items-start py-2">
            <span className="flex max-w-[220px] flex-wrap justify-end gap-1">
              {WEEKDAYS.map((day) => {
                const active = draft.weekdays.includes(day.value);
                return (
                  <Button
                    key={day.value}
                    type="button"
                    variant={active ? 'default' : 'ghost'}
                    size="sm"
                    aria-pressed={active}
                    onClick={() => onChange({
                      weekdays: active
                        ? draft.weekdays.filter((value) => value !== day.value)
                        : [...draft.weekdays, day.value].sort((a, b) => a - b),
                    })}
                    className={segmentClass}
                  >
                    {day.label}
                  </Button>
                );
              })}
            </span>
          </PanelRow>
        ) : null}

        {draft.frequency === 'monthly' || draft.frequency === 'yearly' ? (
          <PanelRow label="On the">
            <select
              value={String(draft.day)}
              onChange={(event) => {
                const value = event.target.value;
                onChange({ day: value === 'first' || value === 'last' ? value : Number(value) });
              }}
              className={chipClass}
              aria-label="Day of month"
            >
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>{ordinalSuffix(day)}</option>
              ))}
              <option value="first">first day</option>
              <option value="last">last day</option>
            </select>
            {draft.frequency === 'yearly' ? (
              <>
                <span className="text-[13px] text-[var(--text-muted)]">in</span>
                <select
                  value={draft.month}
                  onChange={(event) => onChange({ month: Number(event.target.value) })}
                  className={chipClass}
                  aria-label="Month"
                >
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index + 1}>{month}</option>
                  ))}
                </select>
              </>
            ) : null}
          </PanelRow>
        ) : null}

        {draft.frequency !== 'on_completion' ? (
          <PanelRow label="At">
            <Input
              type="time"
              value={timeValue}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':').map(Number);
                if (Number.isFinite(hour) && Number.isFinite(minute)) onChange({ hour, minute });
              }}
              className={cn(chipClass, '[&::-webkit-calendar-picker-indicator]:hidden')}
              aria-label="Time of day"
            />
          </PanelRow>
        ) : (
          <PanelRow label="After">
            <select
              value={draft.onCompletionUnit}
              onChange={(event) => onChange({ onCompletionUnit: event.target.value as ScheduleDraft['onCompletionUnit'] })}
              className={chipClass}
              aria-label="Completion interval unit"
            >
              <option value="days">days</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
            </select>
          </PanelRow>
        )}

        <PanelRow label="First run">
          <Input
            type="date"
            value={draft.firstRun || ''}
            onChange={(event) => onChange({ firstRun: event.target.value || null })}
            className={cn(dateChipClass, !draft.firstRun && 'text-[var(--text-muted)]')}
            aria-label="First run date"
          />
        </PanelRow>
        <PanelRow label="Ends">
          <Input
            type="date"
            value={draft.ends || ''}
            onChange={(event) => onChange({ ends: event.target.value || null })}
            className={cn(dateChipClass, !draft.ends && 'text-[var(--text-muted)]')}
            aria-label="End date"
          />
        </PanelRow>
      </section>
    </div>
  );
}

const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_WIDTH = 560;

export function RoutineConfigurePanel({
  open,
  mode,
  initial,
  lastRunAt,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  initial: RoutineConfigureState;
  lastRunAt?: string | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (state: RoutineConfigureState) => void;
}) {
  const [state, setState] = useState<RoutineConfigureState>(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  const [editingTitle, setEditingTitle] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();
  const dockTarget = useRightDockTarget();

  if (lastInitial !== initial) {
    setLastInitial(initial);
    setState(initial);
    setEditingTitle(false);
  }

  const now = useNow(30_000);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const canSubmit = (state.name.trim().length > 0 || state.instructions.trim().length > 0) && !submitting;
  const title = state.name.trim() || (mode === 'create' ? 'New routine' : 'Untitled routine');
  const headingId = 'routine-configure-panel-title';

  const preview = useMemo(() => nextOccurrences({
    triggerType: state.draft.frequency,
    config: triggerConfigFromDraft(state.draft),
    from: now,
    firstRunAt: state.draft.firstRun ? new Date(`${state.draft.firstRun}T00:00:00`) : null,
    endsAt: state.draft.ends ? new Date(`${state.draft.ends}T23:59:59`) : null,
    lastCompletedAt: toDate(lastRunAt),
    count: 4,
  }), [state.draft, now, lastRunAt]);

  const requestClose = () => {
    if (dirty && !window.confirm('Discard your changes to this routine?')) return;
    onClose();
  };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(state);
  };

  const requestCloseRef = useRef(requestClose);
  const submitRef = useRef(submit);
  requestCloseRef.current = requestClose;
  submitRef.current = submit;

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        event.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const clampWidth = () => {
      const maxForViewport = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * 0.48)));
      setPanelWidth((current) => Math.min(current, maxForViewport));
    };
    clampWidth();
    window.addEventListener('resize', clampWidth);
    return () => window.removeEventListener('resize', clampWidth);
  }, [open]);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (event: MouseEvent) => {
      const maxForViewport = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.floor(window.innerWidth * 0.48)));
      const next = window.innerWidth - event.clientX;
      setPanelWidth(Math.min(maxForViewport, Math.max(MIN_PANEL_WIDTH, next)));
    };
    const onUp = () => setIsResizing(false);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  if (!dockTarget) return null;

  return createPortal(
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          key="routine-configure-panel"
          ref={panelRef}
          tabIndex={-1}
          role="complementary"
          aria-labelledby={headingId}
          initial={reduceMotion ? false : { width: 0, opacity: 0 }}
          animate={{ width: panelWidth, opacity: 1 }}
          exit={reduceMotion ? { width: 0, opacity: 0 } : { width: 0, opacity: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 420, damping: 38 }
          }
          className="relative flex h-full shrink-0 overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--surface-panel)] outline-none will-change-transform"
        >
          <div
            onMouseDown={(event) => {
              event.preventDefault();
              setIsResizing(true);
            }}
            className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1 cursor-col-resize"
            aria-label="Resize side panel"
            role="separator"
            aria-orientation="vertical"
          >
            <div
              className={cn(
                'mx-auto h-full w-px transition-colors',
                isResizing ? 'bg-[var(--border-default)]' : 'bg-transparent hover:bg-[var(--border-default)]',
              )}
            />
          </div>

          <div
            className="flex h-full flex-col"
            style={{ width: panelWidth }}
          >
            <div className="flex h-10 shrink-0 items-center gap-1 px-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={requestClose}
                aria-label="Close panel"
                className="h-7 w-7 rounded-control text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <div className="mx-auto flex w-full max-w-[360px] flex-col gap-4">
                <div className="min-w-0 px-0.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-muted)]">
                    Routine
                  </p>
                  <h2 id={headingId} className="sr-only">
                    {mode === 'create' ? 'Configure routine' : 'Edit routine'}
                  </h2>
                  {editingTitle ? (
                    <Input
                      autoFocus
                      value={state.name}
                      onChange={(event) => setState({ ...state, name: event.target.value })}
                      onBlur={() => setEditingTitle(false)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === 'Escape') {
                          event.stopPropagation();
                          setEditingTitle(false);
                        }
                      }}
                      placeholder="e.g. Weekly work review"
                      className="mt-1 h-auto border-0 bg-transparent px-0 text-base font-medium leading-tight tracking-tight text-[var(--text-primary)] shadow-none focus-visible:ring-0"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingTitle(true)}
                      className="mt-1 block w-full truncate text-left text-base font-medium leading-tight tracking-tight text-[var(--text-primary)]"
                    >
                      {title}
                    </button>
                  )}
                </div>

                <InstructionsField
                  value={state.instructions}
                  onChange={(instructions) => setState((current) => ({ ...current, instructions }))}
                />

                <ScheduleEditor
                  draft={state.draft}
                  paused={state.paused}
                  onPausedChange={(paused) => setState((current) => ({ ...current, paused }))}
                  onChange={(patch) => setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }))}
                />

                <p className="px-0.5 text-[12px] leading-4 text-[var(--text-muted)]" aria-live="polite">
                  {lastRunAt ? <>Last: {formatOccurrence(new Date(lastRunAt), now)} · </> : null}
                  Next: {state.paused
                    ? 'paused'
                    : preview.length
                      ? preview.map((date) => formatOccurrence(date, now)).join(', ')
                      : 'no upcoming runs'}
                </p>

                <section className={groupClass}>
                  <PanelRow label="Priority">
                    <select
                      value={state.priority}
                      onChange={(event) => setState({ ...state, priority: event.target.value as TaskPriority })}
                      className={chipClass}
                      aria-label="Priority"
                    >
                      {PRIORITIES.map((priority) => (
                        <option key={priority.id} value={priority.id}>{priority.label}</option>
                      ))}
                    </select>
                  </PanelRow>
                  <PanelRow label="Agent">
                    <span className="flex items-center gap-1">
                      {AGENT_TIERS.map((tier) => (
                        <Button
                          key={tier.id}
                          type="button"
                          variant={state.agentTier === tier.id ? 'default' : 'ghost'}
                          size="sm"
                          aria-pressed={state.agentTier === tier.id}
                          onClick={() => setState({ ...state, agentTier: tier.id })}
                          className={segmentClass}
                        >
                          {tier.label}
                        </Button>
                      ))}
                    </span>
                  </PanelRow>
                </section>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-[var(--text-muted)]">Notes</span>
                  <textarea
                    value={state.notes}
                    onChange={(event) => setState({ ...state, notes: event.target.value })}
                    placeholder="No notes yet."
                    className={cn(
                      wellClass,
                      'min-h-[72px] w-full resize-none text-[13px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-1 focus-visible:ring-ring/20',
                    )}
                  />
                </div>

                <TagsField
                  value={state.tags}
                  onChange={(tags) => setState((current) => ({ ...current, tags }))}
                />
              </div>
            </div>

            <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-panel)] px-4 py-3">
              <div className="mx-auto flex w-full max-w-[360px] items-center justify-end gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={requestClose} className="h-7 rounded-control px-2.5">
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={submit} disabled={!canSubmit} className="h-7 rounded-control px-2.5">
                  {submitting ? <Loader2 className="animate-spin" /> : null}
                  {mode === 'create' ? 'Create' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>,
    dockTarget,
  );
}

/** @deprecated Prefer RoutineConfigurePanel */
export const RoutineConfigureModal = RoutineConfigurePanel;
