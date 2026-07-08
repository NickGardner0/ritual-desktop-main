'use client';

import React, { useState } from 'react';
import { Copy, Loader2, MoreHorizontal, Play, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import {
  AGENT_TIERS,
  ROUTINE_DATA_SOURCES,
  scheduleDraftFromRoutine,
  type AgentRoutine,
  type RoutineAgentConfig,
  type ScheduleDraft,
} from '@/lib/routines/model';
import type { RoutineRunView } from '@/lib/routines/runs';
import { nextOccurrences } from '@/lib/routines/schedule-engine.mjs';
import { formatOccurrence, toDate } from '@/lib/routines/time';
import { DataSourceIcons } from '@/lib/routines/ui';
import { triggerConfigFromDraft } from '@/lib/routines/model';
import { WEEKDAYS } from '@/lib/tasks/routine-editor';
import type { TaskPriority } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { RunHistory } from './routine-runs';

// Compact inline-editor styling, translated from the dark reference app into
// Ritual's light tokens: quiet grouped rows, values as small editable chips.
const groupClass = 'overflow-hidden rounded-[10px] bg-[var(--surface-panel)]';
const rowClass = 'flex min-h-[42px] items-center justify-between gap-3 border-b border-[rgba(15,23,42,0.045)] px-3.5 last:border-b-0';
const labelClass = 'text-[13.5px] font-[500] text-[var(--text-secondary)]';
const chipClass = 'inline-flex h-[26px] cursor-pointer items-center rounded-[7px] bg-[rgba(15,23,42,0.055)] px-2.5 text-[13px] font-[580] text-[var(--text-primary)] transition hover:bg-[rgba(15,23,42,0.09)]';
const chipInputClass = 'h-[26px] rounded-[7px] border-0 bg-[rgba(15,23,42,0.055)] px-2 text-[13px] font-[580] text-[var(--text-primary)] outline-none transition [appearance:none] hover:bg-[rgba(15,23,42,0.09)] focus:bg-[rgba(15,23,42,0.09)]';
const mutedClass = 'text-[13px] font-[500] text-[var(--text-muted)]';

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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const mod10 = day % 10;
  if (mod10 === 1) return `${day}st`;
  if (mod10 === 2) return `${day}nd`;
  if (mod10 === 3) return `${day}rd`;
  return `${day}th`;
}

