"use client";

import Link from "next/link";
import { Calendar, CalendarCheck, CalendarDays, CalendarRange, Check, CheckSquare, FileText, FlaskConical, MessageSquare, Repeat, Sparkles } from "lucide-react";
import type { EntitySummary, EntityType } from "@ritual/shared-contracts";
import { Popover, PopoverContent, PopoverTrigger } from "@ritual/ui/popover";
import { ENTITY_TYPE_LABELS } from "@/lib/entities/registry";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<EntityType, typeof CheckSquare> = {
  habit: Sparkles,
  habit_log: CalendarCheck,
  task: CheckSquare,
  routine: Repeat,
  artifact: FileText,
  conversation: MessageSquare,
  experiment: FlaskConical,
  calendar_block: CalendarDays,
  day: Calendar,
  time_window: CalendarRange,
};

const TASK_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  completed: "Done",
  skipped: "Skipped",
  archived: "Archived",
};

export function entityPillMeta(summary: EntitySummary): string | undefined {
  const type = summary.ref.type;
  if (type === "task") {
    const status = (summary.status || "").trim();
    return TASK_STATUS_LABELS[status] || status || (summary.subtitle || "").trim() || undefined;
  }
  const preferred =
    type === "habit_log" || type === "artifact" || type === "day" || type === "time_window"
      ? summary.subtitle || summary.status
      : summary.status || summary.subtitle;
  const value = (preferred || "").trim();
  return value || undefined;
}

export function EntityPreviewCard({
  summary,
  className,
}: {
  summary: EntitySummary;
  className?: string;
}) {
  const Icon = TYPE_ICON[summary.ref.type];
  const statusLabel = entityPillMeta(summary);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ritual-text-muted)]">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {ENTITY_TYPE_LABELS[summary.ref.type] || summary.ref.type}
      </div>
      <div className={cn("text-[14px] font-medium text-[var(--ritual-text-primary)]", summary.ref.type === "task" && summary.status === "completed" && "line-through")}>{summary.title}</div>
      {summary.subtitle ? (
        <div className="text-[12px] text-[var(--ritual-text-secondary)]">{summary.subtitle}</div>
      ) : null}
      {statusLabel ? (
        <div className="text-[11px] text-[var(--ritual-text-muted)]">{statusLabel}</div>
      ) : null}
    </div>
  );
}

export function EntityPill({
  summary,
  className,
  disableLink = false,
}: {
  summary: EntitySummary;
  className?: string;
  disableLink?: boolean;
}) {
  const Icon = summary.ref.type === "task" && summary.status === "completed" ? Check : TYPE_ICON[summary.ref.type];
  const disabled = summary.availability !== "ok";
  const meta = entityPillMeta(summary);
  const skipped = summary.ref.type === "task" && summary.status === "skipped";
  const completed = summary.ref.type === "task" && summary.status === "completed";
  const pill = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--ritual-border-subtle)] bg-[var(--ritual-surface-raised)] px-2 py-0.5 text-[12px] text-[var(--ritual-text-primary)]",
        (disabled || skipped) && "text-[var(--ritual-text-muted)]",
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
      <span className={cn("truncate", completed && "text-[var(--ritual-text-muted)] line-through")}>{summary.title}</span>
      {meta && !disabled ? (
        <span className="truncate text-[11px] text-[var(--ritual-text-muted)]">{meta}</span>
      ) : null}
    </span>
  );

  if (disabled || disableLink) {
    return pill;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Link href={summary.route} className="inline-flex max-w-full no-underline">
          {pill}
        </Link>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <EntityPreviewCard summary={summary} />
      </PopoverContent>
    </Popover>
  );
}
