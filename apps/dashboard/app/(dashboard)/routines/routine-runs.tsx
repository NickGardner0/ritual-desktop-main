'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCw } from 'lucide-react';

import type { RoutineRunView } from '@/lib/routines/runs';
import { dayGroupLabel, formatAbsolute, formatAgo, formatDuration } from '@/lib/routines/time';
import { RoutineIcon, RunStatusDot } from '@/lib/routines/ui';
import { subtleBorderClass } from '@/lib/tasks/reference-task-shell';
import { cn } from '@/lib/utils';

function RunRow({
  run,
  now,
  showRoutineName,
  onRetry,
}: {
  run: RoutineRunView;
  now: Date;
  showRoutineName: boolean;
  onRetry?: (run: RoutineRunView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failed = run.status === 'failed';
  const duration = formatDuration(run.startedAt, run.finishedAt);

  return (
    <div className={cn('rounded-sm transition', failed && 'cursor-pointer', (failed && expanded) ? 'bg-[#f6efee]' : 'hover:bg-[#f1f3ef]')}>
      <div
        className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
        onClick={failed ? () => setExpanded((value) => !value) : undefined}
        role={failed ? 'button' : undefined}
        aria-expanded={failed ? expanded : undefined}
      >
        <span className="flex items-center justify-center">
          <RunStatusDot status={run.status} />
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {showRoutineName ? (
            <>
              <RoutineIcon name={run.routineIcon} className="h-3.5 w-3.5 shrink-0 text-[#69727d]" />
              <span className="truncate text-[14px] font-[620] text-[#1f242d]">{run.routineName}</span>
            </>
          ) : (
            <span className="truncate text-[14px] font-[560] text-[#3b414b] first-letter:uppercase">
              {run.status === 'succeeded' ? 'Completed' : run.status === 'running' ? 'Running' : run.status === 'queued' ? 'Queued' : run.status === 'skipped' ? 'Skipped' : 'Failed'}
            </span>
          )}
          {run.trigger === 'manual' ? (
            <span className="shrink-0 rounded-full border border-[rgba(15,23,42,0.10)] bg-white/70 px-2 py-0.5 text-[11px] font-[600] text-[#6a717b]">
              Run manually
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-3 text-[12px] font-[520] text-[#8a929c]">
          {duration ? <span>{duration}</span> : null}
          <span title={formatAbsolute(run.occurredAt)}>{formatAgo(run.occurredAt, now)}</span>
          {run.artifactId ? (
            <Link
              href={`/reports?artifactId=${run.artifactId}`}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-1 font-[640] text-[#2f3743] hover:text-[#10141d]"
            >
              Open report
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </span>
      </div>
      {failed && expanded ? (
        <div className="flex items-start justify-between gap-4 px-3 pb-3 pl-[38px]">
          <p className="min-w-0 whitespace-pre-wrap break-words text-[12px] leading-5 text-[#8b3f39]">
            {run.error || 'The run failed without an error message.'}
          </p>
          {onRetry && run.routineId ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRetry(run);
              }}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white px-2.5 text-[12px] font-[640] text-[#2f3743] hover:border-[rgba(15,23,42,0.22)]"
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RunHistory({
  runs,
  now,
  showRoutineName = true,
  onRetry,
  emptyText = 'No runs yet. Routines record every run here once they start.',
  className,
}: {
  runs: RoutineRunView[];
  now: Date;
  showRoutineName?: boolean;
  onRetry?: (run: RoutineRunView) => void;
  emptyText?: string;
  className?: string;
}) {
  if (!runs.length) {
    return <div className={cn('px-3 py-10 text-center text-[14px] text-[#737b86]', className)}>{emptyText}</div>;
  }

  const groups: Array<{ label: string; runs: RoutineRunView[] }> = [];
  for (const run of runs) {
    const label = dayGroupLabel(run.occurredAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.runs.push(run);
    else groups.push({ label, runs: [run] });
  }

  return (
    <div className={className}>
      {groups.map((group) => (
        <section key={group.label}>
          <div className={cn('sticky top-0 z-10 border-b bg-[var(--content-bg)]/95 px-3 py-1.5 text-[12px] font-[650] uppercase tracking-[0.08em] text-[#8a929c] backdrop-blur', subtleBorderClass)}>
            {group.label}
          </div>
          <div className="space-y-0.5 py-1.5">
            {group.runs.map((run) => (
              <RunRow key={run.id} run={run} now={now} showRoutineName={showRoutineName} onRetry={onRetry} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
