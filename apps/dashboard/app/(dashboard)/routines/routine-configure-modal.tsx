'use client';

import React, { useMemo, useState } from 'react';
import { Loader2, Repeat, X } from 'lucide-react';
import { Button } from '@ritual/ui/button';
import { Card } from '@ritual/ui/card';
import { cn } from '@ritual/ui/cn';
import { Input } from '@ritual/ui/input';
import { Label } from '@ritual/ui/label';
import { Separator } from '@ritual/ui/separator';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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
import { describeSchedule, nextOccurrences } from '@/lib/routines/schedule-engine.mjs';
import { ROUTINE_TEMPLATES, templateScheduleDraft, type RoutineTemplate } from '@/lib/routines/templates';
import { formatOccurrence, toDate, useNow } from '@/lib/routines/time';
import { RoutineIcon } from '@/lib/routines/ui';
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

const groupClass = 'overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-surface-panel';
const rowClass = 'flex min-h-12 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-4 last:border-b-0';
const labelClass = 'text-sm font-medium text-[var(--text-secondary)]';
const chipClass =
  'h-8 rounded-control border border-transparent bg-background px-3 text-sm font-medium text-[var(--text-primary)] outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20';
const textInputClass =
  'h-9 text-sm text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0';
const textareaClass =
  'w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 text-[var(--text-primary)] outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';

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

function TagsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState(value.join(', '));
  const commit = () => {
    onChange(text.split(',').map((tag) => tag.trim()).filter(Boolean));
  };
  return (
    <div className="space-y-2">
      <Label htmlFor="routine-tags">Tags</Label>
      <Input
        id="routine-tags"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        placeholder="Optional tags"
        className={textInputClass}
      />
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
    <div className="space-y-5">
      <section className={groupClass}>
        <div className={rowClass}>
          <span className={labelClass}>Trigger</span>
          <select
            value={draft.frequency}
            onChange={(event) => onChange({ frequency: event.target.value as ScheduleDraft['frequency'], interval: 1 })}
            className={cn(chipClass, 'min-w-[150px]')}
            aria-label="Trigger frequency"
          >
            {FREQUENCIES.map((frequency) => (
              <option key={frequency.id} value={frequency.id}>{frequency.label}</option>
            ))}
          </select>
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Paused</span>
          <Switch checked={paused} onCheckedChange={onPausedChange} />
        </div>
      </section>

      <section className={groupClass}>
        <div className={rowClass}>
          <span className={labelClass}>Every</span>
          <span className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              max={99}
              value={draft.interval}
              onChange={(event) => onChange({ interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
              className={cn(chipClass, 'w-[76px] text-center')}
              aria-label="Interval"
            />
            <span className="text-sm font-medium text-[var(--text-secondary)]">{intervalUnit(draft).replace(/s$/, draft.interval === 1 ? '' : 's')}</span>
          </span>
        </div>

        {draft.frequency === 'weekly' ? (
          <div className={rowClass}>
            <span className={labelClass}>On</span>
            <span className="flex flex-wrap justify-end gap-1.5">
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
                    className="h-8 rounded-control px-2.5 text-[13px]"
                  >
                    {day.label}
                  </Button>
                );
              })}
            </span>
          </div>
        ) : null}

        {draft.frequency === 'monthly' || draft.frequency === 'yearly' ? (
          <div className={rowClass}>
            <span className={labelClass}>On the</span>
            <span className="flex items-center gap-2">
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
                  <span className="text-sm text-[var(--text-secondary)]">in</span>
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
            </span>
          </div>
        ) : null}

        {draft.frequency !== 'on_completion' ? (
          <div className={rowClass}>
            <span className={labelClass}>At</span>
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
          </div>
        ) : (
          <div className={rowClass}>
            <span className={labelClass}>After</span>
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
          </div>
        )}

        <div className={rowClass}>
          <span className={labelClass}>First run</span>
          <Input
            type="date"
            value={draft.firstRun || ''}
            onChange={(event) => onChange({ firstRun: event.target.value || null })}
            className={cn(chipClass, 'text-right', !draft.firstRun && 'text-[var(--text-muted)]')}
            aria-label="First run date"
          />
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Ends</span>
          <Input
            type="date"
            value={draft.ends || ''}
            onChange={(event) => onChange({ ends: event.target.value || null })}
            className={cn(chipClass, 'text-right', !draft.ends && 'text-[var(--text-muted)]')}
            aria-label="End date"
          />
        </div>
      </section>
    </div>
  );
}

