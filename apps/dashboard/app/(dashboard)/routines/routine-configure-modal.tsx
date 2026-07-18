'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronsRight, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { cn } from '@ritual/ui/cn';
import { Input } from '@ritual/ui/input';

import { Switch } from '@/components/ui/switch';
import { useRegisterRightDockClose, useRightDockTarget } from '@/contexts/RightDockContext';
import {
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
import { InlineFieldInput, PillSelect } from '@/lib/tasks/task-ui-shell';
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

// Match the todo composer / PillSelect language: compact bordered pills,
// gray hover only — never native <select> (macOS paints those with blue).
const groupClass = 'overflow-hidden rounded-md bg-[#f8f8f7]';
const rowClass = 'flex min-h-[36px] items-center justify-between gap-3 border-b border-[rgba(39,37,30,0.06)] px-3 last:border-b-0';
const labelClass = 'text-[13px] font-normal text-[rgba(39,37,30,0.55)]';
const segmentClass =
  'h-7 rounded-md px-2.5 text-[12.5px] font-normal';
const tagClass =
  'inline-flex h-7 items-center gap-1 rounded-md border border-gray-200/90 bg-white px-2.5 text-[12.5px] font-normal text-[rgba(39,37,30,0.75)] shadow-sm transition hover:bg-[#F5F5F5] hover:text-[#27251E]';
const mutedClass = 'text-[12.5px] font-normal text-[rgba(39,37,30,0.45)]';
const pillSelectClass = 'min-w-[96px] rounded-md';

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
      <span className={mutedClass}>Tags</span>
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
          <InlineFieldInput
            autoFocus
            value={text}
            placeholder="tag"
            className="w-24"
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
            className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-gray-300 px-2.5 text-[12.5px] font-normal text-[rgba(39,37,30,0.45)] transition hover:border-gray-400 hover:bg-[#F5F5F5] hover:text-[rgba(39,37,30,0.75)]"
          >
            <Plus className="h-3 w-3" />
            tag
          </button>
        )}
      </div>
    </div>
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
    <div className="flex flex-col gap-2.5">
      <section className={groupClass}>
        <PanelRow label="Trigger">
          <PillSelect
            value={draft.frequency}
            onChange={(frequency) => onChange({ frequency, interval: 1 })}
            options={FREQUENCIES.map((frequency) => ({ value: frequency.id, label: frequency.label }))}
            className={cn(pillSelectClass, 'min-w-[112px]')}
          />
        </PanelRow>
        <PanelRow label="Paused">
          <Switch checked={paused} onCheckedChange={onPausedChange} />
        </PanelRow>
      </section>

      <section className={groupClass}>
        <PanelRow label="Every">
          <InlineFieldInput
            type="number"
            min={1}
            max={99}
            value={draft.interval}
            onChange={(event) => onChange({ interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
            className="w-[52px] px-1.5 text-center"
            aria-label="Interval"
          />
          <span className={mutedClass}>
            {intervalUnit(draft).replace(/s$/, draft.interval === 1 ? '' : 's')}
          </span>
        </PanelRow>

        {draft.frequency === 'weekly' ? (
          <PanelRow label="On" className="items-start py-2.5">
            <span className="flex max-w-[220px] flex-wrap justify-end gap-1">
              {WEEKDAYS.map((day) => {
                const active = draft.weekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange({
                      weekdays: active
                        ? draft.weekdays.filter((value) => value !== day.value)
                        : [...draft.weekdays, day.value].sort((a, b) => a - b),
                    })}
                    className={cn(
                      segmentClass,
                      active
                        ? 'bg-[#27251E] text-white'
                        : 'border border-gray-200/90 bg-white text-[rgba(39,37,30,0.75)] shadow-sm hover:bg-[#F5F5F5]',
                    )}
                  >
                    {day.label}
                  </button>
                );
              })}
            </span>
          </PanelRow>
        ) : null}

        {draft.frequency === 'monthly' || draft.frequency === 'yearly' ? (
          <PanelRow label="On the">
            <PillSelect
              value={String(draft.day)}
              onChange={(value) => {
                onChange({ day: value === 'first' || value === 'last' ? value : Number(value) });
              }}
              options={[
                ...Array.from({ length: 31 }, (_, index) => {
                  const day = index + 1;
                  return { value: String(day), label: ordinalSuffix(day) };
                }),
                { value: 'first', label: 'first day' },
                { value: 'last', label: 'last day' },
              ]}
              className={pillSelectClass}
            />
            {draft.frequency === 'yearly' ? (
              <>
                <span className={mutedClass}>in</span>
                <PillSelect
                  value={String(draft.month)}
                  onChange={(month) => onChange({ month: Number(month) })}
                  options={MONTHS.map((month, index) => ({
                    value: String(index + 1),
                    label: month,
                  }))}
                  className={cn(pillSelectClass, 'min-w-[120px]')}
                />
              </>
            ) : null}
          </PanelRow>
        ) : null}

        {draft.frequency !== 'on_completion' ? (
          <PanelRow label="At">
            <InlineFieldInput
              type="time"
              value={timeValue}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':').map(Number);
                if (Number.isFinite(hour) && Number.isFinite(minute)) onChange({ hour, minute });
              }}
              className="w-auto [&::-webkit-calendar-picker-indicator]:opacity-40"
              aria-label="Time of day"
            />
          </PanelRow>
        ) : (
          <PanelRow label="After">
            <PillSelect
              value={draft.onCompletionUnit}
              onChange={(onCompletionUnit) => onChange({ onCompletionUnit })}
              options={[
                { value: 'days', label: 'days' },
                { value: 'weeks', label: 'weeks' },
                { value: 'months', label: 'months' },
              ]}
              className={pillSelectClass}
            />
          </PanelRow>
        )}

        <PanelRow label="First run">
          <InlineFieldInput
            type="date"
            value={draft.firstRun || ''}
            onChange={(event) => onChange({ firstRun: event.target.value || null })}
            className={cn('w-auto max-w-[148px]', !draft.firstRun && 'text-[rgba(39,37,30,0.4)]')}
            aria-label="First run date"
          />
        </PanelRow>
        <PanelRow label="Ends">
          <InlineFieldInput
            type="date"
            value={draft.ends || ''}
            onChange={(event) => onChange({ ends: event.target.value || null })}
            className={cn('w-auto max-w-[148px]', !draft.ends && 'text-[rgba(39,37,30,0.4)]')}
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
  const canSubmit = state.name.trim().length > 0 && !submitting;
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

  useRegisterRightDockClose(open, requestClose);

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
          className="relative flex h-full shrink-0 overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--surface-content)] outline-none will-change-transform"
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
            <div className="flex h-11 shrink-0 items-center gap-1 px-2.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={requestClose}
                aria-label="Close panel"
                className="h-7 w-7 rounded-[7px] text-[var(--text-secondary)] hover:bg-[rgba(15,23,42,0.055)] hover:text-[var(--text-primary)]"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <div className="mx-auto flex w-full max-w-[360px] flex-col gap-2.5">
                <div className="mb-1.5 min-w-0 px-0.5">
                  <p className="text-[12px] font-[500] text-[var(--text-muted)]">
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
                      className="mt-1 h-auto border-0 bg-transparent px-0 text-[18px] font-medium leading-tight tracking-[-0.015em] text-[#27251E] shadow-none focus-visible:ring-0"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingTitle(true)}
                      className="mt-1 block w-full truncate text-left text-[18px] font-medium leading-tight tracking-[-0.015em] text-[#27251E]"
                    >
                      {title}
                    </button>
                  )}
                </div>

                <ScheduleEditor
                  draft={state.draft}
                  paused={state.paused}
                  onPausedChange={(paused) => setState((current) => ({ ...current, paused }))}
                  onChange={(patch) => setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }))}
                />

                <p className="px-1 text-[12px] leading-4 text-[rgba(39,37,30,0.45)]" aria-live="polite">
                  {lastRunAt ? <>Last: {formatOccurrence(new Date(lastRunAt), now)} · </> : null}
                  Next: {state.paused
                    ? 'paused'
                    : preview.length
                      ? `${preview.map((date) => formatOccurrence(date, now)).join(', ')}...`
                      : 'no upcoming runs'}
                </p>

                <section className={groupClass}>
                  <PanelRow label="Priority">
                    <PillSelect
                      value={state.priority}
                      onChange={(priority) => setState({ ...state, priority })}
                      options={PRIORITIES.map((priority) => ({ value: priority.id, label: priority.label }))}
                      className={pillSelectClass}
                    />
                  </PanelRow>
                </section>

                <section className={groupClass}>
                  <textarea
                    value={state.notes}
                    onChange={(event) => setState({ ...state, notes: event.target.value })}
                    placeholder="Add a short description…"
                    className="min-h-[88px] w-full resize-none border-0 bg-transparent px-3 py-3 text-[13px] leading-5 text-[#27251E] outline-none placeholder:text-[rgba(39,37,30,0.4)] focus-visible:ring-0"
                  />
                </section>

                <TagsField
                  value={state.tags}
                  onChange={(tags) => setState((current) => ({ ...current, tags }))}
                />
              </div>
            </div>

            <div className="shrink-0 border-t border-[rgba(15,23,42,0.045)] bg-[var(--surface-content)] px-5 py-3">
              <div className="mx-auto flex w-full max-w-[360px] items-center justify-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={requestClose}
                  className="h-7 rounded-md px-2.5 text-[12.5px] font-normal"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="compact"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="h-7 gap-1.5 rounded-md border border-black bg-black px-2.5 text-[12.5px] font-normal text-white shadow-none transition-colors duration-150 hover:bg-[#3D3C38] hover:text-white disabled:opacity-40 [&_svg]:size-3.5"
                >
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
