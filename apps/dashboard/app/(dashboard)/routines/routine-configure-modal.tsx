'use client';

import React, { useMemo, useState } from 'react';
import { ChevronsRight, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { cn } from '@ritual/ui/cn';
import { Input } from '@ritual/ui/input';
import { Separator } from '@ritual/ui/separator';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
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

const groupClass = 'overflow-hidden rounded-2xl bg-surface-panel';
const rowClass = 'flex min-h-11 items-center justify-between gap-3 px-3.5 py-2';
const labelClass = 'text-sm text-[var(--text-secondary)]';
const chipClass =
  'h-8 rounded-full border-0 bg-background px-3 text-sm font-medium text-[var(--text-primary)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/20';
const dateChipClass =
  'h-8 max-w-[160px] rounded-full border-0 bg-transparent px-2 text-right text-sm font-medium text-[var(--text-primary)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/20 [&::-webkit-calendar-picker-indicator]:opacity-40';
const wellClass = 'rounded-2xl bg-surface-panel px-3.5 py-2.5';

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
      <span className="text-sm text-[var(--text-secondary)]">Tags</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(value.filter((item) => item !== tag))}
            className="inline-flex h-6 items-center gap-1 rounded-full bg-background px-2.5 text-[12px] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
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
            className="h-6 w-24 rounded-full border-0 bg-background px-2.5 text-[12px] shadow-none focus-visible:ring-1"
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
            className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-[var(--border-default)] px-2.5 text-[12px] text-[var(--text-muted)] transition-colors hover:border-[var(--text-secondary)] hover:text-[var(--text-secondary)]"
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
        className={cn(groupClass, 'w-full px-3.5 py-3 text-left transition-colors hover:bg-[var(--row-hover)]')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)]">Instructions</div>
            <p className="mt-0.5 text-[12px] leading-4 text-[var(--text-muted)]">
              Tap to describe what you&rsquo;d like the AI to do when this routine runs.
            </p>
          </div>
          <span
            className={cn(
              'max-w-[140px] shrink-0 truncate pt-0.5 text-right text-sm',
              value ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]',
            )}
          >
            {value || 'Not set'}
          </span>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg gap-0 border-border bg-background p-0 sm:rounded-xl [&>button]:hidden">
          <DialogHeader className="px-6 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-lg font-medium">Instructions</DialogTitle>
                <DialogDescription className="mt-1.5 text-sm text-[var(--text-secondary)]">
                  Describe what you&rsquo;d like the AI to gather, analyze, or do for this routine.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="h-8 w-8 shrink-0 text-[var(--text-secondary)]"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="px-6 py-4">
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="e.g. Review my overdue tasks each morning and draft a prioritized plan for the day"
              className="min-h-40 w-full resize-none rounded-2xl border-0 bg-surface-panel px-3.5 py-3 text-sm leading-6 text-[var(--text-primary)] outline-none ring-offset-background placeholder:text-[var(--text-muted)] focus-visible:ring-2 focus-visible:ring-ring/20"
            />
          </div>
          <DialogFooter className="gap-2 border-t border-[var(--border-subtle)] px-6 py-4 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
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
    <div className="flex flex-col gap-4">
      <section className={groupClass}>
        <PanelRow label="Trigger">
          <select
            value={draft.frequency}
            onChange={(event) => onChange({ frequency: event.target.value as ScheduleDraft['frequency'], interval: 1 })}
            className={cn(chipClass, 'min-w-[120px]')}
            aria-label="Trigger frequency"
          >
            {FREQUENCIES.map((frequency) => (
              <option key={frequency.id} value={frequency.id}>{frequency.label}</option>
            ))}
          </select>
        </PanelRow>
        <Separator className="bg-[var(--border-subtle)]" />
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
            className={cn(chipClass, 'w-[72px] text-center')}
            aria-label="Interval"
          />
          <span className="text-sm text-[var(--text-muted)]">
            {intervalUnit(draft).replace(/s$/, draft.interval === 1 ? '' : 's')}
          </span>
        </PanelRow>

        {draft.frequency === 'weekly' ? (
          <>
            <Separator className="bg-[var(--border-subtle)]" />
            <PanelRow label="On" className="items-start py-2.5">
              <span className="flex max-w-[220px] flex-wrap justify-end gap-1">
                {WEEKDAYS.map((day) => {
                  const active = draft.weekdays.includes(day.value);
                  return (
                    <Button
                      key={day.value}
                      type="button"
                      variant={active ? 'default' : 'secondary'}
                      size="sm"
                      aria-pressed={active}
                      onClick={() => onChange({
                        weekdays: active
                          ? draft.weekdays.filter((value) => value !== day.value)
                          : [...draft.weekdays, day.value].sort((a, b) => a - b),
                      })}
                      className="h-7 rounded-full px-2.5 text-[12px]"
                    >
                      {day.label}
                    </Button>
                  );
                })}
              </span>
            </PanelRow>
          </>
        ) : null}

        {draft.frequency === 'monthly' || draft.frequency === 'yearly' ? (
          <>
            <Separator className="bg-[var(--border-subtle)]" />
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
                  <span className="text-sm text-[var(--text-muted)]">in</span>
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
          </>
        ) : null}

        {draft.frequency !== 'on_completion' ? (
          <>
            <Separator className="bg-[var(--border-subtle)]" />
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
          </>
        ) : (
          <>
            <Separator className="bg-[var(--border-subtle)]" />
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
          </>
        )}

        <Separator className="bg-[var(--border-subtle)]" />
        <PanelRow label="First run">
          <Input
            type="date"
            value={draft.firstRun || ''}
            onChange={(event) => onChange({ firstRun: event.target.value || null })}
            className={cn(dateChipClass, !draft.firstRun && 'text-[var(--text-muted)]')}
            aria-label="First run date"
          />
        </PanelRow>
        <Separator className="bg-[var(--border-subtle)]" />
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

  if (lastInitial !== initial) {
    setLastInitial(initial);
    setState(initial);
    setEditingTitle(false);
  }

  const now = useNow(30_000);
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const canSubmit = (state.name.trim().length > 0 || state.instructions.trim().length > 0) && !submitting;
  const title = state.name.trim() || (mode === 'create' ? 'New routine' : 'Untitled routine');

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

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <SheetContent
        side="right"
        className={cn(
          'inset-y-3 right-3 flex h-auto w-[min(100%-24px,420px)] flex-col gap-0 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-background p-0 shadow-[0_12px_40px_rgba(15,23,42,0.12)] sm:max-w-[420px]',
          'data-[state=closed]:slide-out-to-right-4 data-[state=open]:slide-in-from-right-4',
          '[&>button]:hidden',
        )}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          requestClose();
        }}
      >
        <div className="flex h-12 shrink-0 items-center px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={requestClose}
            aria-label="Close panel"
            className="h-8 w-8 rounded-full text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6">
          <div className="mx-auto flex w-full max-w-[380px] flex-col gap-5">
            <div className="min-w-0">
              <SheetDescription className="text-[12px] text-[var(--text-muted)]">
                Routine
              </SheetDescription>
              <SheetTitle className="sr-only">
                {mode === 'create' ? 'Configure routine' : 'Edit routine'}
              </SheetTitle>
              {editingTitle ? (
                <Input
                  autoFocus
                  value={state.name}
                  onChange={(event) => setState({ ...state, name: event.target.value })}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === 'Escape') {
                      setEditingTitle(false);
                    }
                  }}
                  placeholder="e.g. Weekly work review"
                  className="mt-1 h-auto border-0 bg-transparent px-0 text-[28px] font-semibold leading-tight tracking-tight text-[var(--text-primary)] shadow-none focus-visible:ring-0"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="mt-1 block w-full truncate text-left text-[28px] font-semibold leading-tight tracking-tight text-[var(--text-primary)]"
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

            <p className="px-1 text-[12px] leading-5 text-[var(--text-muted)]" aria-live="polite">
              {lastRunAt ? <>Last: {formatOccurrence(new Date(lastRunAt), now)}<br /></> : null}
              Next: {state.paused
                ? 'paused'
                : preview.length
                  ? `${preview.map((date) => formatOccurrence(date, now)).join(', ')}...`
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
              <Separator className="bg-[var(--border-subtle)]" />
              <PanelRow label="Agent">
                <span className="flex items-center gap-1">
                  {AGENT_TIERS.map((tier) => (
                    <Button
                      key={tier.id}
                      type="button"
                      variant={state.agentTier === tier.id ? 'default' : 'secondary'}
                      size="sm"
                      aria-pressed={state.agentTier === tier.id}
                      onClick={() => setState({ ...state, agentTier: tier.id })}
                      className="h-7 rounded-full px-2.5 text-[12px]"
                    >
                      {tier.label}
                    </Button>
                  ))}
                </span>
              </PanelRow>
            </section>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-[var(--text-secondary)]">Notes</span>
              <textarea
                value={state.notes}
                onChange={(event) => setState({ ...state, notes: event.target.value })}
                placeholder="No notes yet."
                className={cn(
                  wellClass,
                  'min-h-[88px] w-full resize-none border-0 text-sm leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-2 focus-visible:ring-ring/20',
                )}
              />
            </div>

            <TagsField
              value={state.tags}
              onChange={(tags) => setState((current) => ({ ...current, tags }))}
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-background/95 px-7 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[380px] items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={!canSubmit}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {mode === 'create' ? 'Create routine' : 'Save routine'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** @deprecated Prefer RoutineConfigurePanel */
export const RoutineConfigureModal = RoutineConfigurePanel;
