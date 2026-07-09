'use client';

import React, { useMemo, useState } from 'react';
import { CalendarPlus, Clock, Loader2, Repeat, X } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';

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

const BASIC_FREQUENCIES = FREQUENCIES.filter((frequency) =>
  frequency.id === 'daily' || frequency.id === 'weekly' || frequency.id === 'monthly');

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

const groupClass = 'overflow-hidden rounded-[9px] border border-neutral-200 bg-white shadow-sm';
const rowClass = 'flex min-h-[42px] items-center justify-between gap-3 border-b border-neutral-100 px-3 last:border-b-0';
const labelClass = 'text-[13px] font-medium text-neutral-500';
const chipClass =
  'h-8 rounded-[7px] border border-neutral-200 bg-white px-2.5 text-[13px] font-medium text-neutral-950 shadow-sm outline-none transition focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100';
const textInputClass =
  'h-10 w-full rounded-[9px] border border-neutral-200 bg-white px-3 text-[14px] text-neutral-950 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100';
const textareaClass =
  'w-full resize-none rounded-[10px] border border-neutral-200 bg-white p-4 text-[14px] leading-6 text-neutral-950 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100';
const fieldLabelClass = 'text-[14px] font-medium leading-none text-neutral-950';
const fieldHintClass = 'text-[14px] leading-5 text-neutral-500';
const switchClass = 'data-[state=checked]:bg-[#3b82f6] data-[state=unchecked]:bg-[#ddd9d2]';

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
  return draft.interval === 1 ? draft.onCompletionUnit.replace(/s$/, '') : draft.onCompletionUnit;
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
      <label htmlFor="routine-tags" className={fieldLabelClass}>Tags</label>
      <input
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
    <div className="space-y-4">
      <div className="grid h-10 grid-cols-3 gap-1 rounded-[9px] border border-neutral-200 bg-white p-1 shadow-sm">
        {BASIC_FREQUENCIES.map((frequency) => (
          <button
            key={frequency.id}
            type="button"
            aria-pressed={draft.frequency === frequency.id}
            onClick={() => onChange({ frequency: frequency.id, interval: 1 })}
            className={cn(
              'rounded-[7px] px-2 text-[13px] font-medium transition-colors',
              draft.frequency === frequency.id
                ? 'bg-neutral-100 text-neutral-950'
                : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-950',
            )}
          >
            {frequency.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {draft.frequency !== 'on_completion' ? (
          <label className="inline-flex h-10 w-[138px] items-center gap-2 rounded-[9px] border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 shadow-sm">
            <Clock className="h-4 w-4 text-neutral-500" strokeWidth={1.8} />
            <input
              type="time"
              value={timeValue}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':').map(Number);
                if (Number.isFinite(hour) && Number.isFinite(minute)) onChange({ hour, minute });
              }}
              className="w-[86px] bg-transparent text-[14px] text-neutral-900 outline-none [&::-webkit-calendar-picker-indicator]:hidden"
              aria-label="Time of day"
            />
          </label>
        ) : null}
      </div>

      <details className="group rounded-[9px] border border-neutral-200 bg-white shadow-sm">
        <summary className="flex h-9 cursor-default list-none items-center justify-between px-3 text-[13px] font-medium text-neutral-500 transition hover:text-neutral-950 [&::-webkit-details-marker]:hidden">
          Advanced schedule
          <span className="text-neutral-400 transition group-open:rotate-180">v</span>
        </summary>
        <section className="border-t border-neutral-100">
          <div className={rowClass}>
            <span className={labelClass}>Every</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={99}
                value={draft.interval}
                onChange={(event) => onChange({ interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
                className={cn(chipClass, 'w-[62px] text-center')}
                aria-label="Interval"
              />
              <span className="text-[13px] text-neutral-500">{intervalUnit(draft)}</span>
            </span>
          </div>

          {draft.frequency === 'weekly' ? (
            <div className={cn(rowClass, 'items-start py-2.5')}>
              <span className={cn(labelClass, 'pt-1')}>On</span>
              <span className="flex flex-wrap justify-end gap-1.5">
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
                        'h-7 rounded-[7px] px-2.5 text-[12px] font-medium transition',
                        active ? 'bg-neutral-950 text-white' : 'border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50',
                      )}
                    >
                      {day.label}
                    </button>
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
                ) : null}
              </span>
            </div>
          ) : null}

          {draft.frequency === 'on_completion' ? (
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
          ) : null}

          <div className={rowClass}>
            <span className={labelClass}>First run</span>
            <input
              type="date"
              value={draft.firstRun || ''}
              onChange={(event) => onChange({ firstRun: event.target.value || null })}
              className={cn(chipClass, 'text-right', !draft.firstRun && 'text-neutral-400')}
              aria-label="First run date"
            />
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Ends</span>
            <input
              type="date"
              value={draft.ends || ''}
              onChange={(event) => onChange({ ends: event.target.value || null })}
              className={cn(chipClass, 'text-right', !draft.ends && 'text-neutral-400')}
              aria-label="End date"
            />
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Paused</span>
            <Switch checked={paused} onCheckedChange={onPausedChange} className={switchClass} />
          </div>
        </section>
      </details>
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
        overlayClassName="bg-black/55"
        className="max-h-[calc(100vh-140px)] w-[1104px] max-w-[calc(100vw-96px)] gap-0 overflow-auto rounded-[12px] border border-neutral-200 bg-white p-0 text-neutral-950 shadow-2xl duration-150 motion-reduce:duration-0 [&>button]:hidden"
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
        <div className="px-7 pt-7">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-[20px] font-medium leading-none tracking-[-0.015em] text-neutral-950">Configure routine</DialogTitle>
              <p className="mt-2 text-[14px] text-neutral-500">
                {mode === 'create' ? 'Adjust the details, then create the routine.' : 'Adjust the details, then save the routine.'}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mx-7 mt-5 flex h-[78px] items-center justify-between gap-4 rounded-[10px] border border-neutral-200 bg-white px-4 shadow-sm">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-neutral-100 text-neutral-500">
              {template ? <RoutineIcon name={template.icon} className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium text-neutral-950">{template ? template.title : 'Custom routine'}</span>
              <span className="mt-1 block truncate text-[13px] text-neutral-500">{bannerSummary}</span>
            </span>
          </span>
          {template ? (
            <span className="hidden shrink-0 items-center gap-2 text-[13px] font-medium text-neutral-700 sm:inline-flex">
              <Repeat className="h-4 w-4" />
              Change template
            </span>
          ) : null}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 px-7 pb-6 md:grid-cols-[350px_1fr]">
          <div className="space-y-6 md:border-r md:border-neutral-200 md:pr-6">
            <div className="space-y-3">
              <label htmlFor="routine-name" className={fieldLabelClass}>Name</label>
              <input
                id="routine-name"
                autoFocus
                value={state.name}
                onChange={(event) => setState({ ...state, name: event.target.value })}
                placeholder="e.g. Weekly work review"
                className={textInputClass}
              />
            </div>

            <div className="space-y-3">
              <h3 className={fieldLabelClass}>Schedule</h3>
              <ScheduleEditor
                draft={state.draft}
                paused={state.paused}
                onPausedChange={(paused) => setState((current) => ({ ...current, paused }))}
                onChange={(patch) => setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }))}
              />

              <p className="px-1 text-[12px] leading-5 text-neutral-400" aria-live="polite">
                {lastRunAt ? <>Last: {formatOccurrence(new Date(lastRunAt), now)}<br /></> : null}
                Next: {state.paused
                  ? 'paused'
                  : preview.length
                    ? `${preview.map((date) => formatOccurrence(date, now)).join(', ')}...`
                    : 'no upcoming runs'}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className={fieldLabelClass}>Agent</h3>
              <div className="grid h-10 grid-cols-3 gap-1 rounded-[9px] border border-neutral-200 bg-white p-1 shadow-sm">
                {AGENT_TIERS.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    aria-pressed={state.agentTier === tier.id}
                    onClick={() => setState({ ...state, agentTier: tier.id })}
                    className={cn(
                      'rounded-[7px] px-2 text-[13px] font-medium transition-colors',
                      state.agentTier === tier.id
                        ? 'bg-neutral-100 text-neutral-950'
                        : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-950',
                    )}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            </div>

            <section className={groupClass}>
              <div className={rowClass}>
                <span>
                  <span className="block text-[14px] font-medium text-neutral-950">Notifications</span>
                  <span className="mt-0.5 block text-[13px] text-neutral-500">Push when a new report is ready.</span>
                </span>
                <Switch
                  checked={state.notifyPush}
                  onCheckedChange={(notifyPush) => setState({ ...state, notifyPush })}
                  className={switchClass}
                />
              </div>
              <div className={rowClass}>
                <span>
                  <span className="block text-[14px] font-medium text-neutral-950">Email</span>
                  <span className="mt-0.5 block text-[13px] text-neutral-500">Email me when a report is ready.</span>
                </span>
                <Switch
                  checked={state.notifyEmail}
                  onCheckedChange={(notifyEmail) => setState({ ...state, notifyEmail })}
                  className={switchClass}
                />
              </div>
            </section>
          </div>

          <div className="flex min-h-0 flex-col gap-5">
            <div className="space-y-3">
              <label htmlFor="routine-instructions" className={fieldLabelClass}>Instructions</label>
              <p className={fieldHintClass}>
                Describe what you&rsquo;d like Ritual to gather, analyze, or summarize.
              </p>
              <textarea
                id="routine-instructions"
                value={state.instructions}
                onChange={(event) => setState({ ...state, instructions: event.target.value })}
                placeholder="e.g. Create a well rounded report on my ongoing projects, todos, and goals"
                className={cn(textareaClass, 'h-[360px]')}
              />
            </div>

            <details className="group rounded-[9px] border border-neutral-200 bg-white shadow-sm">
              <summary className="flex h-9 cursor-default list-none items-center justify-between px-3 text-[13px] font-medium text-neutral-500 transition hover:text-neutral-950 [&::-webkit-details-marker]:hidden">
                Advanced details
                <span className="text-neutral-400 transition group-open:rotate-180">v</span>
              </summary>
              <div className="space-y-4 border-t border-neutral-100 p-3">
                <div className="flex min-h-8 items-center justify-between gap-4">
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
                <div className="space-y-2">
                  <label htmlFor="routine-notes" className={fieldLabelClass}>Notes</label>
                  <textarea
                    id="routine-notes"
                    value={state.notes}
                    onChange={(event) => setState({ ...state, notes: event.target.value })}
                    placeholder="Optional notes"
                    className={cn(textareaClass, 'h-[88px]')}
                  />
                </div>
                <TagsField
                  value={state.tags}
                  onChange={(tags) => setState((current) => ({ ...current, tags }))}
                />
              </div>
            </details>
          </div>
        </div>

        <div className="sticky bottom-0 flex h-[72px] items-center gap-3 border-t border-neutral-200 bg-white px-7">
          <button
            type="button"
            onClick={requestClose}
            className="inline-flex h-10 items-center rounded-[9px] px-4 text-[14px] text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-950"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'inline-flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-[9px] px-8 text-[14px] font-medium transition',
              canSubmit
                ? 'bg-neutral-950 text-white hover:bg-neutral-800'
                : 'bg-neutral-300 text-neutral-500',
            )}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === 'create' ? 'Create routine' : 'Save routine'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
