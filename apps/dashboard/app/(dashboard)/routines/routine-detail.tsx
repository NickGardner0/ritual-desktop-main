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
import { DataSourceIcons, RoutineIcon } from '@/lib/routines/ui';
import { subtleBorderClass } from '@/lib/tasks/reference-task-shell';
import { cn } from '@/lib/utils';

import { RunHistory } from './routine-runs';

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[42px] grid-cols-[minmax(110px,1fr)_minmax(0,auto)] items-center gap-4 border-b border-[rgba(15,23,42,0.06)] px-4 last:border-b-0">
      <span className="text-[13px] font-[560] text-[#6a717b]">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-[600] text-[#22262d]">{children}</span>
    </div>
  );
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  on_completion: 'On completion',
};

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
  const summary = describeSchedule(routine.trigger_type, config);
  const upcoming = nextOccurrences({
    triggerType: routine.trigger_type,
    config,
    from: now,
    firstRunAt: toDate(routine.first_run_at),
    endsAt: toDate(routine.ends_at),
    lastCompletedAt: toDate(routine.last_run_at),
    count: 3,
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
  const unit = routine.trigger_type === 'daily' ? 'day' : routine.trigger_type === 'weekly' ? 'week' : routine.trigger_type === 'monthly' ? 'month' : routine.trigger_type === 'yearly' ? 'year' : String(config.unit || 'weeks').replace(/s$/, '');

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[rgba(15,23,42,0.08)] bg-[#f4f5f2]">
            <RoutineIcon name={agent.icon} className="h-4 w-4 text-[#374151]" />
          </span>
          <div className="min-w-0 flex-1">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                if (event.key === 'Escape') setName(routine.title);
              }}
              aria-label="Routine name"
              className="w-full bg-transparent text-[28px] font-[680] leading-tight tracking-[-0.03em] text-[#111827] outline-none focus:rounded-sm focus:ring-2 focus:ring-[rgba(17,24,39,0.15)]"
            />
            <div className="mt-0.5 text-[13px] font-[540] text-[#737b86]">{summary}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-[13px] font-[560] text-[#6a717b]">
            Paused
            <Switch checked={paused} onCheckedChange={() => onTogglePause(item)} />
          </label>
          <button
            type="button"
            onClick={() => onRunNow(item)}
            disabled={running || !item.definition}
            title={running ? 'This routine is already running' : !item.definition ? 'This routine has no agent attached' : 'Run now'}
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/85 px-3 text-[13px] font-[640] text-[#2f3743] transition hover:bg-white disabled:opacity-45"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Running' : 'Run now'}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="inline-flex h-9 w-9 items-center justify-center rounded-sm text-[#747b85] transition hover:bg-[#eef1ea] hover:text-[#171b22]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
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

      <section className={cn('mt-7 overflow-hidden rounded-[10px] border bg-[#f4f5f2]', subtleBorderClass)}>
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="text-[12px] font-[650] uppercase tracking-[0.1em] text-[#8a929c]">Schedule</span>
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="text-[12px] font-[640] text-[#4b5563] transition hover:text-[#111827]"
          >
            Edit
          </button>
        </div>
        <div className="mt-1">
          <SummaryRow label="Trigger">{FREQUENCY_LABELS[routine.trigger_type] || routine.trigger_type}</SummaryRow>
          <SummaryRow label="Every">{interval} {interval === 1 ? unit : `${unit}s`}</SummaryRow>
          <SummaryRow label="First run">{routine.first_run_at ? formatOccurrence(new Date(routine.first_run_at), now) : 'Next occurrence'}</SummaryRow>
          <SummaryRow label="Ends">{routine.ends_at ? formatOccurrence(new Date(routine.ends_at), now) : 'Never'}</SummaryRow>
        </div>
        <div className="border-t border-[rgba(15,23,42,0.06)] px-4 py-2.5 text-[12px] leading-5 text-[#8a929c]">
          <div>Last: {routine.last_run_at ? formatOccurrence(new Date(routine.last_run_at), now) : '—'}</div>
          <div>
            Next: {paused
              ? 'paused'
              : upcoming.length
                ? `${upcoming.map((date) => formatOccurrence(date, now)).join(', ')}…`
                : '—'}
          </div>
        </div>
      </section>

      <section
        role="button"
        tabIndex={0}
        onClick={() => onEdit(item)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onEdit(item);
        }}
        title="Edit instructions"
        className={cn(
          'mt-4 cursor-pointer rounded-[10px] border bg-white/70 px-4 py-3.5 outline-none transition hover:bg-white/95 focus-visible:ring-2 focus-visible:ring-[#111827]',
          subtleBorderClass,
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-[650] uppercase tracking-[0.1em] text-[#8a929c]">Instructions</span>
          <DataSourceIcons sources={agent.data_sources.slice(0, 6)} />
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-6 text-[#3b414b]">
          {agent.instructions || routine.description || 'No instructions yet — click to add what this routine should gather.'}
        </p>
      </section>

      <section className="mt-6">
        <div className="text-[12px] font-[650] uppercase tracking-[0.1em] text-[#8a929c]">Run history</div>
        <RunHistory
          runs={runs}
          now={now}
          showRoutineName={false}
          onRetry={onRetryRun}
          emptyText="No runs yet. This routine records every run here once it starts."
          className="mt-2"
        />
      </section>
    </div>
  );
}
