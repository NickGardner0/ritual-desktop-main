'use client';

import React, { useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Copy, ListChecks, MoreHorizontal, Pause, Pencil, Play, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AgentRoutine } from '@/lib/routines/model';
import type { RoutineRunView } from '@/lib/routines/runs';
import { describeSchedule } from '@/lib/routines/schedule-engine.mjs';
import { formatAgo, formatUpcoming } from '@/lib/routines/time';
import { PausedPill, ROUTINE_STATUS_COLORS, RoutineIcon } from '@/lib/routines/ui';
import { cn } from '@/lib/utils';

export type RoutineRowActions = {
  onSelect: (id: string) => void;
  onRunNow: (item: AgentRoutine) => void;
  onTogglePause: (item: AgentRoutine) => void;
  onEdit: (item: AgentRoutine) => void;
  onDuplicate: (item: AgentRoutine) => void;
  onViewRuns: (item: AgentRoutine) => void;
  onDelete: (item: AgentRoutine) => void;
};

function LastRunBadge({ lastRun, now }: { lastRun: RoutineRunView | undefined; now: Date }) {
  if (!lastRun) return null;
  if (lastRun.status === 'running' || lastRun.status === 'queued') {
    return (
      <span className="flex items-center gap-1.5 text-[12px] font-[540] text-[#737b86]">
        <span className="routine-running-dot inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ROUTINE_STATUS_COLORS.neutral }} />
        Running
      </span>
    );
  }
  const failed = lastRun.status === 'failed';
  const color = failed ? ROUTINE_STATUS_COLORS.failure : ROUTINE_STATUS_COLORS.success;
  const label = `${failed ? 'Failed' : 'Ran'} ${formatAgo(lastRun.finishedAt || lastRun.occurredAt, now)}`;
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-[540]" style={{ color: failed ? color : '#737b86' }}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function RoutineRow({
  item,
  selected,
  now,
  running,
  lastRun,
  actions,
  first,
}: {
  item: AgentRoutine;
  selected: boolean;
  now: Date;
  running: boolean;
  lastRun: RoutineRunView | undefined;
  actions: RoutineRowActions;
  first: boolean;
}) {
  const { routine, agent } = item;
  const paused = routine.status === 'paused';
  const scheduleSummary = describeSchedule(routine.trigger_type, routine.trigger_config || {});
  const nextLabel = paused ? '' : formatUpcoming(routine.next_run_at, now);

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={first ? 0 : -1}
      data-routine-row={routine.id}
      onClick={() => actions.onSelect(routine.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          actions.onSelect(routine.id);
        }
      }}
      className={cn(
        'group grid w-full cursor-pointer grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-3 rounded-sm px-3 py-2.5 text-left outline-none transition',
        'focus-visible:ring-2 focus-visible:ring-[#111827]',
        selected ? 'bg-[#e6ecdf]' : 'hover:bg-[#f1f3ef]',
        paused && 'opacity-60',
      )}
    >
      <span className="mt-0.5 flex h-5 w-5 items-center justify-center">
        <RoutineIcon name={agent.icon} className="h-4 w-4 text-[#4b5563]" />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-[640] text-[#1f242d]">{routine.title}</span>
          {paused ? <PausedPill /> : null}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2 text-[12px] font-[520] text-[#737b86]">
          <span className="truncate">{scheduleSummary}</span>
          {nextLabel ? <span className="shrink-0 text-[#8a929c]">· Next {nextLabel}</span> : null}
        </span>
        <span className="mt-1 block">
          <LastRunBadge lastRun={lastRun} now={now} />
        </span>
      </span>
      <span
        className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          title={running ? 'Already running' : 'Run now'}
          disabled={running || !item.routine.ai_workflow_definition_id}
          onClick={() => actions.onRunNow(item)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-[#747b85] transition hover:bg-white/80 hover:text-[#171b22] disabled:opacity-40"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={paused ? 'Resume' : 'Pause'}
          onClick={() => actions.onTogglePause(item)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-[#747b85] transition hover:bg-white/80 hover:text-[#171b22]"
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="More"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-[#747b85] transition hover:bg-white/80 hover:text-[#171b22]"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => actions.onEdit(item)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onDuplicate(item)}>
              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onViewRuns(item)}>
              <ListChecks className="mr-2 h-3.5 w-3.5" /> View runs
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[#b3261e] focus:text-[#b3261e]"
              onClick={() => actions.onDelete(item)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

export function RoutineList({
  items,
  selectedId,
  now,
  runningRoutineIds,
  lastRunByRoutine,
  actions,
}: {
  items: AgentRoutine[];
  selectedId: string | null;
  now: Date;
  runningRoutineIds: Set<string>;
  lastRunByRoutine: Map<string, RoutineRunView>;
  actions: RoutineRowActions;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const sorted = [...items].sort((a, b) => {
    const pausedDelta = Number(a.routine.status === 'paused') - Number(b.routine.status === 'paused');
    if (pausedDelta !== 0) return pausedDelta;
    const aNext = a.routine.next_run_at ? new Date(a.routine.next_run_at).getTime() : Infinity;
    const bNext = b.routine.next_run_at ? new Date(b.routine.next_run_at).getTime() : Infinity;
    if (aNext !== bNext) return aNext - bNext;
    return a.routine.title.localeCompare(b.routine.title);
  });

  const moveFocus = (delta: number) => {
    const rows = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-routine-row]') || []);
    if (!rows.length) return;
    const activeIndex = rows.findIndex((row) => row === document.activeElement);
    const nextIndex = activeIndex === -1
      ? (delta > 0 ? 0 : rows.length - 1)
      : Math.max(0, Math.min(rows.length - 1, activeIndex + delta));
    rows[nextIndex]?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Routines"
      className="space-y-0.5"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveFocus(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveFocus(-1);
        }
      }}
    >
      <AnimatePresence initial={false}>
        {sorted.map((item, index) => (
          <motion.div
            key={item.routine.id}
            layout={!reduceMotion}
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: 0.16 }}
          >
            <RoutineRow
              item={item}
              first={index === 0}
              selected={selectedId === item.routine.id}
              now={now}
              running={runningRoutineIds.has(item.routine.id)}
              lastRun={lastRunByRoutine.get(item.routine.id)}
              actions={actions}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
