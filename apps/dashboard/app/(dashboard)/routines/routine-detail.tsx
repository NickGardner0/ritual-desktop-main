'use client';

import React, { useState } from 'react';
import { Copy, Loader2, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import type { AgentRoutine } from '@/lib/routines/model';
import type { RoutineRunView } from '@/lib/routines/runs';
import { describeSchedule, nextOccurrences } from '@/lib/routines/schedule-engine.mjs';
import { formatOccurrence, toDate } from '@/lib/routines/time';
import { DataSourceIcons } from '@/lib/routines/ui';
import { FieldGroup, FieldRow, IconButton } from '@/lib/tasks/reference-task-shell';
import { WEEKDAYS } from '@/lib/tasks/routine-editor';
import { cn } from '@/lib/utils';

import { RunHistory } from './routine-runs';

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  on_completion: 'On completion',
};

/** Quiet read-only value chip, in the reference app's pill style. */
function ValuePill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-7 items-center rounded-sm bg-white/82 px-2.5 text-[13px] font-[600] text-[#22262d]', className)}>
      {children}
    </span>
  );
}

function ordinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  const mod10 = day % 10;
  if (mod10 === 1) return `${day}st`;
  if (mod10 === 2) return `${day}nd`;
  if (mod10 === 3) return `${day}rd`;
  return `${day}th`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function RoutineDetail({
  item,
  now,
  runs,
  running,
  onRename,
  onTogglePause,
  onRunNow,
  onEdit,
  onDuplicate,
  onDelete,
  onRetryRun,
}: {
  item: AgentRoutine;
  now: Date;
  runs: RoutineRunView[];
  running: boolean;
  onRename: (item: AgentRoutine, name: string) => void;
  onTogglePause: (item: AgentRoutine) => void;
  onRunNow: (item: AgentRoutine) => void;
  onEdit: (item: AgentRoutine) => void;
  onDuplicate: (item: AgentRoutine) => void;
  onDelete: (item: AgentRoutine) => void;
  onRetryRun: (run: RoutineRunView) => void;
}) {
  const { routine, agent } = item;
  const [name, setName] = useState(routine.title);
  const [syncedTitle, setSyncedTitle] = useState(routine.title);
  if (syncedTitle !== routine.title) {
    // Adjust local edit state when the routine changes underneath us.
    setSyncedTitle(routine.title);
    setName(routine.title);
  }

  const paused = routine.status === 'paused';
  const config = routine.trigger_config || {};
  const upcoming = nextOccurrences({
    triggerType: routine.trigger_type,
    config,
    from: now,
    firstRunAt: toDate(routine.first_run_at),
    endsAt: toDate(routine.ends_at),
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

  const interval = Math.max(1, Math.floor(Number(config.interval) || 1));
  const intervalUnit = routine.trigger_type === 'daily' ? 'day'
    : routine.trigger_type === 'weekly' ? 'week'
      : routine.trigger_type === 'monthly' ? 'month'
        : routine.trigger_type === 'yearly' ? 'year'
          : String(config.unit || 'weeks').replace(/s$/, '');

  const weekdays = Array.isArray(config.weekdays) ? config.weekdays.map(Number) : [];
  const rawDay = (config as Record<string, unknown>).day;
  const dayLabel = rawDay === 'first' ? 'first day' : rawDay === 'last' ? 'last day' : ordinalSuffix(Math.max(1, Math.min(31, Number(rawDay) || 1)));
  const monthLabel = MONTHS[Math.max(0, Math.min(11, (Number(config.month) || 1) - 1))];

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="flex items-start justify-between gap-4">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setName(routine.title);
          }}
          aria-label="Routine name"
          className="min-w-0 flex-1 bg-transparent text-[26px] font-[680] leading-tight tracking-[-0.03em] text-[#111827] outline-none"
        />
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => onRunNow(item)}
            disabled={running || !routine.ai_workflow_definition_id}
            title={running ? 'This routine is already running' : !routine.ai_workflow_definition_id ? 'This routine has no agent attached — edit and save to attach one' : 'Run now'}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-[640] text-[#4b5563] transition hover:bg-[#eef1ea] hover:text-[#171b22] disabled:opacity-40"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Running' : 'Run now'}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onEdit(item)}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
              </DropdownMenuItem>
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
      <div className="mt-1 text-[13px] font-[540] text-[#737b86]">{describeSchedule(routine.trigger_type, config)}</div>

      <div className="mt-6 space-y-3">
        <FieldGroup>
          <FieldRow label="Trigger">
            <button type="button" onClick={() => onEdit(item)} title="Edit schedule">
              <ValuePill className="transition hover:bg-white">{FREQUENCY_LABELS[routine.trigger_type] || routine.trigger_type}</ValuePill>
            </button>
          </FieldRow>
          <FieldRow label="Paused">
            <Switch checked={paused} onCheckedChange={() => onTogglePause(item)} />
          </FieldRow>
        </FieldGroup>

        <FieldGroup>
          <FieldRow label="Every">
            <ValuePill>{interval}</ValuePill>
            <span className="text-[13px] font-[560] text-[#6a717b]">{interval === 1 ? intervalUnit : `${intervalUnit}s`}</span>
          </FieldRow>
          {routine.trigger_type === 'weekly' && weekdays.length ? (
            <FieldRow label="On">
              <span className="flex flex-wrap justify-end gap-1">
                {weekdays.sort((a, b) => a - b).map((day) => (
                  <ValuePill key={day} className="h-6 px-2 text-[12px]">{WEEKDAYS[day]?.label || day}</ValuePill>
                ))}
              </span>
            </FieldRow>
          ) : null}
          {routine.trigger_type === 'monthly' || routine.trigger_type === 'yearly' ? (
            <FieldRow label="On the">
              <ValuePill>{dayLabel}</ValuePill>
              {routine.trigger_type === 'yearly' ? (
                <>
                  <span className="text-[13px] font-[560] text-[#6a717b]">in</span>
                  <ValuePill>{monthLabel}</ValuePill>
                </>
              ) : null}
            </FieldRow>
          ) : null}
          <FieldRow label="First run">
            <ValuePill className={cn(!routine.first_run_at && 'text-[#8a929c]')}>
              {routine.first_run_at ? formatOccurrence(toDate(routine.first_run_at)!, now) : 'Next occurrence'}
            </ValuePill>
          </FieldRow>
          <FieldRow label="Ends">
            <ValuePill className={cn(!routine.ends_at && 'text-[#8a929c]')}>
              {routine.ends_at ? formatOccurrence(toDate(routine.ends_at)!, now) : 'Never'}
            </ValuePill>
          </FieldRow>
        </FieldGroup>

        <div className="px-4 text-[12px] leading-5 text-[#8a929c]">
          <div>Last: {routine.last_run_at ? formatOccurrence(toDate(routine.last_run_at)!, now) : '—'}</div>
          <div>
            Next: {paused
              ? 'paused'
              : upcoming.length
                ? `${upcoming.map((date) => formatOccurrence(date, now)).join(', ')}…`
                : '—'}
          </div>
        </div>

        <section
          role="button"
          tabIndex={0}
          onClick={() => onEdit(item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEdit(item);
          }}
          title="Edit instructions"
          className="cursor-pointer overflow-hidden rounded-[8px] border border-[rgba(15,23,42,0.07)] bg-[#f4f5f2] outline-none transition hover:border-[rgba(15,23,42,0.14)] focus-visible:ring-2 focus-visible:ring-[#111827]"
        >
          <div className="flex min-h-[40px] items-center justify-between gap-4 px-4">
            <span className="text-[13px] font-[560] text-[#6a717b]">Instructions</span>
            <DataSourceIcons sources={agent.data_sources.slice(0, 6)} />
          </div>
          <p className="whitespace-pre-wrap px-4 pb-3.5 text-[13px] leading-6 text-[#3b414b]">
            {agent.instructions || routine.description || 'No instructions yet — click to add what this routine should gather.'}
          </p>
        </section>

        <section className="pt-3">
          <div className="px-1 text-[12px] font-[650] uppercase tracking-[0.1em] text-[#8a929c]">Run history</div>
          <RunHistory
            runs={runs}
            now={now}
            showRoutineName={false}
            onRetry={onRetryRun}
            emptyText="No runs yet. This routine records every run here once it starts."
            className="mt-1.5"
          />
        </section>
      </div>
    </div>
  );
}
