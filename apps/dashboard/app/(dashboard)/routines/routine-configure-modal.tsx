'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, Clock, Loader2, RefreshCw, X } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { cn } from '@/lib/utils';

export type RoutineConfigureState = {
  name: string;
  instructions: string;
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
    agentTier: item.agent.agent_tier,
    notifyPush: item.agent.notify_push,
    notifyEmail: item.agent.notify_email,
    icon: item.agent.icon,
    dataSources: item.agent.data_sources.length ? [...item.agent.data_sources] : [...ALL_DATA_SOURCE_KEYS],
    templateKey: item.agent.template_key,
    draft: scheduleDraftFromRoutine(item.routine),
  };
}

const SIMPLE_FREQUENCIES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
] as const;

const FREQUENCY_UNITS: Record<string, string> = {
  daily: 'days',
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fieldLabelClass() {
  return 'text-[13px] font-[650] text-[#3b414b]';
}

const inputClass =
  'h-9 w-full rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/90 px-3 text-[14px] font-[540] text-[#22262d] outline-none transition focus:border-[rgba(15,23,42,0.24)]';

const smallControlClass =
  'h-8 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/90 px-2 text-[13px] font-[560] text-[#22262d] outline-none transition focus:border-[rgba(15,23,42,0.24)]';

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex w-full items-center gap-1 rounded-sm bg-[#eef1ea] p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            'h-8 flex-1 rounded-sm px-3 text-[13px] font-[640] transition',
            value === option.id
              ? 'bg-white text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
              : 'text-[#6b7280] hover:bg-white/55 hover:text-[#20242b]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ScheduleEditor({
  draft,
  onChange,
}: {
  draft: ScheduleDraft;
  onChange: (patch: Partial<ScheduleDraft>) => void;
}) {
  const [advanced, setAdvanced] = useState(
    draft.frequency === 'yearly' || draft.frequency === 'on_completion' || draft.interval > 1 || Boolean(draft.firstRun) || Boolean(draft.ends),
  );
  const simpleValue = (SIMPLE_FREQUENCIES.some((option) => option.id === draft.frequency)
    ? draft.frequency
    : null) as 'daily' | 'weekly' | 'monthly' | null;

  const timeValue = `${String(draft.hour).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`;

  return (
    <div className="space-y-3">
      <SegmentedControl
        value={simpleValue}
        options={SIMPLE_FREQUENCIES}
        onChange={(frequency) => onChange({ frequency, interval: 1 })}
      />

      <div className="flex flex-wrap items-center gap-2">
        {draft.frequency !== 'on_completion' ? (
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/90 px-3 text-[14px] font-[560] text-[#22262d] transition focus-within:border-[rgba(15,23,42,0.24)]">
            <Clock className="h-3.5 w-3.5 text-[#8a929c]" />
            <input
              type="time"
              value={timeValue}
              onChange={(event) => {
                const [hour, minute] = event.target.value.split(':').map(Number);
                if (Number.isFinite(hour) && Number.isFinite(minute)) onChange({ hour, minute });
              }}
              className="bg-transparent outline-none [&::-webkit-calendar-picker-indicator]:hidden"
            />
          </label>
        ) : null}
        {draft.frequency === 'weekly' ? (
          <span className="flex flex-wrap gap-1.5">
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
                    'h-8 rounded-sm px-2.5 text-[12px] font-[640] transition',
                    active ? 'bg-[#111827] text-white' : 'border border-[rgba(15,23,42,0.10)] bg-white/85 text-[#626a75] hover:bg-white',
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </span>
        ) : null}
        {draft.frequency === 'monthly' || draft.frequency === 'yearly' ? (
          <label className="inline-flex h-9 items-center gap-2 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/90 px-3 text-[13px] font-[560] text-[#6a717b]">
            On the
            <select
              value={String(draft.day)}
              onChange={(event) => {
                const value = event.target.value;
                onChange({ day: value === 'first' || value === 'last' ? value : Number(value) });
              }}
              className="bg-transparent text-[13px] font-[620] text-[#22262d] outline-none"
            >
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
              <option value="first">first day</option>
              <option value="last">last day</option>
            </select>
            {draft.frequency === 'yearly' ? (
              <>
                in
                <select
                  value={draft.month}
                  onChange={(event) => onChange({ month: Number(event.target.value) })}
                  className="bg-transparent text-[13px] font-[620] text-[#22262d] outline-none"
                >
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index + 1}>{month}</option>
                  ))}
                </select>
              </>
            ) : null}
          </label>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((value) => !value)}
        aria-expanded={advanced}
        className="inline-flex items-center gap-1 text-[12px] font-[640] text-[#6a717b] transition hover:text-[#22262d]"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-180')} />
        Advanced
      </button>

      {advanced ? (
        <div className="space-y-2.5 rounded-[8px] border border-[rgba(15,23,42,0.07)] bg-[#f4f5f2] p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-[560] text-[#6a717b]">Frequency</span>
            <select
              value={draft.frequency}
              onChange={(event) => onChange({ frequency: event.target.value as ScheduleDraft['frequency'] })}
              className={cn(smallControlClass, 'w-[150px]')}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="on_completion">On completion</option>
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-[560] text-[#6a717b]">Every</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={99}
                value={draft.interval}
                onChange={(event) => onChange({ interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
                className={cn(smallControlClass, 'w-16 text-right')}
              />
              {draft.frequency === 'on_completion' ? (
                <select
                  value={draft.onCompletionUnit}
                  onChange={(event) => onChange({ onCompletionUnit: event.target.value as ScheduleDraft['onCompletionUnit'] })}
                  className={cn(smallControlClass, 'w-[120px]')}
                >
                  <option value="days">days after</option>
                  <option value="weeks">weeks after</option>
                  <option value="months">months after</option>
                </select>
              ) : (
                <span className="text-[13px] font-[560] text-[#6a717b]">{FREQUENCY_UNITS[draft.frequency]}</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-[560] text-[#6a717b]">First run</span>
            <input
              type="date"
              value={draft.firstRun || ''}
              onChange={(event) => onChange({ firstRun: event.target.value || null })}
              className={cn(smallControlClass, 'w-[150px]')}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-[560] text-[#6a717b]">Ends</span>
            <input
              type="date"
              value={draft.ends || ''}
              onChange={(event) => onChange({ ends: event.target.value || null })}
              className={cn(smallControlClass, 'w-[150px]')}
            />
          </div>
        </div>
      ) : null}
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
    // A new modal session started — adopt its initial state.
    setLastInitial(initial);
    setState(initial);
  }
  const now = useNow(30_000);

  const dirty = JSON.stringify(state) !== JSON.stringify(initial);
  const canSubmit = state.instructions.trim().length > 0 && !submitting;

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
  const bannerSummary = describeSchedule(state.draft.frequency, triggerConfigFromDraft(state.draft));

  const applyTemplate = (nextTemplate: RoutineTemplate | null) => {
    setState((current) => ({
      ...configureStateFromTemplate(nextTemplate),
      notifyPush: current.notifyPush,
      notifyEmail: current.notifyEmail,
      agentTier: current.agentTier,
    }));
  };

  const requestClose = () => {
    if (dirty && !window.confirm('Discard your changes to this routine?')) return;
    onClose();
  };

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(state);
  };

  const selectedTier = AGENT_TIERS.find((tier) => tier.id === state.agentTier) || AGENT_TIERS[1];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogContent
        className="max-w-[980px] gap-0 border-[rgba(15,23,42,0.10)] bg-[#fbfbf9] p-0 text-[#16181d] shadow-2xl sm:rounded-[12px] [&>button]:hidden"
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
        <div className="flex items-start justify-between px-7 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-[680] tracking-[-0.02em] text-[#10141d]">Configure routine</DialogTitle>
            <p className="mt-1 text-[13px] text-[#737b86]">
              {mode === 'create' ? 'Adjust the details, then create the routine.' : 'Adjust the details, then save your changes.'}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-[#747b85] transition hover:bg-[#eef1ea] hover:text-[#171b22]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-7 mt-5 flex items-center justify-between gap-4 rounded-[10px] border border-[rgba(15,23,42,0.08)] bg-white/80 px-4 py-3">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-[#f4f5f2]">
              <RoutineIcon name={template ? template.icon : 'sparkles'} className="h-4 w-4 text-[#374151]" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-[660] text-[#1f242d]">{template ? template.title : 'Custom routine'}</span>
              <span className="block truncate text-[12px] text-[#8a929c]">{bannerSummary}</span>
            </span>
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-[640] text-[#4b5563] transition hover:bg-[#eef1ea] hover:text-[#171b22]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Change template
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1.5">
              <button
                type="button"
                onClick={() => applyTemplate(null)}
                className={cn('flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] font-[600] transition hover:bg-[#f1f3ef]', !template && 'bg-[#eef1ea]')}
              >
                Custom routine
              </button>
              <div className="my-1 h-px bg-[rgba(15,23,42,0.06)]" />
              {ROUTINE_TEMPLATES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyTemplate(item)}
                  className={cn('flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] font-[560] transition hover:bg-[#f1f3ef]', template?.id === item.id && 'bg-[#eef1ea]')}
                >
                  <RoutineIcon name={item.icon} className="h-3.5 w-3.5 shrink-0 text-[#69727d]" />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid grid-cols-1 gap-8 px-7 pb-2 pt-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="routine-name" className={fieldLabelClass()}>Name</label>
              <input
                id="routine-name"
                value={state.name}
                onChange={(event) => setState({ ...state, name: event.target.value })}
                placeholder="e.g. Weekly training review"
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <span className={fieldLabelClass()}>Schedule</span>
              <ScheduleEditor
                draft={state.draft}
                onChange={(patch) => setState((current) => ({ ...current, draft: { ...current.draft, ...patch } }))}
              />
              <p className="text-[12px] leading-5 text-[#8a929c]" aria-live="polite">
                {lastRunAt ? <>Last: {formatOccurrence(new Date(lastRunAt), now)}<br /></> : null}
                Next: {preview.length ? `${preview.map((date) => formatOccurrence(date, now)).join(', ')}…` : 'no upcoming runs — check the end date'}
              </p>
            </div>

            <div className="space-y-2">
              <span className={fieldLabelClass()}>Agent</span>
              <SegmentedControl
                value={state.agentTier}
                options={AGENT_TIERS.map((tier) => ({ id: tier.id, label: tier.label }))}
                onChange={(agentTier) => setState({ ...state, agentTier })}
              />
              <p className="text-[12px] text-[#8a929c]">{selectedTier.description}</p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <span className="min-w-0">
                  <span className={fieldLabelClass()}>Notifications</span>
                  <span className="block text-[12px] text-[#8a929c]">Push when a new report is ready.</span>
                </span>
                <Switch
                  checked={state.notifyPush}
                  onCheckedChange={(checked) => setState({ ...state, notifyPush: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="min-w-0">
                  <span className={fieldLabelClass()}>Email</span>
                  <span className="block text-[12px] text-[#8a929c]">Email me when a new report is ready.</span>
                </span>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Switch checked={false} disabled aria-label="Email notifications (unavailable)" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-[240px]">
                      Email notifications need a connected email account — routines deliver in-app for now.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col space-y-2">
            <label htmlFor="routine-instructions" className={fieldLabelClass()}>Instructions</label>
            <p className="text-[12px] text-[#8a929c]">Describe what you&rsquo;d like Ritual to gather, analyze, or summarize.</p>
            <textarea
              id="routine-instructions"
              value={state.instructions}
              onChange={(event) => setState({ ...state, instructions: event.target.value })}
              placeholder="e.g. Compare this week's sleep and workouts against my 30-day baseline and tell me what to change"
              className="min-h-[320px] flex-1 resize-none rounded-[8px] border border-[rgba(15,23,42,0.10)] bg-white/90 px-4 py-3 text-[14px] leading-6 text-[#22262d] outline-none transition placeholder:text-[#9aa1aa] focus:border-[rgba(15,23,42,0.24)]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[rgba(15,23,42,0.06)] px-7 py-4">
          <button
            type="button"
            onClick={requestClose}
            className="inline-flex h-9 items-center rounded-sm px-3.5 text-[14px] font-[640] text-[#4b5563] transition hover:bg-[#eef1ea] hover:text-[#171b22]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex h-9 items-center gap-2 rounded-sm bg-[#111827] px-3.5 text-[14px] font-[650] text-white transition hover:bg-[#202938] disabled:opacity-45"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === 'create' ? 'Create routine' : 'Save changes'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