export function RoutineConfigureModal({
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
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setState(initial);
  }
  const now = useNow(30_000);

  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const canSubmit = (state.name.trim().length > 0 || state.instructions.trim().length > 0) && !submitting;

  const preview = useMemo(() => nextOccurrences({
    triggerType: state.draft.frequency,
    config: triggerConfigFromDraft(state.draft),
    from: now,
    firstRunAt: state.draft.firstRun ? new Date(`${state.draft.firstRun}T00:00:00`) : null,
    endsAt: state.draft.ends ? new Date(`${state.draft.ends}T23:59:59`) : null,
    lastCompletedAt: toDate(lastRunAt),
    count: 4,
  }), [state.draft, now, lastRunAt]);

  const template = ROUTINE_TEMPLATES.find((item) => item.id === state.templateKey) || null;
  const bannerSummary = template?.scheduleLabel || describeSchedule(state.draft.frequency, triggerConfigFromDraft(state.draft));

  const requestClose = () => {
    if (dirty && !window.confirm('Discard your changes to this routine?')) return;
    onClose();
  };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(state);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent
        className="max-h-[calc(100vh-48px)] max-w-4xl gap-0 overflow-auto border-border bg-background p-0 text-[var(--text-primary)] shadow-lg duration-150 motion-reduce:duration-0 sm:rounded-xl [&>button]:hidden"
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
        <div className="flex items-start justify-between px-6 pt-6">
          <div>
            <DialogTitle className="text-xl font-medium leading-tight tracking-normal">Configure routine</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-[var(--text-secondary)]">
              {mode === 'create' ? 'Adjust the details, then create the routine.' : 'Adjust the details, then save the routine.'}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={requestClose}
            aria-label="Close"
            className="h-9 w-9 rounded-row text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
          >
            <X />
          </Button>
        </div>

        <Card className="mx-6 mt-6 flex items-center gap-3 border-[var(--border-subtle)] bg-surface-panel px-4 py-3 shadow-none">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-row bg-background text-[var(--icon-muted)]">
            {template ? <RoutineIcon name={template.icon} className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{template ? template.title : 'Custom routine'}</span>
            <span className="block truncate text-[13px] text-[var(--text-muted)]">{bannerSummary}</span>
          </span>
        </Card>

        <div className="grid grid-cols-1 gap-6 px-6 pb-6 pt-6 md:grid-cols-2">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="routine-name">Name</Label>
              <Input
                id="routine-name"
                autoFocus
                value={state.name}
                onChange={(event) => setState({ ...state, name: event.target.value })}
                placeholder="e.g. Weekly work review"
                className={textInputClass}
              />
            </div>

            <ScheduleEditor
              draft={state.draft}
              paused={state.paused}
              onPausedChange={(paused) => setState((current) => ({ ...current, paused }))}
              onChange={(patch) => setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }))}
            />

            <p className="px-1 text-[13px] leading-5 text-[var(--text-muted)]" aria-live="polite">
              {lastRunAt ? <>Last: {formatOccurrence(new Date(lastRunAt), now)}<br /></> : null}
              Next: {state.paused
                ? 'paused'
                : preview.length
                  ? `${preview.map((date) => formatOccurrence(date, now)).join(', ')}...`
                  : 'no upcoming runs'}
            </p>

            <section className={groupClass}>
              <div className={rowClass}>
                <span className={labelClass}>Priority</span>
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
              </div>
              <div className={rowClass}>
                <span className={labelClass}>Agent</span>
                <span className="flex items-center gap-1.5">
                  {AGENT_TIERS.map((tier) => (
                    <Button
                      key={tier.id}
                      type="button"
                      variant={state.agentTier === tier.id ? 'default' : 'secondary'}
                      size="sm"
                      aria-pressed={state.agentTier === tier.id}
                      onClick={() => setState({ ...state, agentTier: tier.id })}
                      className="h-8 rounded-control px-3 text-[13px]"
                    >
                      {tier.label}
                    </Button>
                  ))}
                </span>
              </div>
            </section>
          </div>

          <div className="flex min-h-0 flex-col gap-5 md:border-l md:border-[var(--border-subtle)] md:pl-6">
            <div className="space-y-2">
              <Label htmlFor="routine-instructions">Instructions</Label>
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
                Describe what you&rsquo;d like the AI to gather, analyze, or do.
              </p>
              <textarea
                id="routine-instructions"
                value={state.instructions}
                onChange={(event) => setState({ ...state, instructions: event.target.value })}
                placeholder="e.g. Review my overdue tasks each morning and draft a prioritized plan for the day"
                className={cn(textareaClass, 'min-h-56')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="routine-notes">Notes</Label>
              <textarea
                id="routine-notes"
                value={state.notes}
                onChange={(event) => setState({ ...state, notes: event.target.value })}
                placeholder="Optional notes"
                className={cn(textareaClass, 'min-h-28')}
              />
            </div>

            <TagsField
              value={state.tags}
              onChange={(tags) => setState((current) => ({ ...current, tags }))}
            />
          </div>
        </div>

        <Separator className="bg-[var(--border-subtle)]" />
        <div className="sticky bottom-0 flex items-center justify-end gap-3 bg-background/95 px-6 py-4 backdrop-blur">
          <Button
            type="button"
            variant="outline"
            onClick={requestClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            {mode === 'create' ? 'Create routine' : 'Save routine'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