export function RoutineDetail({
  item,
  now,
  runs,
  running,
  onRename,
  onTogglePause,
  onRunNow,
  onDuplicate,
  onDelete,
  onRetryRun,
  onSaveSchedule,
  onSaveAgent,
  onSaveMeta,
}: {
  item: AgentRoutine;
  now: Date;
  runs: RoutineRunView[];
  running: boolean;
  onRename: (item: AgentRoutine, name: string) => void;
  onTogglePause: (item: AgentRoutine) => void;
  onRunNow: (item: AgentRoutine) => void;
  onDuplicate: (item: AgentRoutine) => void;
  onDelete: (item: AgentRoutine) => void;
  onRetryRun: (run: RoutineRunView) => void;
  onSaveSchedule: (item: AgentRoutine, draft: ScheduleDraft) => void;
  onSaveAgent: (item: AgentRoutine, patch: Partial<RoutineAgentConfig>) => void;
  onSaveMeta: (item: AgentRoutine, patch: { priority?: TaskPriority; tags?: string[] }) => void;
}) {
  const { routine, agent } = item;
  const paused = routine.status === 'paused';

  // Local editing state, re-derived when the routine changes underneath us.
  const [name, setName] = useState(routine.title);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [tagsText, setTagsText] = useState(routine.tags.join(', '));
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftFromRoutine(routine));
  const [syncKey, setSyncKey] = useState(`${routine.id}:${routine.updated_at || ''}`);
  const currentKey = `${routine.id}:${routine.updated_at || ''}`;
  if (syncKey !== currentKey) {
    setSyncKey(currentKey);
    setName(routine.title);
    setInstructions(agent.instructions);
    setTagsText(routine.tags.join(', '));
    setDraft(scheduleDraftFromRoutine(routine));
  }

  const apply = (patch: Partial<ScheduleDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onSaveSchedule(item, next);
  };

  const upcoming = nextOccurrences({
    triggerType: draft.frequency,
    config: triggerConfigFromDraft(draft),
    from: now,
    firstRunAt: draft.firstRun ? new Date(`${draft.firstRun}T00:00:00`) : null,
    endsAt: draft.ends ? new Date(`${draft.ends}T23:59:59`) : null,
    lastCompletedAt: toDate(routine.last_run_at),
    count: 4,
  });

  const commitRename = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === routine.title) {
      setName(routine.title);
      return;
    }
    onRename(item, trimmed);
  };

  const commitTags = () => {
    const tags = tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.join(',') !== routine.tags.join(',')) onSaveMeta(item, { tags });
  };

  const toggleDataSource = (source: string) => {
    const active = agent.data_sources.includes(source);
    const next = active
      ? agent.data_sources.filter((item) => item !== source)
      : [...agent.data_sources, source];
    onSaveAgent(item, { data_sources: next });
  };

  const timeValue = `${String(draft.hour).padStart(2, '0')}:${String(draft.minute).padStart(2, '0')}`;
  const intervalUnit = draft.frequency === 'daily' ? 'day'
    : draft.frequency === 'weekly' ? 'week'
      : draft.frequency === 'monthly' ? 'month'
        : draft.frequency === 'yearly' ? 'year'
          : draft.onCompletionUnit.replace(/s$/, '');

  return (
    <div className="mx-auto max-w-[500px]">
      <div className="flex items-start justify-between gap-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setName(routine.title);
          }}
          aria-label="Routine name"
          className="min-w-0 flex-1 bg-transparent text-[21px] font-[650] leading-tight tracking-[-0.02em] text-[var(--text-primary)] outline-none"
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onRunNow(item)}
            disabled={running || !routine.ai_workflow_definition_id}
            title={running ? 'This routine is already running' : !routine.ai_workflow_definition_id ? 'This routine has no agent attached — edit and save to attach one' : 'Run now'}
            className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[13px] font-[580] text-[var(--text-secondary)] transition hover:bg-[rgba(15,23,42,0.055)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Running' : 'Run now'}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-secondary)] transition hover:bg-[rgba(15,23,42,0.055)] hover:text-[var(--text-primary)]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onDuplicate(item)}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[#b3261e] focus:text-[#b3261e]" onClick={() => onDelete(item)}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        <section className={groupClass}>
          <div className={rowClass}>
            <span className={labelClass}>Trigger</span>
            <select
              value={draft.frequency}
              onChange={(event) => apply({ frequency: event.target.value as ScheduleDraft['frequency'], interval: 1 })}
              className={chipInputClass}
              aria-label="Trigger frequency"
            >
              {FREQUENCIES.map((frequency) => (
                <option key={frequency.id} value={frequency.id}>{frequency.label}</option>
              ))}
            </select>
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Paused</span>
            <Switch checked={paused} onCheckedChange={() => onTogglePause(item)} />
          </div>
        </section>

        <section className={groupClass}>
          <div className={rowClass}>
            <span className={labelClass}>Every</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={99}
                value={draft.interval}
                onChange={(event) => setDraft({ ...draft, interval: Math.max(1, Math.min(99, Number(event.target.value) || 1)) })}
                onBlur={() => onSaveSchedule(item, draft)}
                className={cn(chipInputClass, 'w-12 text-center')}
                aria-label="Interval"
              />
              <span className={mutedClass}>{draft.interval === 1 ? intervalUnit : `${intervalUnit}s`}</span>
            </span>
          </div>

          {draft.frequency === 'weekly' ? (
            <div className={rowClass}>
              <span className={labelClass}>On</span>
              <span className="flex flex-wrap justify-end gap-1">
                {WEEKDAYS.map((day) => {
                  const active = draft.weekdays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => apply({
                        weekdays: active
                          ? draft.weekdays.filter((value) => value !== day.value)
                          : [...draft.weekdays, day.value].sort((a, b) => a - b),
                      })}
                      className={cn(
                        'h-[26px] rounded-[7px] px-2 text-[12px] font-[600] transition',
                        active ? 'bg-[#111827] text-white' : 'bg-[rgba(15,23,42,0.055)] text-[var(--text-secondary)] hover:bg-[rgba(15,23,42,0.09)]',
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
              <span className="flex items-center gap-1.5">
                <select
                  value={String(draft.day)}
                  onChange={(event) => {
                    const value = event.target.value;
                    apply({ day: value === 'first' || value === 'last' ? value : Number(value) });
                  }}
                  className={chipInputClass}
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
                    <span className={mutedClass}>in</span>
                    <select
                      value={draft.month}
                      onChange={(event) => apply({ month: Number(event.target.value) })}
                      className={chipInputClass}
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
              <input
                type="time"
                value={timeValue}
                onChange={(event) => {
                  const [hour, minute] = event.target.value.split(':').map(Number);
                  if (Number.isFinite(hour) && Number.isFinite(minute)) apply({ hour, minute });
                }}
                className={cn(chipInputClass, '[&::-webkit-calendar-picker-indicator]:hidden')}
                aria-label="Time of day"
              />
            </div>
          ) : (
            <div className={rowClass}>
              <span className={labelClass}>After</span>
              <select
                value={draft.onCompletionUnit}
                onChange={(event) => apply({ onCompletionUnit: event.target.value as ScheduleDraft['onCompletionUnit'] })}
                className={chipInputClass}
                aria-label="Completion unit"
              >
                <option value="days">days</option>
                <option value="weeks">weeks</option>
                <option value="months">months</option>
              </select>
            </div>
          )}

          <div className={rowClass}>
            <span className={labelClass}>First run</span>
            <input
              type="date"
              value={draft.firstRun || ''}
              onChange={(event) => apply({ firstRun: event.target.value || null })}
              className={cn(chipInputClass, !draft.firstRun && 'text-[var(--text-muted)]')}
              aria-label="First run date"
            />
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Ends</span>
            <input
              type="date"
              value={draft.ends || ''}
              onChange={(event) => apply({ ends: event.target.value || null })}
              className={cn(chipInputClass, !draft.ends && 'text-[var(--text-muted)]')}
              aria-label="End date"
            />
          </div>
        </section>

        <div className="px-3.5 text-[12px] leading-5 text-[var(--text-muted)]">
          <div>Last: {routine.last_run_at ? formatOccurrence(toDate(routine.last_run_at)!, now) : '—'}</div>
          <div>
            Next: {paused
              ? 'paused'
              : upcoming.length
                ? `${upcoming.map((date) => formatOccurrence(date, now)).join(', ')}…`
                : '—'}
          </div>
        </div>

        <section className={groupClass}>
          <div className={rowClass}>
            <span className={labelClass}>Priority</span>
            <select
              value={routine.priority}
              onChange={(event) => onSaveMeta(item, { priority: event.target.value as TaskPriority })}
              className={chipInputClass}
              aria-label="Priority"
            >
              {PRIORITIES.map((priority) => (
                <option key={priority.id} value={priority.id}>{priority.label}</option>
              ))}
            </select>
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Agent</span>
            <span className="flex items-center gap-1">
              {AGENT_TIERS.map((tier) => (
                <button
                  key={tier.id}
                  type="button"
                  title={tier.description}
                  aria-pressed={agent.agent_tier === tier.id}
                  onClick={() => onSaveAgent(item, { agent_tier: tier.id })}
                  className={cn(
                    'h-[26px] rounded-[7px] px-2.5 text-[12.5px] font-[600] transition',
                    agent.agent_tier === tier.id
                      ? 'bg-[#111827] text-white'
                      : 'bg-[rgba(15,23,42,0.055)] text-[var(--text-secondary)] hover:bg-[rgba(15,23,42,0.09)]',
                  )}
                >
                  {tier.label}
                </button>
              ))}
            </span>
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Notify</span>
            <Switch
              checked={agent.notify_push}
              onCheckedChange={(checked) => onSaveAgent(item, { notify_push: checked })}
            />
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Email</span>
            <TooltipProvider delayDuration={160}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Switch checked={false} disabled aria-label="Email notifications unavailable" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[240px]">
                  Email delivery is not connected for workflow routines yet. Runs notify in-app for now.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className={cn(rowClass, 'items-start py-2.5')}>
            <span className={labelClass}>Watches</span>
            <span className="flex max-w-[330px] flex-wrap justify-end gap-1">
              {ROUTINE_DATA_SOURCES.map((source) => {
                const active = agent.data_sources.includes(source.key);
                return (
                  <button
                    key={source.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDataSource(source.key)}
                    className={cn(
                      'inline-flex h-[26px] items-center gap-1.5 rounded-[7px] px-2 text-[12px] font-[600] transition',
                      active ? 'bg-[#111827] text-white' : 'bg-[rgba(15,23,42,0.055)] text-[var(--text-secondary)] hover:bg-[rgba(15,23,42,0.09)]',
                    )}
                  >
                    <DataSourceIcons sources={[source.key]} className={active ? '[&_svg]:text-white' : ''} />
                    {source.label}
                  </button>
                );
              })}
            </span>
          </div>
        </section>

        <section className={groupClass}>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            onBlur={() => {
              if (instructions.trim() !== agent.instructions.trim()) {
                onSaveAgent(item, { instructions: instructions.trim() });
              }
            }}
            rows={5}
            placeholder="Describe what you'd like Ritual to gather, analyze, or summarize…"
            aria-label="Instructions"
            className="block w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-6 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </section>

        <section className={groupClass}>
          <div className={rowClass}>
            <span className={labelClass}>Tags</span>
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              onBlur={commitTags}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                if (event.key === 'Escape') setTagsText(routine.tags.join(', '));
              }}
              placeholder="+ tag"
              aria-label="Tags"
              className="min-w-0 flex-1 bg-transparent text-right text-[13px] font-[560] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        </section>

        <section className="pt-3">
          <div className="px-1 text-[11px] font-[650] uppercase tracking-[0.1em] text-[var(--text-muted)]">Run history</div>
          <RunHistory
            runs={runs}
            now={now}
            showRoutineName={false}
            onRetry={onRetryRun}
            emptyText="No runs yet. This routine records every run here once it starts."
            className="mt-1"
          />
        </section>
      </div>
    </div>
  );
}
